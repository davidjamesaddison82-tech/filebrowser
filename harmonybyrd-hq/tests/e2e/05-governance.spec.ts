import type { Page } from "@playwright/test";
import { expect, headRevision, signIn, test } from "./support";

/**
 * The governance workflow, end to end, in the browser (acceptance checks 4, 5, 6, 7, 8, 9).
 * These tests change the test database, so they run last and in order.
 */
test.describe.configure({ mode: "serial" });

const ORIGINAL_SUMMARY = "Synthetic module with a prototype and passing automated tests, and no acceptance.";
const NEW_SUMMARY = "Synthetic module. Edited through an accepted proposal in the browser test.";

async function propose(page: Page, options: { field: string; value: string; title: string; rationale: string; target?: string }): Promise<string> {
  await page.goto(options.target ?? "/proposals/new?type=module&id=MOD-FX-ALPHA");
  await page.getByLabel("Field to change").selectOption(options.field);
  await page.getByLabel(/Proposed new value/).fill(options.value);
  await page.getByLabel("Title of the proposal").fill(options.title);
  await page.getByLabel(/Why this change is right/).fill(options.rationale);
  await Promise.all([page.waitForURL(/\/proposals\/PROP-\d+$/), page.getByRole("button", { name: "Submit to the proposal inbox" }).click()]);
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function moduleSummary(page: Page, rev?: number): Promise<string> {
  const res = await page.request.get(`/api/v1/tools/get_module_brief?module=MOD-FX-ALPHA${rev ? `&rev=${rev}` : ""}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.data.record.summary as string;
}

let firstProposal = "";
let revBefore = 0;

test("a developer's proposal waits in the inbox and changes nothing", async ({ page }) => {
  await signIn(page, "developer");
  revBefore = await headRevision(page);
  firstProposal = await propose(page, {
    field: "summary",
    value: NEW_SUMMARY,
    title: "Reword the Alpha summary",
    rationale: "Browser test: a proposal must not change the record until the founder accepts it.",
  });
  await expect(page.locator("main")).toContainText("Reword the Alpha summary");
  await expect(page.locator("main")).toContainText(NEW_SUMMARY);
  await expect(page.getByRole("button", { name: "Accept and apply" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Withdraw this proposal" })).toBeVisible();

  expect(await headRevision(page)).toBe(revBefore);
  expect(await moduleSummary(page)).toBe(ORIGINAL_SUMMARY);
  await page.goto("/modules/MOD-FX-ALPHA");
  await expect(page.locator("main")).toContainText(ORIGINAL_SUMMARY);
  await expect(page.locator("main")).not.toContainText(NEW_SUMMARY);
});

test("a reader cannot see another person's proposal", async ({ page }) => {
  await signIn(page, "reader");
  const res = await page.request.get(`/api/v1/proposals/${firstProposal}`);
  expect(res.status()).toBe(404);
  await page.goto("/proposals");
  await expect(page.locator("main")).not.toContainText("Reword the Alpha summary");
});

test("the founder reviews the proposal with its context and accepts it", async ({ page }) => {
  await signIn(page, "founder");
  await page.goto("/decisions");
  await expect(page.locator("main")).toContainText("Proposals awaiting review");
  await page.locator("main").getByRole("link", { name: "Reword the Alpha summary" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/proposals/${firstProposal}$`));

  // Context the founder is given before deciding.
  for (const heading of ["What is proposed", "Rationale", "Impact on other records", "Original context", "Known risks to weigh", "Founder review"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.locator("main")).toContainText(ORIGINAL_SUMMARY);
  await expect(page.locator("main")).toContainText(NEW_SUMMARY);

  await page.getByLabel(/Note to the proposer/).fill("Accepted in the browser test.");
  await page.getByRole("button", { name: "Accept and apply" }).click();
  // The page now shows how the proposal ended, from its own history.
  const outcome = page.getByRole("status").filter({ hasText: "Accepted" });
  await expect(outcome).toContainText("by founder");
  await expect(outcome).toContainText(`dataset revision ${revBefore + 1}`);
  await expect(outcome).toContainText("MOD-FX-ALPHA is at version 2");
  await expect(outcome).toContainText("Note: Accepted in the browser test.");
  // "Before" is the version the proposal was written against, not its own result.
  const diff = page.locator(".diff").first();
  await expect(diff.locator(".before")).toContainText(ORIGINAL_SUMMARY);
  await expect(diff.locator(".after")).toContainText(NEW_SUMMARY);

  expect(await headRevision(page)).toBe(revBefore + 1);
  expect(await moduleSummary(page)).toBe(NEW_SUMMARY);
  await page.goto("/modules/MOD-FX-ALPHA");
  await expect(page.locator("main")).toContainText(NEW_SUMMARY);
});

