import { expect, type Page } from "@playwright/test";

/** Fresh app with the first-run tour and phone hint already dismissed. */
export async function openApp(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("episteme-tour-done", "1");
    localStorage.setItem("episteme-small-screen-hint", "1");
  });
  await page.goto("/");
  await expect(page.getByText("Design a database")).toBeVisible();
}

export async function loadTemplate(page: Page, name: "Inventory" | "SaaS billing" | "E-commerce") {
  // Through the command palette, which works at every screen size.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.keyboard.type(`New from template: ${name}`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

/** Import SQL as a new project through the Import dialog. */
export async function importSql(page: Page, sql: string) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.keyboard.type("Import SQL");
  await page.keyboard.press("Enter");
  await page.getByLabel("SQL to import").fill(sql);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

export function checksBar(page: Page) {
  return page.getByRole("button", { name: /show checks|hide checks/i });
}

export async function openChecks(page: Page) {
  const bar = checksBar(page);
  if ((await bar.getAttribute("aria-expanded")) !== "true") await bar.click();
}

export async function runTests(page: Page) {
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(checksBar(page)).toContainText(/Postgres: \d+ passed/, { timeout: 45_000 });
}

/** Every table node lies inside the visible canvas. */
export async function expectDiagramInView(page: Page) {
  const pane = await page.locator(".react-flow").boundingBox();
  const boxes = await page.locator(".react-flow__node").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
  expect(pane).not.toBeNull();
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(pane!.x - 2);
    expect(box.right).toBeLessThanOrEqual(pane!.x + pane!.width + 2);
    expect(box.top).toBeGreaterThanOrEqual(pane!.y - 2);
    expect(box.bottom).toBeLessThanOrEqual(pane!.y + pane!.height + 2);
  }
}
