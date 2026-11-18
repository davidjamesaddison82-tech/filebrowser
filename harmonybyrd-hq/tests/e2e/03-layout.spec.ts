import type { Page } from "@playwright/test";
import { DETAIL_SCREENS, expect, SCREENS, signIn, test } from "./support";

/**
 * Acceptance check 11: responsive laptop layouts without overlays covering content, plus a useful phone view.
 *
 * For every screen and size the test measures, in the real browser:
 *   - the page does not scroll sideways;
 *   - the heading is on screen and nothing is drawn on top of it;
 *   - no fixed or sticky element other than the side navigation covers a meaningful part of the window;
 *   - the side navigation and the content do not overlap.
 */
const LAPTOPS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
];
const PHONE = { width: 390, height: 844 };
const ALL = [...SCREENS.map((s) => s.path), ...DETAIL_SCREENS.map((s) => s.path)];

async function measure(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    const h1 = document.querySelector("main h1");
    const r = h1?.getBoundingClientRect();
    let headingUncovered = false;
    if (h1 && r) {
      const x = Math.min(r.left + 24, vw - 2);
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      headingUncovered = !!top && (top === h1 || h1.contains(top) || top.contains(h1));
    }
    const overlays: { what: string; share: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      const w = Math.min(b.right, vw) - Math.max(b.left, 0);
      const h = Math.min(b.bottom, vh) - Math.max(b.top, 0);
      if (w <= 0 || h <= 0) continue;
      if (el.closest("aside.nav")) continue; // the side navigation is measured separately
      if (el.closest("table")) continue; // sticky table headings and first columns stay inside their own table
      overlays.push({ what: `${el.tagName.toLowerCase()}.${el.className}`, share: (w * h) / (vw * vh) });
    }
    const nav = document.querySelector("aside.nav")?.getBoundingClientRect();
    const main = document.querySelector("main")?.getBoundingClientRect();
    return {
      sidewaysScroll: doc.scrollWidth - vw,
      headingTop: r ? r.top : null,
      headingUncovered,
      overlays,
      navRight: nav ? nav.right : 0,
      navBottom: nav ? nav.bottom : 0,
      mainLeft: main ? main.left : 0,
      mainTop: main ? main.top : 0,
      devOverlay: !!document.querySelector("nextjs-portal"),
    };
  });
}

for (const size of LAPTOPS) {
  test.describe(`laptop ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("no screen scrolls sideways, and nothing covers the content", async ({ page }) => {
      await signIn(page, "founder");
      for (const path of ALL) {
        await page.goto(path);
        const m = await measure(page);
        expect(m.sidewaysScroll, `${path}: sideways scroll in pixels`).toBeLessThanOrEqual(1);
        expect(m.headingTop, `${path}: heading present`).not.toBeNull();
        expect(m.headingTop!, `${path}: heading is within the first screen`).toBeLessThan(size.height * 0.6);
        expect(m.headingUncovered, `${path}: nothing is drawn over the heading`).toBe(true);
        expect(m.devOverlay, `${path}: no development overlay`).toBe(false);
        for (const o of m.overlays) expect(o.share, `${path}: ${o.what} covers too much of the window`).toBeLessThan(0.12);
        expect(m.navRight, `${path}: navigation does not overlap the content`).toBeLessThanOrEqual(m.mainLeft + 1);

        // Scrolled to the end, the last content is still reachable and uncovered.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const end = await page.evaluate(() => {
          const main = document.querySelector("main")!;
          const b = main.getBoundingClientRect();
          const y = Math.min(b.bottom, window.innerHeight) - 12;
          const x = b.left + b.width / 2;
          const top = document.elementFromPoint(x, y);
          return !!top && (main.contains(top) || top.contains(main));
        });
        expect(end, `${path}: the end of the page is not covered`).toBe(true);
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
      const m = await measure(page);
      expect(m.sidewaysScroll, `${path}: sideways scroll in pixels`).toBeLessThanOrEqual(1);
      expect(m.headingUncovered, `${path}: nothing is drawn over the heading`).toBe(true);
      for (const o of m.overlays) expect(o.share, `${path}: ${o.what} covers too much of the window`).toBeLessThan(0.2);
    }
  });

  test("the menu opens, navigates and closes", async ({ page }) => {
    await signIn(page, "founder");
    await page.goto("/");
    const modules = page.locator("a.nav-link", { hasText: "Modules" });
    await expect(modules).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(modules).toBeVisible();
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
