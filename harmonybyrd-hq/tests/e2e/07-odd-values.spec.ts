import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, headRevision, SCREENS, signIn, test } from "./support";

/**
 * Screens never fail on an odd stored value (round 3, G1f). Records are stored, as the owner and as an
 * import would, with values of the wrong kind in their fields (see plant-odd-values.ts): what an older
 * pack, or a caller that went round the application, could leave behind. Every screen that shows them
 * must answer 200, raise no page error, and show the odd value as not valid, never as an acceptance or
 * as some other value.
 *
 * Runs last: it adds records to the shared test database, which no earlier spec expects.
 */

const ROOT = path.resolve(__dirname, "..", "..");

function plant(which: "named" | "fuzz" | "screens"): { type: string; id: string }[] {
  const run = spawnSync("npx", ["tsx", "tests/e2e/plant-odd-values.ts", which], { cwd: ROOT, encoding: "utf8", env: process.env });
  expect(run.status, run.stderr).toBe(0);
  const lines = run.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]) as { type: string; id: string }[];
}

function detailHref(type: string, id: string): string {
  const safe = encodeURIComponent(id);
  if (type === "module") return `/modules/${safe}`;
  if (type === "loop") return `/loops/${safe}`;
  if (type === "requirement") return `/requirements/${safe}`;
  return `/records/${type}/${safe}`;
}

/** Every list screen, with each of its tabs and views. */
const LISTS = [
  ...SCREENS.map((s) => s.path),
  "/modules?view=lifecycle",
  ...["chain", "commissions", "builds", "evidence", "defects", "open"].map((tab) => `/evidence?tab=${tab}`),
  "/search?q=odd",
  "/search?q=FX",
];

interface Visit {
  url: string;
  status: number | null;
  problem: string | null;
}

/**
 * The headings HQ shows in place of a screen that failed: the screen's own error page (error.tsx), and
 * the navigation's (layout.tsx), which replaces every screen when the records cannot be read. Both
 * come with status 200 once the page has started streaming, so the status alone does not tell.
 */
const FAILED_SCREEN = /^(This screen could not be shown|HQ could not load its records)$/;

/** Load a page and report what went wrong, if anything: a status other than 200, a page error, a failed screen, or no heading. */
async function visit(page: Page, url: string, pageErrors: string[]): Promise<Visit> {
  const before = pageErrors.length;
  const response = await page.goto(url);
  const status = response?.status() ?? null;
  const headings = await page.locator("main h1").allInnerTexts();
  let problem: string | null = null;
  if (status !== 200) problem = `HTTP ${status}`;
  else if (pageErrors.length > before) problem = pageErrors.slice(before).join("; ");
  else if (headings.length === 0) problem = "no heading";
  else if (headings.some((h) => FAILED_SCREEN.test(h.trim()))) problem = `failed screen: ${headings.join(" / ")}`;
  return { url, status, problem };
}

/** Links inside main that lead to another screen of HQ (not to a form action, a file or another revision). */
async function screenLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator("main a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.filter((h) => !h.startsWith("/api/") && !h.includes("rev=") && !h.startsWith("/sign-") && !h.includes("#"));
}

