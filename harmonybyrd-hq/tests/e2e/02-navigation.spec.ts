import { DETAIL_SCREENS, expect, headRevision, SCREENS, signIn, test, UNPINNABLE } from "./support";

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
      // tests-12: the list page's own count heading states exactly the tile's figure (not just any
      // number somewhere on the page), and lists that many entries (a long list is paged).
      await expect(page.locator("main .card-head h2").first(), tile.href).toHaveText(`${figure} ${figure === 1 ? "item" : "items"}`);
      const listed = await page.locator("main .card ul.list > li").count();
      if ((await page.locator("main .pager-top").count()) === 0) expect(listed, `${tile.href}: entries listed`).toBe(figure);
      else expect(listed, `${tile.href}: a first page of entries`).toBeLessThan(figure);
      if (figure === 0) await expect(page.locator("main")).toContainText("Nothing falls under this heading");
    }
  });

  test("tested and accepted are never shown as the same thing", async ({ page }) => {
    await page.goto("/modules/MOD-FX-ALPHA");
    await expect(page.locator("main")).toContainText("Tested — not accepted");
    await expect(page.locator("main")).toContainText(/Passing tests are not founder acceptance/i);
    await page.goto("/");
    // tests-12: not just that both labels appear — Alpha is counted under "tested, not accepted" and
    // nowhere as accepted. Nothing in the fixture carries an HQ acceptance, so that figure is 0.
    const tile = (key: string) => page.locator(`main a.tile[href="/health/${key}"]`);
    await expect(tile("accepted_in_hq").locator(".n")).toHaveText("0");
    await expect(tile("accepted_in_hq")).toContainText("Founder acceptance recorded in HQ");
    const tested = Number(await tile("tested_not_accepted").locator(".n").textContent());
    expect(tested).toBeGreaterThanOrEqual(1);
    await tile("accepted_in_hq").click();
    await expect(page).toHaveURL(/\/health\/accepted_in_hq$/);
    await expect(page.locator("main")).not.toContainText("MOD-FX-ALPHA");
    await expect(page.locator("main")).toContainText("Nothing falls under this heading");
    await page.goto("/health/tested_not_accepted");
    await expect(page.locator('main a[href="/modules/MOD-FX-ALPHA"]').first()).toBeVisible();
    await expect(page.locator("main .card-head h2").first()).toHaveText(`${tested} ${tested === 1 ? "item" : "items"}`);
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

  test("an unknown record is a clear 'not found', not a blank screen", async ({ page, allowResourceStatuses }) => {
    allowResourceStatuses(404); // the page itself is the expected refusal
    const response = await page.goto("/modules/MOD-DOES-NOT-EXIST");
    expect(response?.status()).toBe(404);
  });
});

test.describe("pinned revisions and addresses that do not exist (ui-7, D14, D16)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "founder");
  });

  test("a revision that does not exist or is not a number gives the 404 page, never a 500 or the latest", async ({ page, allowResourceStatuses }) => {
    allowResourceStatuses(404); // each page below is the expected refusal
    for (const path of ["/?rev=99", "/?rev=1e9", "/?rev=abc", "/?rev=0", "/?rev=-1", "/?rev=1.5", "/modules/MOD-FX-ALPHA?rev=99", "/records/source/SRC-F01?rev=99"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    expect((await page.goto("/?rev=1"))?.status()).toBe(200);
  });

  test("a malformed percent-encoded id is refused as a bad address, not a server error", async ({ page }) => {
    for (const path of ["/records/source/%E0%A4%A", "/modules/%E0%A4%A", "/requirements/%E0%A4%A", "/loops/%E0%A4%A", "/proposals/%E0%A4%A"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      // Next.js may refuse the address itself (400) before the page sees it; the page refuses it with 404.
      expect([400, 404], path).toContain(response.status());
    }
  });

  test("while ?rev= is in the address, every screen says which revision it shows", async ({ page }) => {
    const head = await headRevision(page);
    for (const path of [...SCREENS.map((s) => s.path), ...DETAIL_SCREENS.map((s) => s.path)]) {
      await page.goto(`${path}?rev=${head}`);
      const bar = page.locator(".pinbar");
      await expect(bar, path).toBeVisible();
      if (UNPINNABLE.some((p) => path === p || path.startsWith(`${p}/`))) {
        await expect(bar, path).toContainText("this screen always shows the latest");
      } else {
        await expect(bar, path).toContainText(`You are viewing dataset revision ${head}`);
      }
      await expect(bar.getByRole("link", { name: "Return to the latest" })).toBeVisible();
      // Navigation counts are figures of the latest revision and are hidden while a revision is named.
      await expect(page.locator(".nav-count")).toHaveCount(0);
    }
    await page.goto("/modules");
    await expect(page.locator(".pinbar")).toHaveCount(0);
    expect(await page.locator(".nav-count").count()).toBeGreaterThan(0);
  });
});

test.describe("the proposal form (ui-6)", () => {
  test("an empty structured field is edited as JSON; a text field as text", async ({ page }) => {
    await signIn(page, "developer");
    await page.goto("/proposals/new?type=module&id=MOD-FX-ALPHA");
    // why_exists is empty (null) in the fixture, but the schema says it is a statement.
    await page.getByLabel("Field to change").selectOption("why_exists");
    await expect(page.locator('input[name="value_is_json"]')).toHaveValue("1");
    await expect(page.locator("label.field", { hasText: "Proposed new value" }).locator(".help")).toContainText("structured and empty now");
    await expect(page.getByLabel(/Proposed new value/)).toHaveValue("");
    await page.getByLabel("Field to change").selectOption("name");
    await expect(page.locator('input[name="value_is_json"]')).toHaveValue("0");
    await expect(page.locator("label.field", { hasText: "Proposed new value" }).locator(".help")).toHaveText("Plain text.");
  });

  test("fields only HQ's build writes are not offered", async ({ page }) => {
    await signIn(page, "developer");
    await page.goto("/proposals/new?type=build&id=BLD-FX-01");
    const options = await page.getByLabel("Field to change").locator("option").allTextContents();
    for (const f of ["hq_checks", "other_mentions", "possibly_same_as", "code_ref", "recorded_from_cluster", "hq_acceptance"]) expect(options).not.toContain(f);
  });
});