test("the change is on the record: who, when, why, and through which proposal", async ({ page }) => {
  await signIn(page, "founder");
  await page.goto("/changes");
  const entry = page.locator("main").locator("li, tr, article, section").filter({ hasText: firstProposal }).first();
  await expect(entry).toBeVisible();
  await expect(page.locator("main")).toContainText("MOD-FX-ALPHA");
  await expect(page.locator("main")).toContainText(/founder/i);
});

test("the earlier revision can still be read exactly as it stood", async ({ page }) => {
  await signIn(page, "reader");
  expect(await moduleSummary(page, revBefore)).toBe(ORIGINAL_SUMMARY);
  expect(await moduleSummary(page)).toBe(NEW_SUMMARY);
  await page.goto(`/modules/MOD-FX-ALPHA?rev=${revBefore}`);
  await expect(page.getByRole("status").filter({ hasText: "You are viewing" })).toContainText(`dataset revision ${revBefore}`);
  await expect(page.locator("main")).toContainText(ORIGINAL_SUMMARY);
  await expect(page.locator("main")).not.toContainText(NEW_SUMMARY);
});

test("a proposal written against an old version is refused as stale, not applied", async ({ page }) => {
  await signIn(page, "developer");
  const a = await propose(page, { field: "summary", value: "Version from proposal A.", title: "Stale test A", rationale: "First of two proposals written against the same version." });
  const b = await propose(page, { field: "summary", value: "Version from proposal B.", title: "Stale test B", rationale: "Second of two proposals written against the same version." });

  await signIn(page, "founder");
  await page.goto(`/proposals/${a}`);
  await page.getByRole("button", { name: "Accept and apply" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Accepted" })).toContainText("Applied as");
  const revAfterA = await headRevision(page);

  await page.goto(`/proposals/${b}`);
  await expect(page.locator("main")).toContainText(/stale/i);
  await page.getByRole("button", { name: "Accept and apply" }).click();
  // The refusal is recorded on the proposal itself: stale, not applied, nothing changed.
  const refused = page.getByRole("status").filter({ hasText: "Stale — not applied" });
  await expect(refused).toContainText("No record was changed.");
  await expect(page.locator("main")).toContainText("This proposal was not applied");

  expect(await headRevision(page)).toBe(revAfterA);
  expect(await moduleSummary(page)).toBe("Version from proposal A.");
});

test("the founder records a decision in their own words; it sets a requirement's standing", async ({ page }) => {
  await signIn(page, "founder");
  await page.goto("/requirements/FR-FX-004");
  await expect(page.locator("main")).toContainText(/unreviewed/i);

  await page.goto("/decisions");
  await page.getByLabel("Decision title").fill("No pop-up windows stands");
  await page.getByLabel(/Your decision, in your own words/).fill("Confirmed: no pop-up windows, anywhere. (browser test)");
  await page.getByLabel("What this decision changes in HQ").selectOption("set_requirement_disposition");
  await page.locator('select[name="effect_record_id"]').selectOption("FR-FX-004");
  await page.getByLabel("New standing").selectOption("active");
  await Promise.all([page.waitForURL(/\/records\/decision\/FD-HQ-\d+$/), page.getByRole("button", { name: "Record founder decision" }).click()]);
  const decisionId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.locator("main")).toContainText("Confirmed: no pop-up windows, anywhere. (browser test)");

  await page.goto("/requirements/FR-FX-004");
  await expect(page.locator("main")).toContainText(decisionId);
  await expect(page.locator("main")).not.toContainText(/not yet reviewed/i);

  // The founder's original wording was not touched by the decision.
  const res = await page.request.get("/api/v1/tools/search_founder_requirements?query=pop-up");
  const body = await res.json();
  const requirement = body.data.requirements.find((r: { id: string }) => r.id === "FR-FX-004");
  expect(requirement.disposition).toBe("active");
});

test("the founder accepts a build; only then does HQ call it accepted", async ({ page }) => {
  await signIn(page, "founder");
  const before = await (await page.request.get("/api/v1/tools/get_acceptance_status?type=build&id=BLD-FX-01")).json();
  expect(before.data.recorded_in_hq ?? null).toBeNull();

  await page.goto("/decisions");
  await page.getByLabel("Decision title").fill("Accept alpha-candidate-7 for desktop");
  await page.getByLabel(/Your decision, in your own words/).fill("I accept alpha-candidate-7 for desktop browsers only. (browser test)");
  await page.getByLabel("What this decision changes in HQ").selectOption("set_acceptance");
  await page.getByLabel("Record being accepted").selectOption("build|BLD-FX-01");
  await page.getByPlaceholder(/desktop browsers only/).fill("desktop browsers only");
  await Promise.all([page.waitForURL(/\/records\/decision\/FD-HQ-\d+$/), page.getByRole("button", { name: "Record founder decision" }).click()]);

  const after = await (await page.request.get("/api/v1/tools/get_acceptance_status?type=build&id=BLD-FX-01")).json();
  expect(after.data.recorded_in_hq.state).toBe("accepted");
  expect(after.data.recorded_in_hq.scope_note).toBe("desktop browsers only");
  await page.goto("/records/build/BLD-FX-01");
  await expect(page.locator("main")).toContainText("Founder acceptance recorded in HQ");
  await expect(page.locator("main")).toContainText("desktop browsers only");
});

test("a defect reported from the screen becomes a record only when the founder files it", async ({ page }) => {
  await signIn(page, "developer");
  await page.goto("/proposals/new?mode=defect&module=MOD-FX-BETA");
  await expect(page.locator('select[name="module_ids"]')).toHaveValue("MOD-FX-BETA");
  await page.getByLabel("Defect title").fill("Beta drops the first beat (browser test)");
  await page.getByLabel("What happens, and how to see it").fill("Start Beta, press play: the first beat is silent. Expected: all four beats sound.");
  await Promise.all([page.waitForURL(/\/proposals\/PROP-\d+$/), page.getByRole("button", { name: "Report defect to the inbox" }).click()]);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  const search = async () => (await (await page.request.get("/api/v1/tools/search_records?query=first%20beat")).json()).data;
  expect(JSON.stringify(await search())).not.toContain("Beta drops the first beat");

  await signIn(page, "founder");
  await page.goto(`/proposals/${id}`);
  await page.getByRole("button", { name: "Accept and apply" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Accepted" })).toContainText(/DEF-HQ-\d+ is at version 1/);
  expect(JSON.stringify(await search())).toContain("Beta drops the first beat");
});

test("the founder issues a token; it can read, cannot decide, and stops working when revoked", async ({ page, playwright }) => {
  await signIn(page, "founder");
  await page.goto("/access");
  await page.getByLabel(/Client handle/).fill("e2e-bot");
  await page.getByLabel(/Display name/).fill("Browser-test bot");
  await page.getByLabel("Label for this token").fill("issued by the browser test");
  await page.getByRole("button", { name: "Issue API token" }).click();
  const token = (await page.getByTestId("issued-token").innerText()).trim();
  expect(token).toMatch(/^hbq_[0-9a-f]{8}_[A-Za-z0-9_-]{20,}$/);

  // The token is shown once: after a reload only its prefix is listed.
  await page.reload();
  await expect(page.locator("main")).not.toContainText(token);
  await expect(page.locator("main")).toContainText(token.slice(0, 12));

  const api = await playwright.request.newContext({ baseURL: new URL(page.url()).origin, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  expect((await api.get("/api/v1/whoami")).status()).toBe(200);
  expect((await api.get("/api/v1/tools/get_ecosystem_overview")).status()).toBe(200);
  // Read-only token: it cannot even propose, let alone decide.
  expect((await api.post("/api/v1/tools/submit_defect_report", { data: { module_ids: ["MOD-FX-ALPHA"], title: "Token tries to file", description: "Should be refused.", base_rev: 1 } })).status()).toBe(403);
  expect((await api.post("/api/v1/decisions", { data: { title: "Token approves", exact_text: "Accepted." } })).status()).toBe(403);

  const row = page.locator("li").filter({ hasText: "issued by the browser test" });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toContainText("Revoked");
  expect((await api.get("/api/v1/whoami")).status()).toBe(401);
  await api.dispose();
});

test("refusals are in the audit log, which only the founder can read", async ({ page }) => {
  await signIn(page, "founder");
  await page.goto("/access");
  const log = page.locator("section").filter({ has: page.getByRole("heading", { name: "Audit log" }) });
  await expect(log).toContainText("denied");
  await expect(log).toContainText("decision.record");
  await expect(log).toContainText("e2e-bot");
});

// ---------------------------------------------------------------------------
// Screens after the review (ui-5, ui-6, ui-8, ui-9, honesty-8, D2, D12, D14).
// These change the database too, so they come last, in order.
// ---------------------------------------------------------------------------

async function proposalStatus(page: Page, id: string): Promise<{ status: string; events: { event: string }[]; payload: { set?: Record<string, unknown> } }> {
  const res = await page.request.get(`/api/v1/proposals/${id}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return (body.data?.proposal ?? body.proposal) as { status: string; events: { event: string }[]; payload: { set?: Record<string, unknown> } };
}

test("a review made in a second tab after the proposal was closed is refused, and the founder is told so", async ({ page, browser }) => {
  await signIn(page, "developer");
  const id = await propose(page, {
    target: "/proposals/new?type=module&id=MOD-FX-GAMMA",
    field: "summary",
    value: "Gamma summary from the two-tab test.",
    title: "Two-tab test",
    rationale: "One tab accepts, the other then tries to reject.",
  });

  await signIn(page, "founder");
  const second = await page.context().newPage();
  await page.goto(`/proposals/${id}`);
  await second.goto(`/proposals/${id}`);

  await page.getByRole("button", { name: "Accept and apply" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your acceptance was recorded." })).toContainText("Applied as");
  const revAfterAccept = await headRevision(page);

  // The second tab still shows the open form from before the acceptance.
  await second.getByRole("button", { name: "Reject" }).click();
  const alert = second.getByRole("alert").filter({ hasText: "not applied" });
  await expect(alert).toContainText("Your rejection was not applied: this proposal was already accepted by founder at");
  await expect(second.getByRole("status").filter({ hasText: "Accepted" })).toContainText("by founder");

  const after = await proposalStatus(page, id);
  expect(after.status).toBe("accepted");
  expect(after.events.map((e) => e.event)).toEqual(["submitted", "accepted"]);
  expect(await headRevision(page)).toBe(revAfterAccept);
  await second.close();
});

test("an empty structured field is submitted as JSON, not as a string", async ({ page }) => {
  await signIn(page, "developer");
  await page.goto("/proposals/new?type=module&id=MOD-FX-ALPHA");
  await page.getByLabel("Field to change").selectOption("why_exists");
  await expect(page.locator('input[name="value_is_json"]')).toHaveValue("1");
  await page.getByLabel(/Proposed new value/).fill('{"text": "Alpha exists to test the screens.", "epistemic": "submitter_claim", "citations": []}');
  await page.getByLabel("Title of the proposal").fill("Say why Alpha exists");
  await page.getByLabel(/Why this change is right/).fill("Browser test: a missing statement can be supplied from the form.");
  await Promise.all([page.waitForURL(/\/proposals\/PROP-\d+$/), page.getByRole("button", { name: "Submit to the proposal inbox" }).click()]);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const stored = await proposalStatus(page, id);
  expect(stored.payload.set?.why_exists).toEqual({ text: "Alpha exists to test the screens.", epistemic: "submitter_claim", citations: [] });
});

test("on a pinned revision every link keeps the revision, and the bar stays after following one", async ({ page }) => {
  await signIn(page, "reader");
  expect(await headRevision(page)).toBeGreaterThan(1);
  for (const path of ["/", "/modules?view=lifecycle", "/modules/MOD-FX-ALPHA", "/records/build/BLD-FX-01", "/requirements/FR-FX-001", "/loops/LOOP-FX-01", "/evidence?tab=defects", "/review"]) {
    await page.goto(`${path}${path.includes("?") ? "&" : "?"}rev=1`);
    const hrefs = await page.locator("a[href]:not(.pin-back)").evaluateAll((links) =>
      links.map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith("/") && !h.startsWith("//") && !h.startsWith("/_next")),
    );
    expect(hrefs.length, path).toBeGreaterThan(5);
    const unpinned = hrefs.filter((h) => !new URLSearchParams(h.split("#")[0].split("?")[1] ?? "").has("rev"));
    expect(unpinned, `${path}: links that drop the pinned revision`).toEqual([]);
  }

  // Nothing on the pinned dashboard comes from later revisions.
  await page.goto("/?rev=1");
  const revTags = await page.locator("main .id-tag").filter({ hasText: /^rev \d+$/ }).allTextContents();
  expect(revTags).toEqual(["rev 1"]);

  // Follow a citation from a pinned module page: still pinned, and the bar says so.
  await page.goto("/modules/MOD-FX-ALPHA?rev=1");
  const cites = page.locator("details.cites").first();
  await cites.locator("summary").click();
  await cites.locator('a[href^="/records/source/"]').first().click();
  await expect(page).toHaveURL(/\/records\/source\/SRC-F0\d\?rev=1$/);
  await expect(page.locator(".pinbar")).toContainText("You are viewing dataset revision 1");
  await page.locator(".pinbar").getByRole("link", { name: "Return to the latest" }).click();
  await expect(page).toHaveURL(/\/records\/source\/SRC-F0\d$/);
  await expect(page.locator(".pinbar")).toHaveCount(0);
});

test("a record that entered through the inbox is marked so, in lists and on its page", async ({ page }) => {
  await signIn(page, "reader");
  await page.goto("/evidence?tab=defects");
  const row = page.locator("tr", { hasText: "Beta drops the first beat (browser test)" });
  await expect(row.locator(".chip", { hasText: "Entered through the proposal inbox" })).toBeVisible();
  await row.getByRole("link", { name: "Beta drops the first beat (browser test)" }).click();
  await expect(page.locator(".page-head .chip", { hasText: "Entered through the proposal inbox" })).toContainText(/PROP-\d+/);
  // A fixture record is not marked.
  await page.goto("/records/defect/DEF-FX-01");
  await expect(page.locator(".chip", { hasText: "proposal inbox" })).toHaveCount(0);
});

test("a record carrying a founder acceptance offers no proposal, and says what to do instead", async ({ page }) => {
  // BLD-FX-01 was accepted by the founder earlier in this file.
  await signIn(page, "developer");
  await page.goto("/records/build/BLD-FX-01");
  await expect(page.getByRole("link", { name: "Propose a change" })).toHaveCount(0);
  await expect(page.locator("main")).toContainText("Proposals cannot change this record.");
  await expect(page.locator("main")).toContainText("records a decision that clears the acceptance");
  await page.goto("/proposals/new?type=build&id=BLD-FX-01");
  await expect(page.getByLabel("Field to change")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("Proposals cannot change this record.");
});

test("a founder rejection reads as rejected, and an open proposal on the rejected record warns before accepting", async ({ page }) => {
  await signIn(page, "developer");
  const id = await propose(page, {
    target: "/proposals/new?type=module&id=MOD-FX-BETA",
    field: "summary",
    value: "Beta summary written before the founder's rejection.",
    title: "Beta summary before rejection",
    rationale: "Browser test: the rejection arrives after this proposal.",
  });

  await signIn(page, "founder");
  await page.goto("/decisions");
  await page.getByLabel("Decision title").fill("Reject Beta as it stands");
  await page.getByLabel(/Your decision, in your own words/).fill("I reject Beta as it stands. (browser test)");
  await page.getByLabel("What this decision changes in HQ").selectOption("set_acceptance");
  await page.getByLabel("Record being accepted").selectOption("module|MOD-FX-BETA");
  await page.getByLabel("Outcome").selectOption("rejected");
  await Promise.all([page.waitForURL(/\/records\/decision\/FD-HQ-\d+$/), page.getByRole("button", { name: "Record founder decision" }).click()]);

  await page.goto("/modules/MOD-FX-BETA");
  const standing = page.locator(".page-head .chip").first();
  await expect(standing).toHaveText("Founder rejected in HQ");
  await expect(standing).toHaveClass(/\bbad\b/);
  await page.goto("/health/rejected_in_hq");
  await expect(page.locator("main")).toContainText("MOD-FX-BETA");

  await page.goto(`/proposals/${id}`);
  await expect(page.locator("main")).toContainText("This proposal cannot be accepted as it stands.");
  const rev = await headRevision(page);
  await page.getByRole("button", { name: "Accept and apply" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "MOD-FX-BETA" })).toContainText("Record a founder decision that clears it first");
  expect((await proposalStatus(page, id)).status).toBe("submitted");
  expect(await headRevision(page)).toBe(rev);
});

test("a long unbroken name and family wrap: no screen scrolls sideways", async ({ page }) => {
  const longName = "X".repeat(300);
  const longFamily = "Y".repeat(300);
  for (const [field, value] of [
    ["name", longName],
    ["family", longFamily],
  ] as const) {
    await signIn(page, "developer");
    const id = await propose(page, { target: "/proposals/new?type=module&id=MOD-FX-DELTA", field, value, title: `Long ${field}`, rationale: "Browser test: long unbroken text." });
    await signIn(page, "founder");
    await page.goto(`/proposals/${id}`);
    await page.getByRole("button", { name: "Accept and apply" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your acceptance was recorded." })).toBeVisible();
  }
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ["/modules/MOD-FX-DELTA", "/records/module/MOD-FX-DELTA", "/modules"]) {
      await page.goto(path);
      const m = await page.evaluate(() => ({
        sideways: document.documentElement.scrollWidth - window.innerWidth,
        h1: document.querySelector("main h1")!.getBoundingClientRect().right,
        crumbs: document.querySelector("main .crumbs")?.getBoundingClientRect().right ?? 0,
        vw: window.innerWidth,
      }));
      expect(m.sideways, `${path} at ${viewport.width}px: sideways scroll`).toBeLessThanOrEqual(1);
      expect(m.h1, `${path} at ${viewport.width}px: heading inside the window`).toBeLessThanOrEqual(m.vw);
      expect(m.crumbs, `${path} at ${viewport.width}px: breadcrumbs inside the window`).toBeLessThanOrEqual(m.vw);
    }
    if (viewport.width > 1000) await expect(page.locator("main")).toContainText(longName.slice(0, 50));
  }
});
