/**
 * Third round (ROUND3 G1): no way round the acceptance rules through the database path.
 *
 *   G1a  a build a source reports as accepted is frozen for proposals: only a proposal that withdraws
 *        the reported acceptance (a different, valid standing) may change it;
 *   G1b  a module's founder_accepted entry must stay identical as a whole object, and any state other
 *        than exactly no, unknown or not_applicable counts as positive;
 *   G1c  the database checks the values that drive labels itself (hq.field_enums), in the record as it
 *        would stand: the fields a proposal sets, and always the fields that drive acceptance;
 *   G1d  accepting a proposal through the application validates the whole resulting record.
 *
 * Every case is tried four ways, and each must refuse and change nothing: through the service (an AI
 * client's token and a developer's session), straight at hq.submit_proposal as authenticated, and on a
 * proposal planted in the inbox as the owner, accepted through the service and straight at
 * hq.review_proposal. A refused acceptance leaves the proposal "submitted".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { canonicalJson } from "@/lib/domain/pack";
import { acceptanceClaimProblem, getProposal, reviewProposal, submitChangeProposal } from "@/lib/server/services";
import { clearDatasetCache, getDataset } from "@/lib/server/store";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld, worldState } from "../helpers/db";
import { fixtureRecords } from "../helpers/fixture";

let w: TestWorld;

const BETA = { source_id: "SRC-F01", locator: null, quote: "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only." };
const ALPHA = { source_id: "SRC-F01", locator: null, quote: "Alpha candidate 7 is a candidate and has not been accepted." };
const fixtureData = (id: string) => structuredClone(fixtureRecords().find((r) => r.id === id)!.data) as unknown as Record<string, unknown>;
const lifecycleOf = (id: string) => fixtureData(id).lifecycle as Record<string, Record<string, unknown>>;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ACCEPTANCE_RULE = /acceptance is recorded only by a founder decision in HQ or by an import; a proposal cannot assert it/i;
const FROZEN = /a build reported as accepted is changed only by an import or a founder decision; a proposal may only withdraw the reported acceptance/i;
/** The database's and the application's words for a value outside a field's list (G1c). */
const odd = (field: string, shown: string) => new RegExp(`field "${escape(field)}" holds ${escape(shown)}, which is not one of its allowed values`, "i");
const notObject = (field: string) => new RegExp(`field "${escape(field)}" must be an object`, "i");

/** A build claimed as accepted with no source quoted (planted by import, as an older store could hold it). */
const CLAIMED_BUILD = {
  id: "BLD-FX-03",
  label: "gamma-preview-1",
  module_id: "MOD-FX-GAMMA",
  filename: null,
  sha256: null,
  bytes: null,
  standing: "accepted_reported",
  statement: { text: "Said to be accepted.", epistemic: "submitter_claim", citations: [] },
  artifact_source_id: null,
  citations: [],
};

interface Body {
  target?: { type: string; id: string };
  set?: Record<string, unknown>;
  create?: { record_type: string; record: Record<string, unknown> };
}

interface Case {
  rule: "G1a" | "G1b" | "G1c";
  name: string;
  body: Body;
  status: 403 | 422;
  sqlstate: "HQ403" | "HQ422";
  message: RegExp;
}

const gammaWith = (founderAccepted: unknown) => ({ ...lifecycleOf("MOD-FX-GAMMA"), founder_accepted: founderAccepted });
const betaEntry = () => lifecycleOf("MOD-FX-BETA").founder_accepted;