test.describe("screens show odd stored values as not valid (G1f)", () => {
  test.describe.configure({ timeout: 600_000 });

  test("the named cases: an array as a build standing, a number as a lifecycle state, an object as an evidence type, null as a defect status", async ({ page }) => {
    plant("named");
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await signIn(page, "founder");

    const failures: Visit[] = [];
    const check = async (url: string) => {
      const v = await visit(page, url, pageErrors);
      if (v.problem) failures.push(v);
      return v;
    };

    // The build: its own page, the module it belongs to, the register and the dashboard.
    await check("/records/build/BLD-ODD-ARRAY");
    const facts = page.locator(".card", { has: page.getByRole("heading", { name: "Build", exact: true }) });
    await expect(facts).toContainText("Not a valid value");
    await expect(facts).not.toContainText("Acceptance reported in source");
    // ROUND4 H6a: a record that fails validation counts for no acceptance; its status says it is not reliable.
    await expect(page.locator(".card", { has: page.getByRole("heading", { name: "Acceptance status" }) })).toContainText("Not reliable — this record cannot be read in full");
    await expect(page.locator("main")).toContainText("This record as stored does not pass validation.");
    await expect(page.locator("pre.json")).toContainText('"standing": [');
    await check("/records/build/BLD-ODD-STRING");
    await expect(facts).toContainText("Not a valid value");
    await expect(facts).not.toContainText("Accepted");
    await check("/modules/MOD-FX-ALPHA");
    // (In the module's builds; since ROUND4 H6b the record is also listed, as one HQ cannot read, at the top of the page.)
    // ROUND5 K6: in a list, a record HQ cannot read shows "Not counted — cannot be read" in place of its status.
    const NOT_COUNTED = "Not counted — cannot be read";
    await expect(page.locator("#builds li", { hasText: "odd-standing-build" }).first()).toContainText(NOT_COUNTED);
    await check("/evidence?tab=builds");
    await expect(page.locator("tr", { hasText: "odd-standing-build" }).first()).toContainText(NOT_COUNTED);
    await expect(page.locator("tr", { hasText: "odd-word-build" }).first()).toContainText(NOT_COUNTED);

    // The module with a number as a lifecycle state.
    await check("/modules/MOD-ODD-NUMBER");
    await expect(page.locator("main")).toContainText("Not a valid value");
    // ROUND5 K6: the module's own record fails validation, so no dimension shows a state: each says it is not counted.
    await expect(page.locator(".lc-row", { hasText: NOT_COUNTED })).toHaveCount(12);
    await expect(page.locator(".lc-row .lc-dot")).toHaveCount(0);
    await check("/modules?view=lifecycle");
    const oddRow = page.locator("tr", { hasText: "Odd lifecycle module" }).first();
    await expect(oddRow).toContainText("Not reliable");
    await expect(oddRow.locator(".lc-invalid")).toHaveCount(12);
    await expect(oddRow.locator(".lc-invalid").first()).toHaveAttribute("title", /: Not counted — cannot be read/);
    await check("/modules");
    await check("/");

    // The evidence with an object as its type: never shown as a founder acceptance.
    await check("/records/evidence/EV-ODD-OBJECT");
    const evFacts = page.locator(".card", { has: page.getByRole("heading", { name: "Evidence", exact: true }) });
    await expect(evFacts).toContainText("Not a valid value");
    await expect(evFacts).not.toContainText("Founder acceptance");
    await check("/evidence?tab=evidence");
    await expect(page.locator("tr", { hasText: "Odd type evidence" }).first()).toContainText(NOT_COUNTED);

    // The defect with null as its status.
    await check("/records/defect/DEF-ODD-NULL");
    await expect(page.locator(".card", { has: page.getByRole("heading", { name: "Defect", exact: true }) })).toContainText("Not a valid value");
    await check("/evidence?tab=defects");
    await expect(page.locator("tr", { hasText: "Odd status defect" }).first()).toContainText(NOT_COUNTED);

    // The requirement with a number as its disposition and a list as its implementation state.
    await check("/requirements/FR-ODD-NUMBER");
    await expect(page.locator("main")).toContainText("Not a valid value");
    await check("/requirements");
    await expect(page.locator("tr", { hasText: "Odd disposition requirement" }).first()).toContainText(NOT_COUNTED);

    for (const url of LISTS) await check(url);
    for (const [type, id] of [["build", "BLD-ODD-ARRAY"], ["module", "MOD-ODD-NUMBER"], ["evidence", "EV-ODD-OBJECT"], ["defect", "DEF-ODD-NULL"], ["requirement", "FR-ODD-NUMBER"]]) {
      await check(`/proposals/new?type=${type}&id=${encodeURIComponent(id)}`);
      await check(`/records/${type}/${encodeURIComponent(id)}`);
    }
    expect(failures, "every screen answers 200 with its heading and no page error").toEqual([]);
  });

  test("every field of a record of every type, holding a value of every wrong kind: every screen that shows them still works", async ({ page }) => {
    // Open proposals too, so that their review pages, which work out what else refers to the target,
    // are visited with the odd records in the dataset.
    await signIn(page, "developer");
    const rev = await headRevision(page);
    const version = async (type: string, id: string) =>
      ((await (await page.request.get(`/api/v1/tools/get_record?type=${type}&id=${id}`)).json()) as { data: { meta: { version: number } } }).data.meta.version;
    for (const [type, id, set] of [
      ["module", "MOD-FX-ALPHA", { summary: "Alpha, reworded while odd records are stored (browser test)." }],
      // FR-FX-002: FR-FX-001 is implemented and tested, which a proposal can no longer change (ROUND5 K2).
      ["requirement", "FR-FX-002", { title: "A requirement, reworded while odd records are stored (browser test)" }],
      ["defect", "DEF-FX-02", { title: "A defect, reworded while odd records are stored (browser test)" }],
    ] as const) {
      const res = await page.request.post("/api/v1/tools/submit_change_proposal", {
        data: { base_rev: rev, title: `Reword ${id}`, rationale: "Browser test: a proposal open while odd records are stored.", target: { type, id, base_version: await version(type, id) }, set },
      });
      expect(res.status(), await res.text()).toBe(200);
    }

    const planted = plant("fuzz");
    expect(planted.length, "12 types × 7 values × 4 ways").toBe(336);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.context().clearCookies();
    await signIn(page, "founder");

    const seen = new Set<string>();
    const failures: Visit[] = [];
    const queue: string[] = [...LISTS];
    for (const { type, id } of planted) {
      queue.push(detailHref(type, id), `/records/${type}/${encodeURIComponent(id)}`);
      if (type !== "decision") queue.push(`/proposals/new?type=${type}&id=${encodeURIComponent(id)}`);
    }
    // The list screens, every planted record's pages, and every screen one link away from a list screen
    // (record pages of what the odd records point at, health and missing-information lists, review kinds).
    const fromLists = new Set(LISTS);
    while (queue.length) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const v = await visit(page, url, pageErrors);
      if (v.problem) failures.push(v);
      if (fromLists.has(url) && !v.problem) for (const link of await screenLinks(page)) if (!seen.has(link)) queue.push(link);
    }
    expect(seen.size, "pages visited").toBeGreaterThan(planted.length * 2);
    expect(failures, "every screen answers 200 with its heading and no page error").toEqual([]);

    // Showing them never makes an acceptance: none of the odd records is counted as accepted or
    // reported as accepted, whatever it holds (a list holding "accepted_reported", an object with state "yes").
    for (const url of ["/health/acceptance_reported_only", "/health/accepted_in_hq", "/modules?view=lifecycle"]) {
      const v = await visit(page, url, pageErrors);
      if (v.status === 404) continue; // a health list this version does not have
      expect(v.problem, url).toBeNull();
      const rows = url.startsWith("/modules") ? page.locator("tr", { hasText: "-ODD-" }).locator(".lc-yes") : page.locator("main li", { hasText: "-ODD-" });
      expect(await rows.count(), `${url}: no odd record counts as accepted`).toBe(0);
    }
  });
});

