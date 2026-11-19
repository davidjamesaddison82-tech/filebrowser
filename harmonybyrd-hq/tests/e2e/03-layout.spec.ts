import { coveringsTopAndEnd, measureLayout } from "./layout-measure";
import { DETAIL_SCREENS, expect, SCREENS, signIn, test } from "./support";

/**
 * Acceptance check 11: responsive laptop layouts without overlays covering content, plus a useful phone view.
 *
 * For every screen and size the test measures, in the real browser:
 *   - the page does not scroll sideways (scroll width against the layout viewport, and against the
 *     configured window width: a phone browser widens its viewport to fit overflowing content, F10);
 *   - the heading is on screen and nothing is drawn on top of it;
 *   - nothing is drawn over the content, at the top of the page and scrolled to its end: no fixed,
 *     sticky or absolutely positioned element covers any text (whatever its size) or a large part of
 *     the content, and a grid of points over <main> shows <main> everywhere (see layout-measure.ts,
 *     whose detector is itself tested in 03b-layout-detector.spec.ts);
 *   - the side navigation and the content do not overlap.
 */
const LAPTOPS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
];
const PHONE = { width: 390, height: 844 };
const ALL = [...SCREENS.map((s) => s.path), ...DETAIL_SCREENS.map((s) => s.path)];

for (const size of LAPTOPS) {
  test.describe(`laptop ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("no screen scrolls sideways, and nothing covers the content", async ({ page }) => {
      await signIn(page, "founder");
      for (const path of ALL) {
        await page.goto(path);
        const m = await measureLayout(page);
        expect(m.sidewaysScroll, `${path}: sideways scroll in pixels`).toBeLessThanOrEqual(1);
        expect(m.scrollWidth, `${path}: page width against the ${size.width} px window`).toBeLessThanOrEqual(size.width + 1);
        expect(m.headingTop, `${path}: heading present`).not.toBeNull();
        expect(m.headingTop!, `${path}: heading is within the first screen`).toBeLessThan(size.height * 0.6);
        expect(m.headingUncovered, `${path}: nothing is drawn over the heading`).toBe(true);
        expect(m.devOverlay, `${path}: no development overlay`).toBe(false);
        expect(m.navRight, `${path}: navigation does not overlap the content`).toBeLessThanOrEqual(m.mainLeft + 1);

        // Nothing covers the content, at the top and scrolled to the end of the page.
        const { top, end } = await coveringsTopAndEnd(page);
        expect(top.coverings, `${path}: nothing covers the content`).toEqual([]);
        expect(end.coverings, `${path}: nothing covers the end of the page`).toEqual([]);
      }
    });
  });
}

test.describe("phone 390x844", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("no screen scrolls sideways and the heading is readable under the top bar", async ({ page }) => {
    await signIn(page, "founder");
    for (const path of ALL) {
      await page.goto(path);
      const m = await measureLayout(page);
      expect(m.sidewaysScroll, `${path}: sideways scroll in pixels`).toBeLessThanOrEqual(1);
      // A mobile browser widens its layout to fit content that overflows, so the page is also held to
      // the configured screen width (F10).
      expect(m.scrollWidth, `${path}: page width against the ${PHONE.width} px screen`).toBeLessThanOrEqual(PHONE.width + 1);
      expect(m.headingUncovered, `${path}: nothing is drawn over the heading`).toBe(true);
      const { top, end } = await coveringsTopAndEnd(page);
      expect(top.coverings, `${path}: nothing covers the content`).toEqual([]);
      expect(end.coverings, `${path}: nothing covers the end of the page`).toEqual([]);
    }
  });

  test("the menu opens, navigates and closes", async ({ page }) => {
    await signIn(page, "founder");
    await page.goto("/");
    const modules = page.locator("a.nav-link", { hasText: "Modules" });
    await expect(modules).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(modules).toBeVisible();
    // The open menu pushes the content down; it is not drawn over it.
    const open = await measureLayout(page);
    expect(open.coverings, "the open menu covers nothing").toEqual([]);
    await modules.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Module atlas");
    await expect(page.locator("a.nav-link", { hasText: "Dashboard" })).toBeHidden();
  });

  test("a module can be reached and read from the dashboard", async ({ page }) => {
    await signIn(page, "founder");
    await page.goto("/");
    const link = page.locator('main a[href="/modules/MOD-FX-ALPHA"]').first();
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alpha (fixture)");
  });
});