const CASES: Case[] = [
  // G1c — values that drive labels, checked by the database itself
  { rule: "G1c", name: 'build standing "accepted"', body: { target: { type: "build", id: "BLD-FX-01" }, set: { standing: "accepted" } }, status: 422, sqlstate: "HQ422", message: odd("standing", '"accepted"') },
  {
    rule: "G1c",
    name: 'build standing "Accepted_Reported"',
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { standing: "Accepted_Reported" } },
    status: 422,
    sqlstate: "HQ422",
    message: odd("standing", '"Accepted_Reported"'),
  },
  {
    rule: "G1c",
    name: 'build standing given as a list ["accepted_reported"]',
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { standing: ["accepted_reported"] } },
    status: 422,
    sqlstate: "HQ422",
    message: odd("standing", '["accepted_reported"]'),
  },
  {
    rule: "G1c",
    name: 'the reported build\'s standing given as a list ["accepted_reported"]',
    body: { target: { type: "build", id: "BLD-FX-02" }, set: { standing: ["accepted_reported"] } },
    status: 422,
    sqlstate: "HQ422",
    message: odd("standing", '["accepted_reported"]'),
  },
  {
    rule: "G1c",
    name: 'the reported build "withdrawn" to a standing that does not exist ("withdrawn ")',
    body: { target: { type: "build", id: "BLD-FX-02" }, set: { standing: "withdrawn " } },
    status: 422,
    sqlstate: "HQ422",
    message: odd("standing", '"withdrawn "'),
  },
  {
    rule: "G1c",
    name: 'a created build with standing "accepted"',
    body: {
      create: {
        record_type: "build",
        record: { label: "gamma-2", module_id: "MOD-FX-GAMMA", standing: "accepted", statement: { text: "Accepted.", epistemic: "submitter_claim", citations: [] } },
      },
    },
    status: 422,
    sqlstate: "HQ422",
    message: odd("standing", '"accepted"'),
  },
  {
    rule: "G1c",
    name: 'a module founder_accepted state "Yes" with a real citation',
    body: { target: { type: "module", id: "MOD-FX-GAMMA" }, set: { lifecycle: gammaWith({ state: "Yes", basis: "reported", note: "Accepted by the founder", citations: [BETA] }) } },
    status: 422,
    sqlstate: "HQ422",
    message: odd("lifecycle.founder_accepted.state", '"Yes"'),
  },
  {
    rule: "G1c",
    name: "a module founder_accepted given as a list",
    body: { target: { type: "module", id: "MOD-FX-GAMMA" }, set: { lifecycle: gammaWith([{ state: "yes", basis: "reported", note: "", citations: [BETA] }]) } },
    status: 422,
    sqlstate: "HQ422",
    message: notObject("lifecycle.founder_accepted"),
  },
  {
    rule: "G1c",
    name: "a module lifecycle given as a list",
    body: { target: { type: "module", id: "MOD-FX-GAMMA" }, set: { lifecycle: [{ founder_accepted: { state: "yes", basis: "reported", note: "", citations: [BETA] } }] } },
    status: 422,
    sqlstate: "HQ422",
    message: notObject("lifecycle"),
  },
  {
    rule: "G1c",
    name: 'a module lifecycle with a look-alike dimension "founder_accepted " (trailing space)',
    body: {
      target: { type: "module", id: "MOD-FX-GAMMA" },
      set: { lifecycle: { ...lifecycleOf("MOD-FX-GAMMA"), "founder_accepted ": { state: "yes", basis: "reported", note: "", citations: [BETA] } } },
    },
    status: 422,
    sqlstate: "HQ422",
    message: /field "lifecycle" holds the key "founder_accepted ", which is not one of its allowed keys/i,
  },
  {
    rule: "G1c",
    name: 'a lifecycle basis "Reported" on another dimension',
    body: {
      target: { type: "module", id: "MOD-FX-GAMMA" },
      set: { lifecycle: { ...lifecycleOf("MOD-FX-GAMMA"), documented: { state: "yes", basis: "Reported", note: "", citations: [BETA] } } },
    },
    status: 422,
    sqlstate: "HQ422",
    message: odd("lifecycle.documented.basis", '"Reported"'),
  },
  {
    rule: "G1c",
    name: 'a created module whose lifecycle state is "YES"',
    body: {
      create: {
        record_type: "module",
        record: { name: "Epsilon", kind: "module", family: "fixture", evidence_level: "named_only", lifecycle: gammaWith({ state: "YES", basis: "reported", note: "", citations: [BETA] }) },
      },
    },
    status: 422,
    sqlstate: "HQ422",
    message: odd("lifecycle.founder_accepted.state", '"YES"'),
  },
  {
    rule: "G1c",
    name: 'created evidence typed "founder_acceptance " (trailing space)',
    body: {
      create: {
        record_type: "evidence",
        record: { type: "founder_acceptance ", title: "Beta build 2 sign-off", module_ids: ["MOD-FX-BETA"], build_id: "BLD-FX-02", result: { text: "Signed off.", epistemic: "submitter_claim", citations: [] } },
      },
    },
    status: 422,
    sqlstate: "HQ422",
    message: odd("type", '"founder_acceptance "'),
  },
  {
    rule: "G1c",
    name: 'a statement labelled "Reported" (not a label)',
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { statement: { text: "Accepted.", epistemic: "Reported", citations: [BETA] } } },
    status: 422,
    sqlstate: "HQ422",
    message: odd("epistemic", '"Reported"'),
  },
  {
    rule: "G1c",
    name: 'a nested statement labelled "verified " in a created open item',
    body: {
      create: { record_type: "open_item", record: { kind: "risk", title: "Checked", statement: { text: "Checked by HQ.", epistemic: "verified ", citations: [] } } },
    },
    status: 422,
    sqlstate: "HQ422",
    message: odd("epistemic", '"verified "'),
  },
  { rule: "G1c", name: 'a defect severity "critical"', body: { target: { type: "defect", id: "DEF-FX-01" }, set: { severity: "critical" } }, status: 422, sqlstate: "HQ422", message: odd("severity", '"critical"') },
  // G1b — the whole founder_accepted entry is compared
  {
    rule: "G1b",
    name: "Beta's reported acceptance restated identically, plus a scope key",
    body: { target: { type: "module", id: "MOD-FX-BETA" }, set: { lifecycle: { ...lifecycleOf("MOD-FX-BETA"), founder_accepted: { ...betaEntry(), scope: "all browsers and phones" } } } },
    status: 403,
    sqlstate: "HQ403",
    message: ACCEPTANCE_RULE,
  },
  {
    rule: "G1b",
    name: "Beta's reported acceptance in another key order plus hq_confirmed",
    body: {
      target: { type: "module", id: "MOD-FX-BETA" },
      set: {
        lifecycle: {
          ...lifecycleOf("MOD-FX-BETA"),
          founder_accepted: { citations: betaEntry().citations, note: betaEntry().note, basis: betaEntry().basis, state: betaEntry().state, hq_confirmed: true },
        },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: ACCEPTANCE_RULE,
  },
  // G1a — a build reported as accepted is frozen unless the proposal withdraws it
  {
    rule: "G1a",
    name: "a claimed build's statement relabelled as reported, quoting a real sentence",
    body: { target: { type: "build", id: "BLD-FX-03" }, set: { statement: { text: "Accepted by the founder.", epistemic: "reported", citations: [BETA] } } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN,
  },
  {
    rule: "G1a",
    name: "a reported build's statement rewritten to widen the scope (a substring of the real sentence)",
    body: {
      target: { type: "build", id: "BLD-FX-02" },
      set: {
        statement: {
          text: "Reported as accepted by the founder on every platform, without limits.",
          epistemic: "reported",
          citations: [{ source_id: "SRC-F01", locator: null, quote: "Beta build 2 was accepted by the founder" }],
        },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN,
  },
  {
    rule: "G1a",
    name: "a reported build's statement swapped for one quoting 'has not been accepted'",
    body: { target: { type: "build", id: "BLD-FX-02" }, set: { statement: { text: "Accepted for all platforms", epistemic: "founder_statement", citations: [ALPHA] } } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN,
  },
  {
    rule: "G1a",
    name: "a reported build moved to another module and relabelled",
    body: { target: { type: "build", id: "BLD-FX-02" }, set: { module_id: "MOD-FX-GAMMA", label: "Gamma build 1" } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN,
  },
  {
    rule: "G1a",
    name: "a reported build renamed, restating its standing",
    body: { target: { type: "build", id: "BLD-FX-02" }, set: { label: "beta-build-2 (desktop)", standing: "accepted_reported" } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN,
  },
  { rule: "G1a", name: "a reported build given a checksum", body: { target: { type: "build", id: "BLD-FX-02" }, set: { sha256: "2".repeat(64) } }, status: 403, sqlstate: "HQ403", message: FROZEN },
  {
    rule: "G1a",
    name: "a reported build pointed at another source as its artifact",
    body: { target: { type: "build", id: "BLD-FX-02" }, set: { artifact_source_id: "SRC-F02" } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN,
  },
];

const head = async () => (await getDataset(w.founder)).head;
async function baseVersion(type: string, id: string): Promise<number> {
  const record = (await getDataset(w.founder)).ds.get(type as never, id);
  if (!record) throw new Error(`no ${type} ${id}`);
  return record.meta.version;
}

async function serviceInput(c: Case) {
  return {
    title: `Probe: ${c.name}`.slice(0, 200),
    rationale: "Regression probe.",
    base_rev: await head(),
    ...(c.body.target ? { target: { ...c.body.target, base_version: await baseVersion(c.body.target.type, c.body.target.id) } } : {}),
    ...(c.body.set ? { set: c.body.set } : {}),
    ...(c.body.create ? { create: c.body.create } : {}),
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

/** Straight at hq.review_proposal as the founder in a signed-in session. */
const dbReview = (id: string, decision = "accept") =>
  asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select hq.review_proposal($1, $2, 'ok') as r", [id, decision])).finally(() => clearDatasetCache());

/** Import records as the owner, as a pack import would (no schema check: this is how odd data could be stored). */
async function put(records: { type: string; id: string; data: Record<string, unknown> }[], why: string) {
  const client = await admin();
  try {
    await client.query("select hq.admin_put_records($1::jsonb, $2, null, 'hq-import', false)", [JSON.stringify(records), why]);
  } finally {
    await client.end();
  }
  clearDatasetCache();
}

/** The record exactly as stored (not the conformed view the readers get): what the write-path rules compare. */
const recordData = async (type: string, id: string) => (await getDataset(w.founder)).stored.get(type as never, id)!.data as unknown as Record<string, unknown>;

beforeAll(async () => {
  w = await freshWorld();
  await put([{ type: "build", id: "BLD-FX-03", data: CLAIMED_BUILD }], "Plant a build claimed as accepted with no source quoted");
});

describe("G1 — the acceptance rules hold on every path", () => {
  for (const c of CASES) {
    describe(`${c.rule}: ${c.name}`, () => {
      it(`is refused through the service with ${c.status}, for an AI client's token and a developer's session, and changes nothing`, async () => {
        for (const who of [w.claude, w.developer]) {
          const before = await worldState();
          const err = await expectStatus(submitChangeProposal(who, await serviceInput(c)), c.status);
          expect(err.message).toMatch(c.message);
          if (c.status === 403) expect(err.detail).toMatchObject({ rule: "acceptance_claim" });
          expect(await worldState()).toEqual(before);
        }
      });

      it(`is refused by hq.submit_proposal on its own with ${c.sqlstate}`, async () => {
        const before = await worldState();
        for (const who of [w.claude, w.developer]) {
          await expect(dbSubmit(who, c.body)).rejects.toMatchObject({ code: c.sqlstate, message: expect.stringMatching(c.message) });
        }
        expect(await worldState()).toEqual(before);
      });

      it("a planted proposal is refused when the founder accepts it through the application; it stays submitted", async () => {
        const id = await plant(c.body, w.claude);
        const before = await worldState();
        const err = await expectStatus(reviewProposal(w.founder, id, "accept"), c.status);
        // The application validates the resulting record first (G1d), so a value the schema refuses is
        // answered with the schema's words; otherwise the database's rule answers.
        if (c.status === 403) expect(err.message).toMatch(c.message);
        expect(await worldState()).toEqual(before);
        expect((await getProposal(w.founder, id)).status).toBe("submitted");
      });

      it(`a planted proposal is refused by hq.review_proposal on its own with ${c.sqlstate}; it stays submitted`, async () => {
        const id = await plant(c.body, w.developer);
        const before = await worldState();
        await expect(dbReview(id)).rejects.toMatchObject({ code: c.sqlstate, message: expect.stringMatching(c.message) });
        expect(await worldState()).toEqual(before);
        expect((await getProposal(w.founder, id)).status).toBe("submitted");
      });
    });
  }

  it("the application's own check refuses every G1a and G1b case with 403 acceptance_claim before the database is asked", async () => {
    const ds = (await getDataset(w.founder)).ds;
    for (const c of CASES.filter((x) => x.rule !== "G1c")) {
      const type = (c.body.target?.type ?? c.body.create!.record_type) as never;
      const current = c.body.target ? (ds.get(type, c.body.target.id)!.data as unknown as Record<string, unknown>) : null;
      expect(acceptanceClaimProblem(type, (c.body.set ?? c.body.create!.record) as Record<string, unknown>, current), c.name).toMatchObject({
        status: 403,
        detail: { rule: "acceptance_claim" },
        message: expect.stringMatching(c.message),
      });
    }
  });
});

describe("G1b — any state but no, unknown or not_applicable counts as positive, even where the enum check is gone", () => {
  // The enum check (G1c) refuses these values first. Here the acceptance rule is called on its own, as
  // the owner, so it is proven to hold without the enum check.
  const refuseAsOwner = async (set: Record<string, unknown>) => {
    const client = await admin();
    try {
      return await client.query(
        `select hq._refuse_acceptance_claims('module', $1::jsonb,
           (select v from hq.record_versions v where record_type = 'module' and record_id = 'MOD-FX-GAMMA' order by version desc limit 1))`,
        [JSON.stringify({ op: "update", set })],
      );
    } finally {
      await client.end();
    }
  };
  const positives: [string, unknown][] = [
    ['state "Yes"', { state: "Yes", basis: "reported", note: "", citations: [BETA] }],
    ['state "YES"', { state: "YES", basis: "reported", note: "", citations: [BETA] }],
    ['state "yes " (trailing space)', { state: "yes ", basis: "reported", note: "", citations: [BETA] }],
    ["no state at all", { basis: "reported", note: "Accepted", citations: [BETA] }],
    ["a state that is a list", { state: ["yes"], basis: "reported", note: "", citations: [BETA] }],
    ["the entry given as a list", [{ state: "yes" }]],
    ["the entry given as null", null],
  ];

  for (const [name, entry] of positives) {
    it(`${name} is refused by hq._refuse_acceptance_claims (HQ403) and by acceptanceClaimProblem (403)`, async () => {
      const set = { lifecycle: gammaWith(entry) };
      await expect(refuseAsOwner(set)).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(ACCEPTANCE_RULE) });
      const current = await recordData("module", "MOD-FX-GAMMA");
      expect(acceptanceClaimProblem("module", set, current)).toMatchObject({ status: 403, detail: { rule: "acceptance_claim", field: "lifecycle.founder_accepted" } });
    });
  }

  it("control: a negative state with a new note is not a claim of acceptance", async () => {
    const set = { lifecycle: gammaWith({ state: "no", basis: "reported", note: "Not accepted", citations: [ALPHA] }) };
    await expect(refuseAsOwner(set)).resolves.toBeDefined();
    expect(acceptanceClaimProblem("module", set, await recordData("module", "MOD-FX-GAMMA"))).toBeNull();
  });
});

describe("G1c — the stored record: only what the proposal sets, plus the fields that drive acceptance", () => {
  it("a stored odd value in a field the proposal does not touch does not block an ordinary change", async () => {
    await put([{ type: "defect", id: "DEF-FX-02", data: { ...fixtureData("DEF-FX-02"), severity: "critical" } }], "Plant a defect with an odd severity");
    const id = await dbSubmit(w.claude, { target: { type: "defect", id: "DEF-FX-02" }, set: { title: "Resolved: dropped note" } });
    await dbReview(id);
    expect(await recordData("defect", "DEF-FX-02")).toMatchObject({ title: "Resolved: dropped note", severity: "critical" });
  });

  it("a stored odd value in a field that drives acceptance blocks every change until it is corrected", async () => {
    await put([{ type: "build", id: "BLD-FX-04", data: { ...CLAIMED_BUILD, id: "BLD-FX-04", label: "gamma-preview-2", standing: "accepted" } }], "Plant a build with an odd standing");
    const before = await worldState();
    await expect(dbSubmit(w.claude, { target: { type: "build", id: "BLD-FX-04" }, set: { label: "gamma-preview-2b" } })).rejects.toMatchObject({
      code: "HQ422",
      message: expect.stringMatching(odd("standing", '"accepted"')),
    });
    expect(await worldState()).toEqual(before);
    // Correcting it is a withdrawal to a valid standing, and is allowed.
    const fix = await dbSubmit(w.developer, { target: { type: "build", id: "BLD-FX-04" }, set: { standing: "unknown" } });
    await dbReview(fix);
    expect((await recordData("build", "BLD-FX-04")).standing).toBe("unknown");
  });

  it("evidence typed with a trailing space is refused on an update too (an inbox submission, so not locked)", async () => {
    const created = await dbSubmit(w.claude, {
      create: {
        record_type: "evidence",
        record: { type: "automated_test", title: "Beta build 2 suite", module_ids: ["MOD-FX-BETA"], build_id: "BLD-FX-02", result: { text: "Passed.", epistemic: "submitter_claim", citations: [] } },
      },
    });
    const filed = (await dbReview(created)).rows[0].r as { record_id: string };
    const before = await worldState();
    await expect(dbSubmit(w.claude, { target: { type: "evidence", id: filed.record_id }, set: { type: "founder_acceptance " } })).rejects.toMatchObject({
      code: "HQ422",
      message: expect.stringMatching(odd("type", '"founder_acceptance "')),
    });
    await expectStatus(
      submitChangeProposal(w.claude, {
        title: "Retype",
        rationale: "Probe.",
        base_rev: await head(),
        target: { type: "evidence", id: filed.record_id, base_version: await baseVersion("evidence", filed.record_id) },
        set: { type: "founder_acceptance " },
      }),
      422,
    );
    expect(await worldState()).toEqual(before);
  });
});

describe("G1d — accepting a proposal validates the whole resulting record", () => {
  // Values no database rule covers, but the record schema refuses: an empty label, a statement with no
  // label at all. A proposal carrying them can only have been planted.
  const SCHEMA_ONLY: [string, Body][] = [
    ["an empty label", { target: { type: "build", id: "BLD-FX-01" }, set: { label: "" } }],
    ["a statement with no epistemic label", { target: { type: "build", id: "BLD-FX-01" }, set: { statement: { text: "Fine." } } }],
    ["a created defect with no statement", { create: { record_type: "defect", record: { title: "No statement", status: "open" } } }],
  ];

  for (const [name, body] of SCHEMA_ONLY) {
    it(`${name}: the database alone would apply it; the application refuses with 422, nothing is applied, the refusal is audited`, async () => {
      const id = await plant(body, w.claude);
      const before = await worldState();
      const err = await expectStatus(reviewProposal(w.founder, id, "accept"), 422);
      expect(err).toMatchObject({ code: "invalid_request", message: expect.stringMatching(new RegExp(`Accepting ${id} would make the record invalid`)) });
      expect(Array.isArray(err.detail) && err.detail.length).toBeTruthy();
      expect(await worldState()).toEqual(before);
      expect((await getProposal(w.founder, id)).status).toBe("submitted");
      const client = await admin();
      try {
        const row = await client.query("select principal_handle, outcome, detail from hq.audit_log where action = 'proposal.review' and object_id = $1 order by id desc limit 1", [id]);
        expect(row.rows[0]).toMatchObject({ principal_handle: "founder", outcome: "denied", detail: { status: 422, code: "invalid_request" } });
      } finally {
        await client.end();
      }
      // The founder can still reject it.
      await reviewProposal(w.founder, id, "reject", "Not valid.");
      expect((await getProposal(w.founder, id)).status).toBe("rejected");
    });
  }

  it("validation comes before the stale check: an invalid proposal whose target has moved on is refused, not marked stale", async () => {
    const id = await plant({ target: { type: "build", id: "BLD-FX-01" }, set: { label: "" } }, w.claude);
    const moved = await submitChangeProposal(w.developer, {
      title: "Name the file",
      rationale: "Moves the target on.",
      base_rev: await head(),
      target: { type: "build", id: "BLD-FX-01", base_version: await baseVersion("build", "BLD-FX-01") },
      set: { filename: "alpha-candidate-7.html" },
    });
    await reviewProposal(w.founder, (moved.proposal as { id: string }).id, "accept");
    const before = await worldState();
    await expectStatus(reviewProposal(w.founder, id, "accept"), 422);
    expect(await worldState()).toEqual(before);
    expect((await getProposal(w.founder, id)).status).toBe("submitted");
  });
});

describe("G1 — what still goes through", () => {
  beforeAll(async () => {
    w = await freshWorld();
  });

  it("withdrawing a reported acceptance is accepted, through the service and straight at the database, and may change other fields", async () => {
    const submitted = await submitChangeProposal(w.developer, {
      title: "Withdraw the reported acceptance",
      rationale: "The handover says it was only a candidate.",
      base_rev: await head(),
      target: { type: "build", id: "BLD-FX-02", base_version: await baseVersion("build", "BLD-FX-02") },
      set: { standing: "candidate_not_accepted", label: "Beta build 2 (candidate)", statement: { text: "A candidate only.", epistemic: "submitter_claim", citations: [] } },
    });
    await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    expect(await recordData("build", "BLD-FX-02")).toMatchObject({ standing: "candidate_not_accepted", label: "Beta build 2 (candidate)" });

    await put([{ type: "build", id: "BLD-FX-03", data: CLAIMED_BUILD }], "Plant a claimed build");
    const direct = await dbSubmit(w.claude, { target: { type: "build", id: "BLD-FX-03" }, set: { standing: "unknown" } });
    await dbReview(direct);
    expect((await recordData("build", "BLD-FX-03")).standing).toBe("unknown");
  });

  it("an ordinary change to a build that is not reported as accepted is accepted, and leaves its statement byte for byte", async () => {
    const before = canonicalJson((await recordData("build", "BLD-FX-01")).statement);
    const submitted = await submitChangeProposal(w.claude, {
      title: "Rename alpha",
      rationale: "Clearer.",
      base_rev: await head(),
      target: { type: "build", id: "BLD-FX-01", base_version: await baseVersion("build", "BLD-FX-01") },
      set: { label: "alpha-candidate-7 (renamed)" },
    });
    await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    const after = await recordData("build", "BLD-FX-01");
    expect(after.label).toBe("alpha-candidate-7 (renamed)");
    expect(canonicalJson(after.statement)).toBe(before);
  });

  it("an ordinary change to a module that carries a reported acceptance, leaving the entry byte for byte, is accepted", async () => {
    const entry = canonicalJson(((await recordData("module", "MOD-FX-BETA")).lifecycle as Record<string, unknown>).founder_accepted);
    const submitted = await submitChangeProposal(w.developer, {
      title: "Beta summary",
      rationale: "Clearer.",
      base_rev: await head(),
      target: { type: "module", id: "MOD-FX-BETA", base_version: await baseVersion("module", "MOD-FX-BETA") },
      set: { summary: "Beta, as reported." },
    });
    await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    const lifecycle = structuredClone((await recordData("module", "MOD-FX-BETA")).lifecycle) as Record<string, Record<string, unknown>>;
    expect(canonicalJson(lifecycle.founder_accepted)).toBe(entry);
    // And again with the whole lifecycle resent, another dimension changed, the entry identical.
    lifecycle.designed = { state: "yes", basis: "reported", note: "Designed", citations: [BETA] };
    const direct = await dbSubmit(w.claude, { target: { type: "module", id: "MOD-FX-BETA" }, set: { lifecycle } });
    await dbReview(direct);
    const after = (await recordData("module", "MOD-FX-BETA")).lifecycle as Record<string, Record<string, unknown>>;
    expect(after.designed.note).toBe("Designed");
    expect(canonicalJson(after.founder_accepted)).toBe(entry);
  });
});
