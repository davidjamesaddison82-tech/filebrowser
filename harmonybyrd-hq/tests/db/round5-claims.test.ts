/**
 * Fifth round (ROUND5): a record that carries a positive status from an import is frozen for proposals
 * unless the proposal withdraws that status.
 *
 *   K1   a loop whose standing, or a pathway whose basis, is a source label (or one of HQ's own labels) is
 *        frozen unless the proposal relabels it submitter_claim or no_evidence (HQ403, rule source_label);
 *   K2   a requirement shown as implemented and tested is frozen unless the proposal moves it to another
 *        valid state (HQ403, rule tested_claim);
 *   K3   what identifies a build (sha256, bytes, filename, artifact_source_id) cannot change on an update (HQ403);
 *   K4   a module's evidence level cannot change on an update, and a created module carries the lowest (HQ403);
 *   K5   a second clear straight at hq.record_founder_decision is refused (HQ422).
 *
 * Every refusal is tried four ways, as in proposal-claims.test.ts: through the service (an AI client's
 * token and a developer's session), straight at hq.submit_proposal as authenticated, and on a proposal
 * planted in the inbox, accepted through the service and straight at hq.review_proposal. Each must refuse
 * and change nothing; a refused acceptance leaves the proposal "submitted". Then the other direction: the
 * honest change each rule leaves open still goes through.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { isOutstanding } from "@/lib/domain/derive";
import { LIFECYCLE_DIMENSIONS, type RequirementRecord } from "@/lib/domain/schemas";
import { getProposal, inboxClaimProblem, recordFounderDecision, reviewProposal, submitChangeProposal } from "@/lib/server/services";
import { clearDatasetCache, getDataset } from "@/lib/server/store";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld, worldState } from "../helpers/db";

let w: TestWorld;

const SOURCE_DESCRIBED = /a loop or pathway a source describes is changed only by an import; a proposal may relabel it as the submitter's claim and then change it/i;
const TESTED_FROZEN = /a requirement shown as implemented and tested is changed only by an import; a proposal may move it to another implementation state and then change it/i;
const BUILD_IDENTITY = /what identifies a build is set when it is recorded; record a new build instead/i;
const LEVEL = /a module's evidence level says what the sources HQ read hold about it, and only an import sets it/i;
const CREATED_LEVEL = /a module created through the inbox is one no source HQ read describes: give evidence_level "commission_list_only"/i;

interface Body {
  target?: { type: string; id: string };
  set?: Record<string, unknown>;
  create?: { record_type: string; record: Record<string, unknown> };
}

interface Case {
  item: string;
  name: string;
  body: Body;
  status: 403 | 422;
  sqlstate: "HQ403" | "HQ422";
  message: RegExp;
  /** The database's message names this field (`field "<name>"`). */
  dbField?: string;
  /** What the application's refusal carries in detail, at submission and again at acceptance. */
  detail?: Record<string, unknown>;
}

const steps = (moduleId: string) => [
  { order: 1, source_term: "Improvise freely at 300 bpm", description: "Built and running", shared_stage: "create", module_id: moduleId, citations: [] },
  { order: 2, source_term: "Get a score out of ten", description: "", shared_stage: "capture_reflect", module_id: moduleId, citations: [] },
];
const pathSteps = [
  { order: 1, module_id: "MOD-FX-DELTA", role: "complete course", shared_stage: "perform", citations: [] },
  { order: 2, module_id: "MOD-FX-GAMMA", role: "graduate", shared_stage: "create", citations: [] },
];
const unknownLifecycle = () =>
  Object.fromEntries(
    LIFECYCLE_DIMENSIONS.map((k) => [
      k,
      { state: "unknown", basis: "no_evidence", note: "", citations: [] },
    ]),
  );
const epsilon = (level: string | undefined) => ({ name: "Epsilon", kind: "experiment", family: "fixture", ...(level ? { evidence_level: level } : {}), lifecycle: unknownLifecycle() });

