import { expect, test, type Page } from "@playwright/test";
import { checksBar, importSql, openApp, openChecks, runTests } from "./helpers";

const col = (name: string, dataType: string, extra: Record<string, unknown> = {}) => ({
  name, dataType, nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null, ...extra,
});

/** A small generated schema, in the shape /api/generate returns. */
const GENERATED = {
  plan: { domain: "Book club", entities: [], relationships: [], actions: [], interfaces: [] },
  ontology: { objectTypes: [], linkTypes: [], actionTypes: [], interfaces: [] },
  erd: {
    tables: [
      { id: "tbl_members", name: "members", objectTypeId: "members", comment: "A club member", constraints: [], indexes: [],
        columns: [col("id", "SERIAL", { isPrimaryKey: true }), col("email", "TEXT"), col("created_at", "TIMESTAMP", { defaultValue: "NOW()" })] },
      { id: "tbl_meetings", name: "meetings", objectTypeId: "meetings", comment: "A scheduled meeting", constraints: [], indexes: [],
        columns: [col("id", "SERIAL", { isPrimaryKey: true }), col("host_id", "INTEGER", { isForeignKey: true, referencesTable: "members", referencesColumn: "id" }), col("starts_at", "TIMESTAMP"), col("price", "REAL"), col("created_at", "TIMESTAMP", { defaultValue: "NOW()" })] },
    ],
    relationships: [{ id: "rel_host", fromTable: "meetings", toTable: "members", fromColumn: "host_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "RESTRICT" }],
  },
  generationMode: "gemini",
  source: "gemini",
};

async function mockGenerate(page: Page) {
  await page.route("**/api/generate", async (route) => {
    const lines = [
      { type: "progress", phase: "plan", tables: [] },
      { type: "progress", phase: "erd", tables: ["members", "meetings"] },
      { type: "result", payload: GENERATED },
    ];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
  });
}

test.describe("AI flows (mocked AI, real Postgres)", () => {
  test("generate: schema loads, safe fixes are applied automatically", async ({ page }) => {
    await mockGenerate(page);
    await openApp(page);
    await page.getByLabel("System description").fill("A book club with members and meetings");
    await page.getByLabel("System description").press("Enter");
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await expect(page.getByText(/Tidied \d+ design details? automatically/)).toBeVisible();
    // REAL money became NUMERIC and the FK got an index; judgement calls
    // (like whether email must be unique) stay listed for the user.
    await openChecks(page);
    await expect(page.getByText(/stores money as/)).toHaveCount(0);
    await expect(page.getByText(/has no index/)).toHaveCount(0);
  });

  test("Ask AI to fix: a broken CHECK is removed, verified in Postgres, applied", async ({ page }) => {
    await page.route("**/api/edit", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.mode).toBe("fix");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ summary: "Remove the CHECK that calls a missing function.", operations: [{ op: "drop_check", table: "people", expression: "is_valid_email(email)" }] }),
      });
    });
    await openApp(page);
    await importSql(page, "CREATE TABLE people (id SERIAL PRIMARY KEY, email TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT now());");
    await page.locator(".react-flow__node", { hasText: "people" }).click();
    await page.getByLabel("New CHECK constraint").fill("is_valid_email(email)");
    await page.getByLabel("New CHECK constraint").press("Enter");
    await runTests(page);
    await expect(checksBar(page)).toContainText(/[1-9] errors?/);
    await openChecks(page);
    await page.getByRole("button", { name: "Ask AI to fix" }).first().click();
    await expect(page.getByText("Re-tested in Postgres: this fixes it.")).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: "Apply fix" }).click();
    await expect(checksBar(page)).toContainText("0 errors", { timeout: 45_000 });
    await expect(checksBar(page)).toContainText(/Postgres: \d+ passed/);
  });

  test("Ask AI to fix refuses to delete unrelated tables and says it isn't fixed", async ({ page }) => {
    await page.route("**/api/edit", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: "Start over.", operations: [{ op: "drop_table", table: "people" }] }) })
    );
    await openApp(page);
    await importSql(page, "CREATE TABLE people (id SERIAL PRIMARY KEY, email TEXT NOT NULL CHECK (missing_fn(email)), created_at TIMESTAMP NOT NULL DEFAULT now());".replace(" CHECK (missing_fn(email))", ""));
    await page.locator(".react-flow__node", { hasText: "people" }).click();
    await page.getByLabel("New CHECK constraint").fill("missing_fn(email)");
    await page.getByLabel("New CHECK constraint").press("Enter");
    await runTests(page);
    await openChecks(page);
    await page.getByRole("button", { name: "Ask AI to fix" }).first().click();
    await expect(page.getByText("Not fixed yet:")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/blocked: a fix never deletes a table/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply anyway" })).toBeDisabled();
    await expect(page.locator(".react-flow__node", { hasText: "people" })).toBeVisible();
  });

  test("Ask AI to change: preview, apply, undo", async ({ page }) => {
    await page.route("**/api/edit", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ summary: "Add a phone column.", operations: [{ op: "add_column", table: "people", column: { name: "phone", type: "TEXT", nullable: true } }] }),
      })
    );
    await openApp(page);
    await importSql(page, "CREATE TABLE people (id SERIAL PRIMARY KEY, email TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT now());");
    await page.getByLabel("Ask AI to change the schema").fill("add a phone number");
    await page.getByLabel("Ask AI to change the schema").press("Enter");
    await expect(page.getByText("Add a phone column.")).toBeVisible();
    await page.getByRole("button", { name: "Apply changes" }).click();
    await expect(page.locator(".react-flow__node", { hasText: "phone" })).toBeVisible();
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.locator(".react-flow__node", { hasText: "phone" })).toHaveCount(0);
  });

  test("Review with AI lists findings that can be dismissed", async ({ page }) => {
    await page.route("**/api/assist", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ findings: [{ severity: "warning", table: "people", title: "No way to mark a person inactive", detail: "The requirement mentions leaving.", fix_request: "add people.left_at TIMESTAMP" }] }),
      })
    );
    await openApp(page);
    await importSql(page, "CREATE TABLE people (id SERIAL PRIMARY KEY, email TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT now());");
    await openChecks(page);
    await page.getByRole("button", { name: "Review with AI" }).click();
    await expect(page.getByText("No way to mark a person inactive")).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: "No way to mark a person inactive" }).getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("No way to mark a person inactive")).toHaveCount(0);
  });
});
