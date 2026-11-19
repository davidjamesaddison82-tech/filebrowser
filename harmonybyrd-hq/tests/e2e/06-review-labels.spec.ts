import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, headRevision, signIn, test } from "./support";

/**
 * What the review screens say about acceptance claims and new records (F1, F2, F9).
 * These tests add records and proposals to the test database, so they run after 05.
 */
test.describe.configure({ mode: "serial" });

/** Change who is signed in, within one test (the first sign-in of an identity goes through the form). */
async function signInAs(page: Page, who: "founder" | "developer" | "reader"): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, who);
}

async function submit(page: Page, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post("/api/v1/tools/submit_change_proposal", { data: { base_rev: await headRevision(page), ...body } });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { proposal: { id: string } }).proposal.id;
}

async function version(page: Page, type: string, id: string): Promise<number> {
  const res = await page.request.get(`/api/v1/tools/get_record?type=${type}&id=${id}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: { meta: { version: number } } }).data.meta.version;
}

test.describe("the founder's review screen (F9)", () => {
  test("a proposal to create a record lists the sources it cites, with whether HQ holds their text", async ({ page }) => {
    await signIn(page, "developer");
    const id = await submit(page, {
      title: "Register the pop-up instruction",
      rationale: "Browser test: the review screen must show what a new record cites.",
      create: {
        record_type: "requirement",
        record: {
          exact_wording: "Keep the interface free of pop-up windows.",
          source_id: "SRC-F01",
          attribution: "direct_quote",
          title: "No pop-up windows (browser test)",
          category: "ui_ux",
          implementation_state: "no_record",
        },
      },
    });
    await signInAs(page, "founder");
    await page.goto(`/proposals/${id}`);
    const context = page.locator(".card", { has: page.getByRole("heading", { name: "Original context" }) });
    await expect(context).toContainText("Sources the proposed record cites");
    await expect(context).not.toContainText("No source is recorded for the target");
    await expect(context.getByRole("link", { name: "Fixture Document A (synthetic)" })).toHaveAttribute("href", "/records/source/SRC-F01");
    await expect(context).toContainText("SRC-F01");
    await expect(context).toContainText("HQ holds this source's text.");
    // It sets nothing about where a record stands, so no such risk is listed.
    const risks = page.locator(".card", { has: page.getByRole("heading", { name: "Known risks to weigh" }) });
    await expect(risks).not.toContainText("It sets where the record stands");
  });

  test("a proposal that changes a record's status says so under the risks to weigh; one that does not, does not", async ({ page }) => {
    await signIn(page, "developer");
    const statusChange = await submit(page, {
      title: "Mark the tempo defect resolved",
      rationale: "Browser test: a change of status is a risk to weigh.",
      target: { type: "defect", id: "DEF-FX-01", base_version: await version(page, "defect", "DEF-FX-01") },
      set: { status: "resolved" },
    });
    const titleChange = await submit(page, {
      title: "Reword the tempo defect",
      rationale: "Browser test: a change of title is not.",
      target: { type: "defect", id: "DEF-FX-01", base_version: await version(page, "defect", "DEF-FX-01") },
      set: { title: "Alpha drops the last note above tempo 180 (reworded)" },
    });
    await signInAs(page, "founder");
    const risks = page.locator(".card", { has: page.getByRole("heading", { name: "Known risks to weigh" }) });
    await page.goto(`/proposals/${statusChange}`);
    await expect(risks).toContainText("It sets where the record stands (status).");
    await page.goto(`/proposals/${titleChange}`);
    await expect(risks).not.toContainText("It sets where the record stands");
  });
});

test.describe("a build claimed as accepted with no source quoted (F1, F2)", () => {
  const CLAIMED = "Acceptance claimed — no source quoted";

  test("is labelled as a claim wherever its standing is shown, and a sourced one is not", async ({ page }) => {
    // A stored build marked as accepted whose statement quotes nothing, as an older pack could hold
    // (neither an import nor a proposal can add one now): see plant-claimed-build.ts.
    const planted = spawnSync("npx", ["tsx", "tests/e2e/plant-claimed-build.ts"], { cwd: path.resolve(__dirname, "..", ".."), encoding: "utf8", env: process.env });
    expect(planted.status, planted.stderr).toBe(0);

    await signIn(page, "reader");
    await page.goto("/records/build/BLD-FX-03");
    const facts = page.locator(".card", { has: page.getByRole("heading", { name: "Build", exact: true }) });
    await expect(facts.locator(".chip").first()).toHaveText(CLAIMED);
    await expect(facts).not.toContainText("Acceptance reported in source");
    const status = page.locator(".card", { has: page.getByRole("heading", { name: "Acceptance status" }) });
    await expect(status.locator(".chip").first()).toHaveText(CLAIMED);
    await expect(status.locator(".chip").first()).toHaveClass(/\bwarn\b/);

    await page.goto("/modules/MOD-FX-GAMMA");
    const builds = page.locator(".card", { has: page.getByRole("heading", { name: "Executable versions" }) });
    await expect(builds.locator("li", { hasText: "gamma-preview-1" }).locator(".chip")).toHaveText(CLAIMED);

    await page.goto("/evidence?tab=builds");
    await expect(page.locator("tr", { hasText: "gamma-preview-1" }).locator(".chip").first()).toHaveText(CLAIMED);
    // Control: a build whose statement quotes the source that reports its acceptance.
    await expect(page.locator("tr", { hasText: "Beta build 2" }).locator(".chip").first()).toHaveText("Acceptance reported in source");

    await page.goto("/review?kind=missing_acceptance_evidence");
    await expect(page.locator("main")).toContainText("gamma-preview-1 is claimed as accepted, with no source quoted");
    await expect(page.locator("main")).toContainText("HQ holds no founder-acceptance evidence for it and no founder decision recorded in HQ accepts it");

    await page.goto("/health/unverified_claims");
    await expect(page.locator("main")).toContainText("BLD-FX-03");
    await page.goto("/health/acceptance_reported_only");
    await expect(page.locator("main")).not.toContainText("BLD-FX-03");
  });
});