test.describe("ROUND4 H6 and H1: the screens verifier's records", () => {
  test.describe.configure({ timeout: 120_000 });
  let planted: { type: string; id: string }[] = [];
  const pageErrors: string[] = [];
  test.beforeAll(() => {
    planted = plant("screens");
  });
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.context().clearCookies();
    await signIn(page, "developer");
  });
  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("H6c (Y16): the propose form prefills from the record as stored, offers only declared fields, and says what a proposal may say", async ({ page }) => {
    expect(planted.map((p) => p.id)).toEqual(expect.arrayContaining(["MOD-RV3-CA", "MOD-RV3-BLK", "DEF-RV3-MODSTR", "BLD-RV3-CHK", "BLD-R4-SUBQ"]));
    const valueBox = page.getByLabel(/Proposed new value/);
    const fieldBox = page.getByLabel("Field to change");
    await page.goto("/proposals/new?type=module&id=MOD-RV3-CA");
    await fieldBox.selectOption("summary");
    await expect(valueBox).toHaveValue("7");
    await page.goto("/proposals/new?type=module&id=MOD-RV3-BLK");
    await fieldBox.selectOption("blockers");
    await expect(valueBox).toHaveValue(/RV3 BLOCKER: MIDI input is broken, do not ship/);
    await expect(valueBox).toHaveValue(/"Reported"/);
    await page.goto("/proposals/new?type=defect&id=DEF-RV3-MODSTR");
    await fieldBox.selectOption("module_ids");
    await expect(valueBox).toHaveValue('"MOD-FX-GAMMA"');
    // H1: one plain sentence on what a proposal may say.
    await expect(page.getByTestId("submitter-claim-sentence")).toContainText("Whatever you propose is recorded as your own claim");
    // H4: only the fields a record type declares are offered; a stored key it does not declare is not.
    await page.goto("/proposals/new?type=open_item&id=OPEN-R4-KEY");
    expect(await fieldBox.locator("option").allInnerTexts()).not.toContain("by_module");
    // H2: evidence a source reports is frozen: there is no form.
    await page.goto("/proposals/new?type=evidence&id=EV-FX-01");
    await expect(page.locator("main")).toContainText("Proposals cannot change this record.");
    await expect(page.locator("form textarea[name=value]")).toHaveCount(0);
  });

  test("H6b (Y15): Gamma's page, the register, the dashboard and development health say what HQ cannot read, in the API's words", async ({ page }) => {
    const brief = (await (await page.request.get("/api/v1/tools/get_module_brief?module=MOD-FX-GAMMA")).json()) as { data: { unreadable_note: string; unreadable_records: { id: string }[] } };
    expect(brief.data.unreadable_records.map((r) => r.id)).toEqual(expect.arrayContaining(["DEF-RV3-MODSTR", "OPEN-RV3-STR"]));
    await page.goto("/modules/MOD-FX-GAMMA");
    const notice = page.getByTestId("unreadable-records");
    await expect(notice).toBeVisible();
    await expect(notice.locator("strong")).toHaveText(brief.data.unreadable_note);
    await expect(notice).toContainText("DEF-RV3-MODSTR");
    await expect(notice).toContainText("OPEN-RV3-STR");
    await page.goto("/modules");
    await expect(page.getByTestId("unreadable-register")).toBeVisible();
    await expect(page.locator("tr", { hasText: "Gamma" }).first().getByTestId("unreadable-note")).toContainText(brief.data.unreadable_note);
    await expect(page.locator("tr", { hasText: "rv3 blocker module" }).first()).toContainText("Not reliable");
    await page.goto("/modules/MOD-RV3-BLK");
    await expect(page.getByTestId("unreadable-records")).toContainText("This module's own record cannot be read in full: its figures are not reliable.");
    await page.goto("/");
    await expect(page.getByTestId("unreadable-dashboard")).toBeVisible();
    await page.goto("/health/unreadable_records");
    await expect(page.locator("main h1")).toHaveText("Records HQ cannot read");
    // The list can be long (with the fuzz set stored too): it has as many items as the API's list, which holds the planted records.
    const overview = (await (await page.request.get("/api/v1/tools/get_ecosystem_overview")).json()) as { data: { health: { unreadable_records: { count: number; items: { id: string }[] } } } };
    const unreadable = overview.data.health.unreadable_records;
    for (const id of ["DEF-RV3-MODSTR", "EV-RV3-FA", "MOD-RV3-BLK"]) expect(unreadable.items.map((i) => i.id)).toContain(id);
    await expect(page.getByRole("heading", { name: `${unreadable.count} items` })).toBeVisible();
    // Y14: Beta build 2 keeps its review item.
    await page.goto("/review");
    await expect(page.locator("main")).toContainText("Beta build 2 is reported as accepted");
  });

  test("ROUND5 K6: lists and counts leave out what HQ cannot read; a module HQ cannot read shows no lifecycle state; the open-defect count is derive's", async ({ page }) => {
    const NOT_COUNTED = "Not counted — cannot be read";
    // Gamma: the invalid build reported as accepted is listed as not counted, without its standing, and not counted beside the list.
    const gammaBrief = (await (await page.request.get("/api/v1/tools/get_module_brief?module=MOD-FX-GAMMA")).json()) as { data: { builds: { ref: { id: string; readable: boolean } }[] } };
    const readableBuilds = gammaBrief.data.builds.filter((b) => b.ref.readable).length;
    const notCountedBuilds = gammaBrief.data.builds.length - readableBuilds;
    expect(gammaBrief.data.builds.find((b) => b.ref.id === "BLD-R4-ACC")!.ref.readable).toBe(false);
    await page.goto("/modules/MOD-FX-GAMMA");
    const builds = page.locator("#builds");
    await expect(builds).toContainText(`${readableBuilds} on record; ${notCountedBuilds} not counted — cannot be read`);
    const row = builds.locator("li", { hasText: "r4-accepted" });
    await expect(row).toContainText(NOT_COUNTED);
    await expect(row).not.toContainText("Acceptance reported");
    // The open-defect count beside the list is the register's (a defect HQ cannot read is open).
    const overview = (await (await page.request.get("/api/v1/tools/get_ecosystem_overview")).json()) as { data: { modules: { id: string; open_defects: number }[]; priorities: { id: string; readable: boolean }[] } };
    const gammaOpen = overview.data.modules.find((m) => m.id === "MOD-FX-GAMMA")!.open_defects;
    await expect(page.locator("#defects")).toContainText(`${gammaOpen} open of`);
    // Delta: the invalid loop that names it is listed as not counted, and gives it no loop.
    await page.goto("/modules/MOD-FX-DELTA");
    await expect(page.locator("#loops").locator("li", { hasText: "r4 loop" })).toContainText(NOT_COUNTED);
    await expect(page.locator("#loops")).not.toContainText("1 loop recovered;");
    // A module whose own record fails validation: no lifecycle state, basis or tick on its page, and its matrix row is marked.
    await page.goto("/modules/MOD-RV3-BLK");
    const lifecycle = page.locator("#lifecycle");
    await expect(lifecycle).toContainText(NOT_COUNTED);
    await expect(lifecycle).not.toContainText("Checked by HQ's build");
    await expect(lifecycle.locator(".lc-yes")).toHaveCount(0);
    await page.goto("/modules?view=lifecycle");
    const matrixRow = page.locator("tr", { hasText: "rv3 blocker module" });
    await expect(matrixRow).toContainText("Not reliable");
    await expect(matrixRow.locator(".lc-yes, .lc-partial")).toHaveCount(0);
    // The register's builds tab: the invalid build has no standing chip.
    await page.goto("/evidence?tab=builds");
    await expect(page.locator("tr", { hasText: "r4-accepted" })).toContainText(NOT_COUNTED);
    await expect(page.locator("tr", { hasText: "r4-accepted" })).not.toContainText("Acceptance reported");
    // The dashboard: the recommendation HQ cannot read comes last and says it is not counted; its blocker is not hidden.
    const order = overview.data.priorities.map((p) => p.id);
    expect(order.indexOf("REC-RV3-BLK")).toBeGreaterThan(order.indexOf("REC-FX-02"));
    expect(overview.data.priorities.find((p) => p.id === "REC-RV3-BLK")!.readable).toBe(false);
    await page.goto("/");
    const rec = page.locator("li", { hasText: "rv3 blocked recommendation" });
    await expect(rec).toContainText(NOT_COUNTED);
    await expect(rec).toContainText("Blocked by: Not readable — see the stored record.");
  });

  test("H6e (Y18) and H6d (Y17): a check whose result is not valid has no tick, and no attribution is made up", async ({ page }) => {
    await page.goto("/records/build/BLD-RV3-CHK");
    const failed = page.locator("li", { hasText: "opens in a browser" });
    await expect(failed).toContainText("Not a valid value");
    await expect(failed).not.toContainText("Checked");
    // On a record HQ cannot read in full, no check is counted.
    await expect(page.locator("li", { hasText: "sha256 matches" })).toContainText("Not counted");
    await page.goto("/records/recommendation/REC-RV3-BLK");
    await expect(page.locator("main")).toContainText("This recommendation names no maker HQ can read.");
    await expect(page.locator("main")).not.toContainText("This is a recommendation by HQ builder");
  });

  test("L8 (Y15): an invalid record's own page never says a list it cannot read holds nothing", async ({ page }) => {
    await page.goto("/records/recommendation/REC-RV3-BLK");
    const main = page.locator("main");
    // blocked_by is stored as a string: the view's list is empty, and the page says it cannot read it.
    const blocked = page.locator("dt", { hasText: "Blocked by" }).locator("xpath=following-sibling::dd[1]");
    await expect(blocked).toHaveText("Not readable — see the stored record");
    await expect(main).not.toContainText("Nothing recorded as blocking");
    await expect(page.getByTestId("unreadable-fields")).toContainText("blocked_by");
    // Control: a valid recommendation with nothing blocking it still says so.
    await page.goto("/records/recommendation/REC-FX-01");
    await expect(page.locator("dt", { hasText: "Blocked by" }).locator("xpath=following-sibling::dd[1]")).toHaveText("Nothing recorded as blocking.");
  });

  test("H1: a submitter's claim is never headed as what a source says, and its quotation is the submitter's", async ({ page }) => {
    await page.goto("/records/build/BLD-R4-SUBQ");
    const build = page.locator(".card", { has: page.getByRole("heading", { name: "Build", exact: true }) });
    await expect(build).toContainText("What the submitter says");
    await expect(build).not.toContainText("What the source says");
    await expect(build.locator("details.cites summary")).toHaveText("1 quotation quoted by the submitter — HQ checked the words are in the source, not that they support this");
    // Control: a build a source reports keeps its heading and its plain quotation label.
    await page.goto("/records/build/BLD-FX-01");
    const control = page.locator(".card", { has: page.getByRole("heading", { name: "Build", exact: true }) });
    await expect(control).toContainText("What the source says");
    await expect(control.locator("details.cites summary").first()).toHaveText(/source quotation/);
  });
});
