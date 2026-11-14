import { expect, test } from "@playwright/test";
import { loadTemplate, openApp } from "./helpers";

test.describe("keyboard and accessibility", () => {
  test("keyboard focus is clearly visible", async ({ page }) => {
    await openApp(page);
    // Tab to the first button and check its focus outline.
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.tagName === "BUTTON")) break;
    }
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { tag: el.tagName, width: style.outlineWidth, styleName: style.outlineStyle };
    });
    expect(outline.styleName).not.toBe("none");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });

  test("dialogs take focus, keep Tab inside, and give focus back", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "SaaS billing");
    const exportButton = page.getByRole("button", { name: "Export" });
    await exportButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 40; i += 1) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(exportButton).toBeFocused();
  });

  test("every button has an accessible name", async ({ page }) => {
    await openApp(page);
    await loadTemplate(page, "E-commerce");
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent !== null)
        .filter((b) => !(b.getAttribute("aria-label") || b.textContent?.trim() || b.getAttribute("title")))
        .map((b) => b.outerHTML.slice(0, 120))
    );
    expect(unnamed).toEqual([]);
  });
});
