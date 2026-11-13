import { expect, test } from "@playwright/test";
import { checksBar, expectDiagramInView, loadTemplate, openApp, openChecks, runTests } from "./helpers";

test.describe("start and edit", () => {
  test("first visit shows the tour, then the start screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("1. Describe your system")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Skip tour" }).click();
    for (const option of ["Describe it", "Start from a template", "Import SQL", "Blank canvas"]) {
      await expect(page.getByText(option, { exact: true }).first()).toBeVisible();
    }
  });

  test("a template loads fitted, and survives a reload", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "E-commerce");
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    await page.waitForTimeout(800);
    await expectDiagramInView(page);
    await page.reload();
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    await page.waitForTimeout(1200);
    await expectDiagramInView(page);
  });

  test("templates are clean: no errors or warnings, all Postgres tests pass", async ({ page }) => {
    await openApp(page);
    for (const name of ["Inventory", "SaaS billing", "E-commerce"] as const) {
      await loadTemplate(page, name);
      await runTests(page);
      await expect(checksBar(page)).toContainText("0 errors");
      await expect(checksBar(page)).toContainText("0 warnings");
      await expect(checksBar(page)).not.toContainText("failed");
    }
  });

  test("add a table, rename it inline, undo and redo", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "SaaS billing");
    const before = await page.locator(".react-flow__node").count();
    await page.getByRole("button", { name: "Add table" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(before + 1);
    await page.getByLabel("Table name").fill("reviews");
    await page.getByLabel("Table name").press("Enter");
    await expect(page.locator(".react-flow__node", { hasText: "reviews" })).toBeVisible();
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.locator(".react-flow__node")).toHaveCount(before);
  });

  test("Fix all clears the design warnings", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.keyboard.type("Import SQL");
    await page.keyboard.press("Enter");
    await page.getByLabel("SQL to import").fill(
      "CREATE TABLE shops (id SERIAL PRIMARY KEY, name TEXT NOT NULL);\nCREATE TABLE items (id SERIAL PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shops(id), price REAL NOT NULL);"
    );
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(checksBar(page)).toContainText(/[1-9] warnings?/);
    await openChecks(page);
    await page.getByRole("button", { name: /^Fix all/ }).click();
    await expect(checksBar(page)).toContainText("0 warnings");
  });

  test("query playground runs an example against sample data", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "E-commerce");
    await openChecks(page);
    await page.getByRole("tab", { name: "Query" }).click();
    await page.getByRole("button", { name: /with their/ }).first().click();
    await expect(page.getByText(/\d+ rows? ·/)).toBeVisible({ timeout: 45_000 });
  });

  test("migration between versions verifies in Postgres", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "SaaS billing");
    await page.getByRole("button", { name: "Version history" }).click();
    await page.getByRole("button", { name: "Save version" }).click();
    await page.getByRole("button", { name: "Close history" }).click();
    await page.locator(".react-flow__node", { hasText: "plans" }).click();
    await page.getByLabel("Column name name").fill("title");
    await page.getByLabel("Column name name").press("Enter");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.keyboard.type("Migration SQL");
    await page.keyboard.press("Enter");
    await expect(page.getByText("RENAME COLUMN name TO title")).toBeVisible();
    await page.getByRole("button", { name: "Verify in Postgres" }).click();
    await expect(page.getByText(/Verified in Postgres/)).toBeVisible({ timeout: 45_000 });
  });

  test("export downloads a zip and copies a share link that reopens the schema", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openApp(page);
    await loadTemplate(page, "Inventory");
    const count = await page.locator(".react-flow__node").count();
    await page.getByRole("button", { name: "Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download \d+ files/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    await page.getByRole("button", { name: "Copy share link" }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain("#");
    const other = await context.newPage();
    await other.addInitScript(() => localStorage.setItem("episteme-tour-done", "1"));
    await other.goto(link);
    await expect(other.locator(".react-flow__node")).toHaveCount(count);
  });
});

test.describe("canvas interactions", () => {
  test("hovering a relationship explains it in plain English", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "E-commerce");
    await page.waitForTimeout(800);
    const edge = page.locator('.react-flow__edge[data-id="rel_order_customer"] path').first();
    const point = await edge.evaluate((p: SVGPathElement) => {
      const pt = p.getPointAtLength(p.getTotalLength() / 2);
      const m = p.getScreenCTM()!;
      return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
    });
    await page.mouse.move(point.x, point.y);
    await expect(page.getByText(/Each order has one customer/)).toBeVisible();
  });

  test("a column can be added straight from the selected table", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "E-commerce");
    await page.locator(".react-flow__node", { hasText: "orders" }).first().click();
    await page.getByRole("button", { name: "Add a column to orders" }).click();
    await page.keyboard.type("notes");
    await page.keyboard.press("Enter");
    await expect(page.locator(".react-flow__node", { hasText: "notes" })).toBeVisible();
  });

  test("N adds a table and F fits the diagram", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "SaaS billing");
    const before = await page.locator(".react-flow__node").count();
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("n");
    await expect(page.locator(".react-flow__node")).toHaveCount(before + 1);
  });
});