const CASES: Case[] = [
  // ---- K1 ----
  {
    item: "K1 (Z14)",
    name: "a reported loop renamed, moved to Gamma and given new steps, its standing kept",
    body: { target: { type: "loop", id: "LOOP-FX-01" }, set: { name: "Gamma improvisation loop (built)", module_ids: ["MOD-FX-GAMMA"], concepts: ["improvisation"], steps: steps("MOD-FX-GAMMA") } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_DESCRIBED,
    dbField: "standing",
    detail: { rule: "source_label", field: "standing" },
  },
  {
    item: "K1",
    name: "a reported loop's name alone changed",
    body: { target: { type: "loop", id: "LOOP-FX-01" }, set: { name: "Pattern practice loop (built)" } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_DESCRIBED,
    dbField: "standing",
    detail: { rule: "source_label", field: "standing" },
  },
  {
    item: "K1",
    name: "a reported loop's standing resent unchanged beside a new variant_of",
    body: { target: { type: "loop", id: "LOOP-FX-01" }, set: { standing: "reported", variant_of: "LOOP-FX-02" } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_DESCRIBED,
    dbField: "standing",
    detail: { rule: "source_label", field: "standing" },
  },
  {
    item: "K1",
    name: "a design-intention loop's steps rewritten",
    body: { target: { type: "loop", id: "LOOP-FX-02" }, set: { steps: steps("MOD-FX-GAMMA") } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_DESCRIBED,
    dbField: "standing",
    detail: { rule: "source_label", field: "standing" },
  },
  {
    item: "K1",
    name: "a loop HQ labelled verified (planted by an import) given a new name",
    body: { target: { type: "loop", id: "LOOP-R5-VER" }, set: { name: "Verified and shipped" } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_DESCRIBED,
    dbField: "standing",
    detail: { rule: "source_label", field: "standing" },
  },
  {
    item: "K1 (Z14)",
    name: "a design-intention pathway given a new name, description and steps",
    body: { target: { type: "pathway", id: "PATH-FX-01" }, set: { name: "Delta then Gamma (shipped)", description: "A shipped route the founder chose.", steps: pathSteps } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_DESCRIBED,
    dbField: "basis",
    detail: { rule: "source_label", field: "basis" },
  },
  {
    item: "K1",
    name: "the commission's example pathway given a new description",
    body: { target: { type: "pathway", id: "PATH-R5-EX" }, set: { description: "The commission says this route is built." } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_DESCRIBED,
    dbField: "basis",
    detail: { rule: "source_label", field: "basis" },
  },
  // ---- K2 ----
  {
    item: "K2 (Z15)",
    name: "a tested requirement moved to Gamma and retitled",
    body: { target: { type: "requirement", id: "FR-FX-001" }, set: { module_ids: ["MOD-FX-GAMMA"], title: "Gamma improvisation works" } },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED_FROZEN,
    dbField: "title",
    detail: { rule: "tested_claim", field: "title" },
  },
  {
    item: "K2 (Z15)",
    name: "a tested requirement's linked code changed",
    body: { target: { type: "requirement", id: "FR-FX-001" }, set: { linked_code: [{ repository: "fixture/gamma", path: "src/improvise.ts" }] } },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED_FROZEN,
    dbField: "linked_code",
    detail: { rule: "tested_claim", field: "linked_code" },
  },
  {
    item: "K2",
    name: "a tested requirement's module list changed, its state resent unchanged",
    body: { target: { type: "requirement", id: "FR-FX-001" }, set: { implementation_state: "implemented_tested", module_ids: ["MOD-FX-GAMMA"] } },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED_FROZEN,
    dbField: "module_ids",
    detail: { rule: "tested_claim", field: "module_ids" },
  },
  // ---- K3 ----
  {
    item: "K3 (Z16)",
    name: "a build's sha256 replaced",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { label: "gamma-build-1", sha256: "2".repeat(64) } },
    status: 403,
    sqlstate: "HQ403",
    message: BUILD_IDENTITY,
    dbField: "sha256",
    detail: { protected_fields: ["sha256"] },
  },
  {
    item: "K3 (Z16)",
    name: "a build given another source as its artifact",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { artifact_source_id: "SRC-F02" } },
    status: 403,
    sqlstate: "HQ403",
    message: BUILD_IDENTITY,
    dbField: "artifact_source_id",
    detail: { protected_fields: ["artifact_source_id"] },
  },
  {
    item: "K3",
    name: "a build's filename and size changed",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { filename: "gamma-1.html", bytes: "1" } },
    status: 403,
    sqlstate: "HQ403",
    message: BUILD_IDENTITY,
    detail: { protected_fields: ["filename", "bytes"] },
  },
  // ---- K4 ----
  {
    item: "K4 (Z18)",
    name: "a module named only in the commission list given documented_in_sources",
    body: { target: { type: "module", id: "MOD-FX-DELTA" }, set: { evidence_level: "documented_in_sources" } },
    status: 403,
    sqlstate: "HQ403",
    message: LEVEL,
    dbField: "evidence_level",
    detail: { protected_fields: ["evidence_level"] },
  },
  {
    item: "K4",
    name: "a created module that says sources document it",
    body: { create: { record_type: "module", record: epsilon("documented_in_sources") } },
    status: 403,
    sqlstate: "HQ403",
    message: CREATED_LEVEL,
    dbField: "evidence_level",
    detail: { rule: "protected", field: "evidence_level" },
  },
  {
    item: "K4",
    name: "a created module that says accessible sources name it",
    body: { create: { record_type: "module", record: epsilon("named_only") } },
    status: 403,
    sqlstate: "HQ403",
    message: CREATED_LEVEL,
    dbField: "evidence_level",
    detail: { rule: "protected", field: "evidence_level" },
  },
];

async function head(): Promise<number> {
  return (await getDataset(w.founder)).head;
}

async function baseVersion(type: string, id: string): Promise<number> {
  const record = (await getDataset(w.founder)).stored.get(type as never, id);
  if (!record) throw new Error(`no ${type} ${id}`);
  return record.meta.version;
}

async function serviceInput(body: Body, title = "Probe") {
  return {
    title: title.slice(0, 200),
    rationale: "Regression probe.",
    base_rev: await head(),
    ...(body.target ? { target: { ...body.target, base_version: await baseVersion(body.target.type, body.target.id) } } : {}),
    ...(body.set ? { set: body.set } : {}),
    ...(body.create ? { create: body.create } : {}),
  };
}

const payloadOf = (body: Body) => (body.set ? { op: "update", set: body.set } : { op: "create", record_type: body.create!.record_type, record: body.create!.record });

let planted = 0;
/** Put a proposal straight into the inbox as the owner, as if submission had been bypassed. */
async function plant(body: Body, submitter: Principal): Promise<string> {
  planted += 1;
  const id = `PROP-8${String(planted).padStart(5, "0")}`;
  const client = await admin();
  try {
    const base = body.target ? await baseVersion(body.target.type, body.target.id) : null;
    await client.query(
      `insert into hq.proposals (id, kind, target_type, target_id, base_version, base_rev, title, rationale, payload, submitted_by)
       values ($1, 'change_proposal', $2, $3, $4, $5, 'Planted probe', 'Bypassed submission.', $6::jsonb, $7)`,
      [id, body.target?.type ?? null, body.target?.id ?? null, base, await head(), JSON.stringify(payloadOf(body)), submitter.id],
    );
    await client.query("insert into hq.proposal_events (proposal_id, event, actor) values ($1, 'submitted', $2)", [id, submitter.id]);
  } finally {
    await client.end();
  }
  return id;
}

/** Straight at hq.submit_proposal as role authenticated with the principal's claims. */
async function dbSubmit(who: Principal, body: Body): Promise<string> {
  const base = body.target ? await baseVersion(body.target.type, body.target.id) : null;
  const rev = await head();
  return asAppRole("authenticated", claimsFor(who), async (c) => {
    const r = await c.query<{ p: { id: string } }>("select hq.submit_proposal('change_proposal', $1, $2, $3, $4, 'Direct probe', 'Bypassing the application.', $5::jsonb) as p", [
      body.target?.type ?? null,
      body.target?.id ?? null,
      base,
      rev,
      JSON.stringify(payloadOf(body)),
    ]);
    return r.rows[0].p.id;
  });
}

const dbReview = (id: string) =>
  asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select hq.review_proposal($1, 'accept', 'ok') as r", [id])).finally(() => clearDatasetCache());

/** Import records as the owner, as a pack import would (no schema check). */
async function put(records: { type: string; id: string; data: Record<string, unknown> }[], why: string) {
  const client = await admin();
  try {
    await client.query("select hq.admin_put_records($1::jsonb, $2, null, 'hq-import', false)", [JSON.stringify(records), why]);
  } finally {
    await client.end();
  }
  clearDatasetCache();
}

const stored = async (type: string, id: string) => (await getDataset(w.founder)).stored.get(type as never, id)!.data as unknown as Record<string, unknown>;
const accept = async (proposal: unknown) => {
  const r = await reviewProposal(w.founder, (proposal as { proposal: { id: string } }).proposal.id, "accept");
  clearDatasetCache();
  return r;
};
const propose = async (who: Principal, body: Body, title = "Honest change") => submitChangeProposal(who, await serviceInput(body, title));

beforeAll(async () => {
  w = await freshWorld();
  await put(
    [
      {
        type: "loop",
        id: "LOOP-R5-VER",
        data: { id: "LOOP-R5-VER", name: "A loop HQ labelled verified", module_ids: ["MOD-FX-ALPHA"], standing: "verified", steps: [], concepts: [], citations: [] },
      },
      {
        type: "pathway",
        id: "PATH-R5-EX",
        data: {
          id: "PATH-R5-EX",
          name: "Gamma → Alpha (the commission's example)",
          description: "",
          basis: "commission_example",
          steps: [
            { order: 1, module_id: "MOD-FX-GAMMA", role: "improvise", shared_stage: "none", citations: [] },
            { order: 2, module_id: "MOD-FX-ALPHA", role: "practice", shared_stage: "none", citations: [] },
          ],
          citations: [],
        },
      },
    ],
    "Plant a verified loop and the commission's example pathway",
  );
});

describe("ROUND5 — an imported positive status freezes a record for proposals, on every path", () => {
  for (const c of CASES) {
    describe(`${c.item}: ${c.name}`, () => {
      it(`is refused through the service with ${c.status}, for an AI client's token and a developer's session, and changes nothing`, async () => {
        for (const who of [w.claude, w.developer]) {
          const before = await worldState();
          const err = await expectStatus(propose(who, c.body, `Probe: ${c.name}`), c.status);
          expect(err.message).toMatch(c.message);
          if (c.detail) expect(err.detail).toMatchObject(c.detail);
          expect(await worldState()).toEqual(before);
        }
      });

      it(`is refused by hq.submit_proposal on its own with ${c.sqlstate}`, async () => {
        const before = await worldState();
        for (const who of [w.claude, w.developer]) {
          await expect(dbSubmit(who, c.body)).rejects.toMatchObject({ code: c.sqlstate, message: expect.stringMatching(c.message) });
          if (c.dbField) await expect(dbSubmit(who, c.body)).rejects.toMatchObject({ message: expect.stringContaining(`field "${c.dbField}"`) });
        }
        expect(await worldState()).toEqual(before);
      });

      it("a planted proposal is refused when the founder accepts it through the application; it stays submitted", async () => {
        const id = await plant(c.body, w.claude);
        const before = await worldState();
        const err = await expectStatus(reviewProposal(w.founder, id, "accept"), c.status);
        expect(err.message).toMatch(c.message);
        if (c.detail?.rule) expect(err.detail).toMatchObject(c.detail);
        expect(await worldState()).toEqual(before);
        expect((await getProposal(w.founder, id)).status).toBe("submitted");
      });

      it(`a planted proposal is refused by hq.review_proposal on its own with ${c.sqlstate}; it stays submitted`, async () => {
        const id = await plant(c.body, w.developer);
        const before = await worldState();
        await expect(dbReview(id)).rejects.toMatchObject({ code: c.sqlstate, message: expect.stringMatching(c.message) });
        if (c.dbField) await expect(dbReview(id)).rejects.toMatchObject({ message: expect.stringContaining(`field "${c.dbField}"`) });
        expect(await worldState()).toEqual(before);
        expect((await getProposal(w.founder, id)).status).toBe("submitted");
      });
    });
  }

  it("the application's own check (inboxClaimProblem) finds each K1 and K2 case before the database is asked", async () => {
    const ctx = await getDataset(w.founder);
    for (const c of CASES.filter((x) => x.item.startsWith("K1") || x.item.startsWith("K2"))) {
      const current = ctx.stored.get(c.body.target!.type as never, c.body.target!.id)!.data as unknown as Record<string, unknown>;
      expect(inboxClaimProblem(c.body.target!.type as never, c.body.set!, current), c.name).toMatchObject({ status: 403, detail: c.detail });
    }
  });

  it("K2: a requirement made implemented_tested still names implementation_state (round 4's rule is kept)", async () => {
    const before = await worldState();
    const err = await expectStatus(propose(w.claude, { target: { type: "requirement", id: "FR-FX-002" }, set: { implementation_state: "implemented_tested", title: "Tested now" } }), 403);
    expect(err.detail).toMatchObject({ rule: "tested_claim", field: "implementation_state" });
    expect(await worldState()).toEqual(before);
  });

  it("K2: a tested requirement given a state outside the list is refused by the allowed-values check first (422)", async () => {
    const before = await worldState();
    for (const state of ["implemented_tested ", "Implemented_tested", "done"]) {
      const err = await expectStatus(propose(w.claude, { target: { type: "requirement", id: "FR-FX-001" }, set: { implementation_state: state, title: "Moved" } }), 422);
      expect(err.detail).toMatchObject({ rule: "allowed_values", field: "implementation_state" });
    }
    expect(await worldState()).toEqual(before);
  });

  it("K1: a loop relabelled with a value outside its list is refused by the allowed-values check first (422)", async () => {
    const before = await worldState();
    const err = await expectStatus(propose(w.claude, { target: { type: "loop", id: "LOOP-FX-01" }, set: { standing: "Submitter_claim", name: "x loop" } }), 422);
    expect(err.detail).toMatchObject({ rule: "allowed_values", field: "standing" });
    expect(await worldState()).toEqual(before);
  });
});

describe("ROUND5 — the honest change each rule leaves open still goes through", () => {
  it("K1: a reported loop relabelled as the submitter's claim may then be renamed and given new steps; its imported claims stay as they were", async () => {
    await accept(
      await propose(w.claude, {
        target: { type: "loop", id: "LOOP-FX-01" },
        set: { standing: "submitter_claim", name: "Gamma improvisation loop (built)", module_ids: ["MOD-FX-GAMMA"], steps: steps("MOD-FX-GAMMA") },
      }),
    );
    const loop = await stored("loop", "LOOP-FX-01");
    expect(loop).toMatchObject({ standing: "submitter_claim", name: "Gamma improvisation loop (built)" });
    // Then, as the submitter's claim, it can be changed again.
    await accept(await propose(w.developer, { target: { type: "loop", id: "LOOP-FX-01" }, set: { name: "Gamma improvisation loop (as I see it)" } }));
    expect(await stored("loop", "LOOP-FX-01")).toMatchObject({ standing: "submitter_claim", name: "Gamma improvisation loop (as I see it)" });
  });

  it("K1: a design-intention loop relabelled no_evidence may be changed", async () => {
    await accept(await propose(w.developer, { target: { type: "loop", id: "LOOP-FX-02" }, set: { standing: "no_evidence", name: "Improvisation loop (no evidence)" } }));
    expect(await stored("loop", "LOOP-FX-02")).toMatchObject({ standing: "no_evidence", name: "Improvisation loop (no evidence)" });
  });

  it("K1: a pathway relabelled as the submitter's claim may be changed; one created as the submitter's claim may be changed", async () => {
    await accept(await propose(w.claude, { target: { type: "pathway", id: "PATH-FX-01" }, set: { basis: "submitter_claim", name: "Delta then Gamma (my route)", steps: pathSteps } }));
    expect(await stored("pathway", "PATH-FX-01")).toMatchObject({ basis: "submitter_claim", name: "Delta then Gamma (my route)" });
    const created = await accept(
      await propose(w.developer, { create: { record_type: "pathway", record: { name: "Alpha to Gamma", basis: "submitter_claim", steps: [{ order: 1, module_id: "MOD-FX-ALPHA", role: "practice" }, { order: 2, module_id: "MOD-FX-GAMMA", role: "improvise" }] } } }),
    );
    await accept(await propose(w.claude, { target: { type: "pathway", id: String(created.record_id) }, set: { description: "Changed by a second proposal." } }));
    expect(await stored("pathway", String(created.record_id))).toMatchObject({ description: "Changed by a second proposal." });
  });

  it("K1: straight at the database, the relabel goes through too", async () => {
    const id = await dbSubmit(w.claude, { target: { type: "loop", id: "LOOP-R5-VER" }, set: { standing: "submitter_claim", name: "No longer HQ's" } });
    await dbReview(id);
    expect(await stored("loop", "LOOP-R5-VER")).toMatchObject({ standing: "submitter_claim", name: "No longer HQ's" });
  });

  it("K2: a tested requirement moved to implemented_unverified may then be moved and retitled, and it is outstanding again", async () => {
    await accept(
      await propose(w.claude, { target: { type: "requirement", id: "FR-FX-001" }, set: { implementation_state: "implemented_unverified", module_ids: ["MOD-FX-GAMMA"], title: "Gamma improvisation works" } }),
    );
    expect(await stored("requirement", "FR-FX-001")).toMatchObject({ implementation_state: "implemented_unverified", module_ids: ["MOD-FX-GAMMA"] });
    const ds = (await getDataset(w.founder)).ds;
    expect(isOutstanding(ds.get("requirement", "FR-FX-001")!.data as RequirementRecord, ds)).toBe(true);
  });

  it("K3: a build's label and module may still change, and a build created through the inbox may give its hash, file name and size", async () => {
    await accept(await propose(w.claude, { target: { type: "build", id: "BLD-FX-01" }, set: { label: "alpha-candidate-7 (relabelled)" } }));
    expect(await stored("build", "BLD-FX-01")).toMatchObject({ label: "alpha-candidate-7 (relabelled)" });
    const created = await accept(
      await propose(w.developer, {
        create: {
          record_type: "build",
          record: { label: "epsilon-1", standing: "development", sha256: "3".repeat(64), filename: "epsilon-1.html", bytes: "10", statement: { text: "A development build.", epistemic: "submitter_claim", citations: [] } },
        },
      }),
    );
    expect(await stored("build", String(created.record_id))).toMatchObject({ sha256: "3".repeat(64), filename: "epsilon-1.html", bytes: "10" });
  });

  it("K4: a created module with the lowest evidence level goes through, and its other fields may change later", async () => {
    const created = await accept(await propose(w.developer, { create: { record_type: "module", record: epsilon("commission_list_only") } }));
    expect(await stored("module", String(created.record_id))).toMatchObject({ evidence_level: "commission_list_only" });
    await accept(await propose(w.claude, { target: { type: "module", id: String(created.record_id) }, set: { summary: "A small experiment." } }));
    expect(await stored("module", String(created.record_id))).toMatchObject({ summary: "A small experiment." });
  });

  it("K4: a created module with no evidence level is refused (403) on its own as well", async () => {
    const before = await worldState();
    await expectStatus(propose(w.developer, { create: { record_type: "module", record: epsilon(undefined) } }), 403);
    await expect(dbSubmit(w.developer, { create: { record_type: "module", record: epsilon(undefined) } })).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(CREATED_LEVEL) });
    expect(await worldState()).toEqual(before);
  });
});

describe("ROUND5 K5 (Z19) — a second clear, straight at the database", () => {
  it("accept, clear, then clear again at hq.record_founder_decision is refused (HQ422) and writes nothing", async () => {
    const decide = (state: string) =>
      asAppRole("authenticated", claimsFor(w.founder), (c) =>
        c.query("select hq.record_founder_decision($1, 'As decided.', null, $2::jsonb, '[]'::jsonb, '[]'::jsonb, null)", [
          `Set ${state}`,
          JSON.stringify([{ type: "set_acceptance", record_type: "module", record_id: "MOD-FX-GAMMA", state }]),
        ]),
      ).finally(() => clearDatasetCache());
    await decide("accepted");
    await decide("none");
    expect((await stored("module", "MOD-FX-GAMMA")).hq_acceptance).toMatchObject({ state: "none" });
    const before = await worldState();
    await expect(decide("none")).rejects.toMatchObject({ code: "HQ422", message: expect.stringMatching(/there is no acceptance or rejection recorded in HQ on MOD-FX-GAMMA to clear/) });
    expect(await worldState()).toEqual(before);
    // The service refuses it too, with the same words.
    const err = await expectStatus(
      recordFounderDecision(w.founder, { title: "Clear again", exact_text: "Cleared.", effects: [{ type: "set_acceptance", record_type: "module", record_id: "MOD-FX-GAMMA", state: "none" }] }),
      422,
    );
    expect(err.message).toMatch(/There is no acceptance or rejection recorded in HQ on MOD-FX-GAMMA to clear/);
    expect(await worldState()).toEqual(before);
  });
});
