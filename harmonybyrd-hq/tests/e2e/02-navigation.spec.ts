import { DETAIL_SCREENS, expect, SCREENS, signIn, test } from "./support";

test.describe("navigation and controls (acceptance check 10)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "founder");
  });

  test("every navigation link opens its screen", async ({ page }) => {
    for (const screen of SCREENS) {
      await page.locator("a.nav-link", { hasText: screen.nav }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(screen.h1);
      expect(new URL(page.url()).pathname).toBe(screen.path);
      await expect(page.locator('a.nav-link[aria-current="page"]')).toContainText(screen.nav);
    }
  });

  test("detail screens open with their own heading", async ({ page }) => {
    for (const screen of DETAIL_SCREENS) {
      const response = await page.goto(screen.path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(screen.h1);
    }
  });

  test("no link on any primary screen leads nowhere", async ({ page }) => {
    const seen = new Set<string>();
    const dead: string[] = [];
    for (const screen of [...SCREENS, ...DETAIL_SCREENS]) {
      await page.goto(screen.path);
      const hrefs = await page.locator("a[href]").evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "").filter((h) => h.startsWith("/") && !h.startsWith("//")),
      );
      for (const href of hrefs) {
        const target = href.split("#")[0];
        if (!target || seen.has(target)) continue;
        seen.add(target);
        const res = await page.request.get(target, { maxRedirects: 0 });
        if (res.status() !== 200) dead.push(`${res.status()} ${target} (linked from ${screen.path})`);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(dead, "links that do not resolve").toEqual([]);
  });

  test("the ecosystem map is made of real links to module briefs", async ({ page }) => {
    await page.goto("/");
    const links = page.locator('main a[href^="/modules/MOD-FX-"]');
    const hrefs = new Set(await links.evaluateAll((els) => els.map((a) => a.getAttribute("href"))));
    for (const id of ["MOD-FX-ALPHA", "MOD-FX-BETA", "MOD-FX-GAMMA", "MOD-FX-DELTA"]) expect(hrefs).toContain(`/modules/${id}`);
    await page.locator('main a[href="/modules/MOD-FX-ALPHA"]').first().click();
    await expect(page).toHaveURL(/\/modules\/MOD-FX-ALPHA$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alpha (fixture)");
  });

  test("each development-health figure opens the list it counts", async ({ page }) => {
    await page.goto("/");
    const tiles = page.locator('main a[href^="/health/"]');
    const count = await tiles.count();
    expect(count).toBeGreaterThanOrEqual(6);
    const targets = await tiles.evaluateAll((els) => els.map((a) => ({ href: a.getAttribute("href") ?? "", text: (a.textContent ?? "").trim() })));
    for (const tile of targets) {
      await page.goto(tile.href);
      await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
      const figure = Number(/^\d+/.exec(tile.text)?.[0] ?? "NaN");
      expect(Number.isNaN(figure), `tile "${tile.text.slice(0, 40)}" starts with its figure`).toBe(false);
      // The list page states the same figure the tile showed.
      await expect(page.locator("main")).toContainText(new RegExp(`\\b${figure}\\b`));
    }
  });

  test("tested and accepted are never shown as the same thing", async ({ page }) => {
    await page.goto("/modules/MOD-FX-ALPHA");
    await expect(page.locator("main")).toContainText("Tested — not accepted");
    await expect(page.locator("main")).toContainText(/Passing tests are not founder acceptance/i);
    await page.goto("/");
    await expect(page.locator("main")).toContainText("Founder acceptance recorded in HQ");
    await expect(page.locator("main")).toContainText("Tested, not accepted");
  });

  test("the dashboard has its five areas, and priorities are labelled as recommendations, not approvals", async ({ page }) => {
    await page.goto("/");
    for (const heading of ["Ecosystem overview", "Development health", "Missing and forgotten work", "Development priorities", "Recent changes"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    const priorities = page.locator("section").filter({ has: page.getByRole("heading", { name: "Development priorities" }) });
    await expect(priorities).toContainText("Recommendations are not approved work");
    await expect(priorities).toContainText("Fix the dropped last note in Alpha");
    await expect(priorities).toContainText("No work has been approved or accepted by a founder decision in HQ yet.");
  });

  test("cross-module pathways are drawn on the loop explorer", async ({ page }) => {
    await page.goto("/loops");
    const pathways = page.locator("section").filter({ has: page.getByRole("heading", { name: "Cross-module pathways" }) });
    await expect(pathways).toContainText("Alpha → Beta → Gamma (fixture)");
    for (const id of ["MOD-FX-ALPHA", "MOD-FX-BETA", "MOD-FX-GAMMA"]) await expect(pathways.locator(`a[href="/modules/${id}"]`).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "The shared progression" })).toBeVisible();
  });

  test("a module brief shows its quotations, and each quotation names its source", async ({ page }) => {
    await page.goto("/modules/MOD-FX-ALPHA");
    const first = page.locator("details.cites").first();
    await first.locator("summary").click();
    await expect(first.locator("q").first()).toBeVisible();
    const sourceLink = first.locator('a[href^="/records/source/"]').first();
    await expect(sourceLink).toBeVisible();
    await sourceLink.click();
    await expect(page).toHaveURL(/\/records\/source\/SRC-F0\d$/);
    await expect(page.locator("main")).toContainText(/sha-?256/i);
  });

  test("search finds a requirement by its wording and opens it", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("searchbox", { name: "Search HQ" });
    await box.fill("tempo");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=tempo/);
    await page.locator("main").getByRole("link", { name: /Slow tempo first/ }).first().click();
    await expect(page).toHaveURL(/\/requirements\/FR-FX-00[15]$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Slow tempo first");
  });

  test("a requirement keeps the original wording apart from HQ's interpretation", async ({ page }) => {
    await page.goto("/requirements/FR-FX-001");
    await expect(page.getByRole("heading", { name: "Original wording" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interpretation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Standing and implementation" })).toBeVisible();
    await expect(page.locator("main")).toContainText("FR-FX-001");
  });

  test("the requirements register filters by text", async ({ page }) => {
    await page.goto("/requirements?q=pop-up");
    await expect(page.locator("main")).toContainText("No pop-up windows");
    await expect(page.locator("main")).not.toContainText("Gamma waits for Alpha");
  });

  test("the loop explorer opens a loop and shows its steps", async ({ page }) => {
    await page.goto("/loops");
    await page.locator("main").getByRole("link", { name: /Pattern practice loop/ }).first().click();
    await expect(page).toHaveURL(/\/loops\/LOOP-FX-01$/);
    await expect(page.locator("main ol li, main .steps li").first()).toBeVisible();
  });

  test("the source inventory explains the governance gate", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.locator("#gate")).toContainText("HB-AI-P00");
    await expect(page.locator("#gate")).toContainText(/non-authoritative/i);
  });

  test("a record's history and lineage can be opened from its page", async ({ page }) => {
    await page.goto("/modules/MOD-FX-ALPHA");
    await page.getByRole("link", { name: "History & lineage" }).click();
    await expect(page).toHaveURL(/\/records\/module\/MOD-FX-ALPHA/);
    await expect(page.locator("main")).toContainText(/version 1/i);
  });

  test("the AI access screen separates what was tested from what was not", async ({ page }) => {
    await page.goto("/access");
    await expect(page.locator("main")).toContainText("Tested in this build");
    await expect(page.locator("main")).toContainText("Documented — not tested");
    await expect(page.locator("main")).toContainText("Blocked — needs a separate decision");
    await expect(page.locator("main")).toContainText("Neither the Claude application nor ChatGPT has been connected to HQ");
    for (const tool of ["get_ecosystem_overview", "get_module_brief", "search_founder_requirements", "submit_change_proposal", "record_test_evidence"]) {
      await expect(page.locator("main")).toContainText(tool);
    }
  });

  test("an unknown record is a clear 'not found', not a blank screen", async ({ page }) => {
    const response = await page.goto("/modules/MOD-DOES-NOT-EXIST");
    expect(response?.status()).toBe(404);
  });
});
