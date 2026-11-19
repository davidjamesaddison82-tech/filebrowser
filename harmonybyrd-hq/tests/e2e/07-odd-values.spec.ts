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

function plant(which: "named" | "fuzz"): { type: string; id: string }[] {
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
    await expect(page.locator(".card", { has: page.getByRole("heading", { name: "Acceptance status" }) })).toContainText(/not a valid value/i);
    await expect(page.locator("main")).toContainText("This record as stored does not pass validation.");
    await expect(page.locator("pre.json")).toContainText('"standing": [');
    await check("/records/build/BLD-ODD-STRING");
    await expect(facts).toContainText("Not a valid value");
    await expect(facts).not.toContainText("Accepted");
    await check("/modules/MOD-FX-ALPHA");
    await expect(page.locator("li", { hasText: "odd-standing-build" }).first()).toContainText("Not a valid value");
    await check("/evidence?tab=builds");
    await expect(page.locator("tr", { hasText: "odd-standing-build" }).first()).toContainText("Not a valid value");
    await expect(page.locator("tr", { hasText: "odd-word-build" }).first()).toContainText("Not a valid value");

    // The module with a number as a lifecycle state.
    await check("/modules/MOD-ODD-NUMBER");
    await expect(page.locator("main")).toContainText("Not a valid value");
    await expect(page.locator(".lc-row .lc-invalid")).toHaveCount(1);
    await check("/modules?view=lifecycle");
    const oddRow = page.locator("tr", { hasText: "Odd lifecycle module" }).first();
    await expect(oddRow.locator(".lc-invalid")).toHaveCount(1);
    await expect(oddRow.locator(".lc-invalid")).toHaveAttribute("title", /: Not a valid value/);
    await check("/modules");
    await check("/");

    // The evidence with an object as its type: never shown as a founder acceptance.
    await check("/records/evidence/EV-ODD-OBJECT");
    const evFacts = page.locator(".card", { has: page.getByRole("heading", { name: "Evidence", exact: true }) });
    await expect(evFacts).toContainText("Not a valid value");
    await expect(evFacts).not.toContainText("Founder acceptance");
    await check("/evidence?tab=evidence");
    await expect(page.locator("tr", { hasText: "Odd type evidence" }).first()).toContainText("Not a valid value");

    // The defect with null as its status.
    await check("/records/defect/DEF-ODD-NULL");
    await expect(page.locator(".card", { has: page.getByRole("heading", { name: "Defect", exact: true }) })).toContainText("Not a valid value");
    await check("/evidence?tab=defects");
    await expect(page.locator("tr", { hasText: "Odd status defect" }).first()).toContainText("Not a valid value");

    // The requirement with a number as its disposition and a list as its implementation state.
    await check("/requirements/FR-ODD-NUMBER");
    await expect(page.locator("main")).toContainText("Not a valid value");
    await check("/requirements");
    await expect(page.locator("tr", { hasText: "Odd disposition requirement" }).first()).toContainText("Not a valid value");

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
      ["requirement", "FR-FX-001", { title: "Slow tempo first (reworded, browser test)" }],
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
