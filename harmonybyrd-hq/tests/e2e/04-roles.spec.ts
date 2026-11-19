import { expect, signIn, test } from "./support";

/**
 * Acceptance checks 7 and 8 at the level a person meets them: what each role is shown, and what
 * the server does when a role asks for something it may not do (by going round the screen).
 */
test.describe("what each role can and cannot do", () => {
  test("a reader can read everything but cannot submit to the inbox", async ({ page }) => {
    await signIn(page, "reader");
    await page.goto("/modules/MOD-FX-ALPHA");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alpha (fixture)");
    await page.goto("/proposals/new?mode=defect");
    await expect(page.locator("main")).toContainText("The reader role cannot submit to the inbox.");
    await expect(page.getByRole("button", { name: /Report defect/ })).toHaveCount(0);

    const refused = await page.request.post("/api/v1/tools/submit_defect_report", {
      data: { module_ids: ["MOD-FX-ALPHA"], title: "Reader tries to file a defect", description: "Should be refused.", base_rev: 1 },
    });
    expect(refused.status()).toBe(403);
  });

  test("a reader is not shown tokens or the audit log, and the server never sends them", async ({ page }) => {
    await signIn(page, "reader");
    await page.goto("/access");
    await expect(page.locator("main")).toContainText("available to the founder only");
    await expect(page.getByRole("button", { name: "Issue API token" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Audit log" })).toHaveCount(0);

    // tests-9: not merely hidden. The /access screen is the only place credentials and the audit log
    // are served, so the raw response the reader receives (HTML and the embedded page data) must not
    // contain them. The founder's response is the control: the same markers are there.
    const markers = [/hbq_[0-9a-f]{8}/, /test read-only/, /test developer token/, /Most recent 40 events/];
    const readerHtml = await (await page.request.get("/access")).text();
    for (const marker of markers) expect(readerHtml, `reader's /access contains ${marker}`).not.toMatch(marker);
    // No API tool lists credentials or audit entries either.
    const tools = (await (await page.request.get("/api/v1/tools")).json()) as { tools: { name: string }[] };
    expect(tools.tools.map((t) => t.name).filter((n) => /credential|token|audit/.test(n))).toEqual([]);

    await signIn(page, "founder");
    const founderHtml = await (await page.request.get("/access")).text();
    for (const marker of markers) expect(founderHtml, `founder's /access contains ${marker}`).toMatch(marker);
  });

  test("a developer can propose but is offered no way to review, decide or issue tokens", async ({ page }) => {
    await signIn(page, "developer");
    await page.goto("/decisions");
    await expect(page.getByRole("button", { name: "Record founder decision" })).toHaveCount(0);
    await page.goto("/access");
    await expect(page.getByRole("button", { name: "Issue API token" })).toHaveCount(0);
    await page.goto("/proposals/new?type=module&id=MOD-FX-ALPHA");
    await expect(page.getByRole("button", { name: "Submit to the proposal inbox" })).toBeVisible();
  });

  test("a developer who calls the founder-only endpoints directly is refused, and nothing changes", async ({ page }) => {
    await signIn(page, "developer");
    const before = await (await page.request.get("/api/v1/tools/get_ecosystem_overview")).json();

    const decision = await page.request.post("/api/v1/decisions", {
      data: { title: "Developer approves own work", exact_text: "Accepted.", effects: [{ type: "set_acceptance", record_type: "build", record_id: "BLD-FX-01", state: "accepted" }] },
    });
    expect(decision.status()).toBe(403);

    // tests-9: review a proposal that really exists (the developer's own), so a 404 cannot pass for a refusal.
    const submitted = await page.request.post("/api/v1/tools/submit_change_proposal", {
      data: {
        title: "Developer's own proposal",
        rationale: "Submitted so that the developer can try to accept it.",
        base_rev: before.revision.rev,
        target: { type: "requirement", id: "FR-FX-003", base_version: 1 },
        set: { interpretation: "The developer's reading." },
      },
    });
    expect(submitted.status()).toBe(200);
    const id = ((await submitted.json()) as { proposal: { id: string } }).proposal.id;
    for (const decision of ["accept", "reject", "needs_changes"]) {
      const review = await page.request.post(`/api/v1/proposals/${id}/review`, { data: { decision } });
      expect(review.status(), decision).toBe(403);
    }
    const proposal = (await (await page.request.get(`/api/v1/proposals/${id}`)).json()) as { proposal: { status: string } };
    expect(proposal.proposal.status).toBe("submitted");
    const record = await (await page.request.get("/api/v1/tools/get_record?type=requirement&id=FR-FX-003")).json();
    expect(record.data.record.interpretation ?? null).toBeNull();

    const after = await (await page.request.get("/api/v1/tools/get_ecosystem_overview")).json();
    expect(after.revision.rev).toBe(before.revision.rev);
    expect(after.revision.content_hash).toBe(before.revision.content_hash);

    const acceptance = await (await page.request.get("/api/v1/tools/get_acceptance_status?type=build&id=BLD-FX-01")).json();
    expect(acceptance.data.recorded_in_hq ?? null).toBeNull();
  });

  test("the proposal form does not offer protected fields", async ({ page }) => {
    await signIn(page, "developer");
    await page.goto("/proposals/new?type=requirement&id=FR-FX-001");
    const options = await page.getByLabel("Field to change").locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(3);
    for (const protectedField of ["exact_wording", "source_id", "disposition", "hq_acceptance", "attribution", "id"]) {
      expect(options).not.toContain(protectedField);
    }
    await expect(page.locator("main")).toContainText("What cannot be proposed");
  });
});
