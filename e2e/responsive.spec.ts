import { expect, test } from "@playwright/test";
import { expectDiagramInView, loadTemplate, openApp } from "./helpers";

for (const [label, viewport] of [
  ["phone", { width: 375, height: 812 }],
  ["tablet", { width: 768, height: 1024 }],
  ["laptop", { width: 1024, height: 768 }],
] as const) {
  test(`${label}: no sideways scrolling, diagram fitted, toolbar usable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    await loadTemplate(page, "SaaS billing");
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectDiagramInView(page);
    await expect(page.getByRole("button", { name: "Add table" })).toBeInViewport();
  });
}
