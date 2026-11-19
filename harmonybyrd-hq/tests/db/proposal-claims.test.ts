/**
 * Fourth round (ROUND4): what a proposal may say.
 *
 *   H1   what enters through the inbox is the submitter's claim: a label that says a source reports
 *        something (reported, design_intention, source_recommendation, founder_statement) is refused
 *        unless the target already holds that very object, at the same path (HQ403, rule source_label);
 *   H2   evidence a source reports or HQ's build checked, and a source HQ has read, are frozen (HQ403);
 *   H3   "implemented and tested" is not a proposal's to say (HQ403, rule tested_claim);
 *   H4   a proposal sets only the top-level fields its record type declares (HQ422, rule unknown_field);
 *   H5   a founder decision cannot clear an acceptance that is not there (HQ422);
 *   H6c  a proposal cannot carry the text "Not a valid value" (HQ422);
 *   H7   what a refusal echoes of a client's input is bounded;
 *   H12  the freeze's own validity test, the depth of the epistemic check, the record type echo, and
 *        the detail of a refusal at acceptance.
 *
 * Every refusal is tried four ways, and each must refuse and change nothing: through the service (an AI
 * client's token and a developer's session), straight at hq.submit_proposal as authenticated, and on a
 * proposal planted in the inbox as the owner, accepted through the service (which must give the same
 * detail.rule as at submission) and straight at hq.review_proposal. A refused acceptance leaves the
 * proposal "submitted".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { acceptanceStatus, isOutstanding } from "@/lib/domain/derive";
import type { RequirementRecord } from "@/lib/domain/schemas";
import {
  getProposal,
  getRecord,
  inboxClaimProblem,
  recordFounderDecision,
  recordTestEvidence,
  reviewProposal,
  submitChangeProposal,
  submitDefectReport,
  withdrawProposal,
} from "@/lib/server/services";
import { clearDatasetCache, getDataset } from "@/lib/server/store";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld, worldState } from "../helpers/db";
import { fixtureRecords } from "../helpers/fixture";

let w: TestWorld;

const BETA = { source_id: "SRC-F01", locator: null, quote: "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only." };
const TESTS42 = { source_id: "SRC-F01", locator: null, quote: "The alpha-candidate-7 suite ran 42 automated tests and all 42 passed." };
const PROTO = { source_id: "SRC-F01", locator: null, quote: "Alpha exists as a runnable prototype named alpha-candidate-7." };
const LOOP_QUOTE = { source_id: "SRC-F01", locator: "Loop", quote: "Meet the pattern, hear it, play it slowly, play it at tempo, then come back to it after three days." };
const fixtureData = (id: string) => structuredClone(fixtureRecords().find((r) => r.id === id)!.data) as unknown as Record<string, unknown>;
const lifecycleOf = (id: string) => fixtureData(id).lifecycle as Record<string, Record<string, unknown>>;

const SOURCE_LABEL = /a proposal's claim is the submitter's own: label it submitter_claim \(it may carry quotations\)\. Labels that say a source reports something are set only by an import/i;
const FROZEN_EVIDENCE = /evidence that a source reports or HQ's build checked is changed only by an import; submit new evidence instead/i;
const FROZEN_SOURCE = /a source HQ has read is changed only by an import/i;
const TESTED = /record the tests as evidence; only an import marks a requirement as implemented and tested \(the founder can record it as satisfied by a decision\)/i;
const TESTED_FROZEN = /a requirement shown as implemented and tested is changed only by an import; a proposal may move it to another implementation state and then change it/i;
const UNKNOWN = (field: string, type: string) => new RegExp(`field "${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" is not a field of a ${type} record`, "i");
const MARKER = /a proposal cannot contain the text "Not a valid value"/i;

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
  /** What the application's refusal carries in detail, at submission and again at acceptance. */
  detail?: Record<string, unknown>;
}

const gammaY1 = () => ({
  ...lifecycleOf("MOD-FX-GAMMA"),
  prototyped: { state: "yes", basis: "reported", note: "Runnable prototype", citations: [PROTO] },
  automated_tests: { state: "yes", basis: "reported", note: "All tests pass", citations: [TESTS42] },
});
const alphaCapabilities = () => fixtureData("MOD-FX-ALPHA").capabilities as Record<string, unknown>[];
const alphaObjective = () => fixtureData("MOD-FX-ALPHA").objective as Record<string, unknown>;
const betaStatement = () => fixtureData("BLD-FX-02").statement as Record<string, unknown>;

const CASES: Case[] = [
  // ---- H1: a source label is set only by an import ----
  {
    item: "H1",
    name: "Y1: Gamma's lifecycle given prototyped and automated_tests 'yes', reported, quoting real but unrelated sentences",
    body: { target: { type: "module", id: "MOD-FX-GAMMA" }, set: { lifecycle: gammaY1() } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "lifecycle.prototyped" },
  },
  {
    item: "H1",
    name: "a loop's standing turned from design_intention into reported, with another loop's quotation",
    body: { target: { type: "loop", id: "LOOP-FX-02" }, set: { standing: "reported", citations: [LOOP_QUOTE] } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "standing" },
  },
  {
    item: "H1",
    name: "a created candidate build whose statement is 'reported', quoting Beta's acceptance",
    body: {
      create: {
        record_type: "build",
        record: { label: "gamma-1", module_id: "MOD-FX-GAMMA", standing: "candidate_not_accepted", statement: { text: "Accepted by the founder on every platform.", epistemic: "reported", citations: [BETA] } },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "statement" },
  },
  {
    item: "H1",
    name: "a withdrawal of Beta build 2's reported acceptance that rewrites its reported statement",
    body: {
      target: { type: "build", id: "BLD-FX-02" },
      set: { standing: "development", statement: { ...betaStatement(), text: "Accepted by the founder on every platform, without limits." } },
    },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "statement" },
  },
  {
    item: "H1",
    name: "an imported claim kept 'reported' with its own quotation, its text reworded",
    body: { target: { type: "module", id: "MOD-FX-ALPHA" }, set: { objective: { ...alphaObjective(), text: "Alpha is finished and tested." } } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "objective" },
  },
  {
    item: "H1",
    name: "an element of a list given a source label (a new capability, 'design_intention')",
    body: {
      target: { type: "module", id: "MOD-FX-ALPHA" },
      set: { capabilities: [...alphaCapabilities(), { title: "Score every pattern", detail: "", state: "existing", epistemic: "design_intention", citations: [PROTO] }] },
    },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "capabilities[2]" },
  },
  {
    item: "H1",
    name: "imported claims in a list moved to other positions (the list reversed)",
    body: { target: { type: "module", id: "MOD-FX-ALPHA" }, set: { capabilities: [...alphaCapabilities()].reverse() } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "capabilities[0]" },
  },
  {
    item: "H1",
    name: "a source label two levels down, inside a list element ('source_recommendation')",
    body: {
      target: { type: "module", id: "MOD-FX-DELTA" },
      set: { next_actions: [{ text: "Build Delta.", epistemic: "submitter_claim", citations: [], because: { text: "The source says so.", epistemic: "source_recommendation", citations: [PROTO] } }] },
    },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "next_actions[0].because" },
  },
  {
    item: "H1",
    name: "a created open item whose statement is a 'founder_statement' with a verbatim quotation",
    body: { create: { record_type: "open_item", record: { kind: "risk", title: "Ruling", statement: { text: "The founder ruled on it.", epistemic: "founder_statement", citations: [BETA] } } } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "statement" },
  },
  {
    item: "H1",
    name: "a pathway's top-level basis turned from design_intention into reported",
    body: { target: { type: "pathway", id: "PATH-FX-01" }, set: { basis: "reported" } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "basis" },
  },

  {
    item: "H1",
    name: "L6: a created pathway whose basis says the commission gives it as an example",
    body: {
      create: {
        record_type: "pathway",
        record: { name: "Alpha to Gamma", basis: "commission_example", steps: [{ order: 1, module_id: "MOD-FX-ALPHA", role: "practice" }, { order: 2, module_id: "MOD-FX-GAMMA", role: "improvise" }] },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "basis" },
  },
  {
    item: "H1",
    name: "L6: a pathway's basis turned from design_intention into commission_example",
    body: { target: { type: "pathway", id: "PATH-FX-01" }, set: { basis: "commission_example" } },
    status: 403,
    sqlstate: "HQ403",
    message: SOURCE_LABEL,
    detail: { rule: "source_label", field: "basis" },
  },

  // ---- H2: records HQ did not write are not rewritten by proposal ----
  {
    item: "H2",
    name: "Y2: source-reported evidence retitled and moved to another module",
    body: { target: { type: "evidence", id: "EV-FX-01" }, set: { module_ids: ["MOD-FX-GAMMA"], title: "Gamma automated suite" } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN_EVIDENCE,
    detail: { rule: "frozen_record" },
  },
  {
    item: "H2",
    name: "evidence HQ's build checked, given new module links only",
    body: { target: { type: "evidence", id: "EV-FX-02" }, set: { module_ids: ["MOD-FX-ALPHA", "MOD-FX-GAMMA"] } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN_EVIDENCE,
    detail: { rule: "frozen_record" },
  },
  {
    item: "H2",
    name: "Y5: a read source's title changed",
    body: { target: { type: "source", id: "SRC-F01" }, set: { title: "Founder's signed acceptance record" } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN_SOURCE,
    detail: { rule: "frozen_record" },
  },
  {
    item: "H2",
    name: "a read source's summary changed",
    body: { target: { type: "source", id: "SRC-F02" }, set: { summary: "Signed by the founder." } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN_SOURCE,
    detail: { rule: "frozen_record" },
  },
  {
    item: "H2",
    name: "a source stored as not accessible but carrying a text snapshot",
    body: { target: { type: "source", id: "SRC-FX-SNAP" }, set: { summary: "Renamed." } },
    status: 403,
    sqlstate: "HQ403",
    message: FROZEN_SOURCE,
    detail: { rule: "frozen_record" },
  },

  // ---- H3: implemented and tested ----
  {
    item: "H3",
    name: "Y3: a requirement made implemented_tested and linked to unrelated source-reported evidence",
    body: { target: { type: "requirement", id: "FR-FX-002" }, set: { implementation_state: "implemented_tested", linked_evidence_ids: ["EV-FX-01"] } },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED,
    detail: { rule: "tested_claim", field: "implementation_state" },
  },
  {
    item: "H3",
    name: "a requirement made implemented_tested without any link",
    body: { target: { type: "requirement", id: "FR-FX-004" }, set: { implementation_state: "implemented_tested" } },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED,
    detail: { rule: "tested_claim", field: "implementation_state" },
  },
  {
    item: "H3",
    name: "a tested requirement's linked evidence changed",
    body: { target: { type: "requirement", id: "FR-FX-001" }, set: { linked_evidence_ids: ["EV-FX-02"] } },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED_FROZEN, // ROUND5 K2: the freeze of a tested requirement, which replaced the rule on its links
    detail: { rule: "tested_claim", field: "linked_evidence_ids" },
  },
  {
    item: "H3",
    name: "a tested requirement's linked builds changed",
    body: { target: { type: "requirement", id: "FR-FX-001" }, set: { linked_build_ids: ["BLD-FX-01", "BLD-FX-02"] } },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED_FROZEN, // ROUND5 K2: the freeze of a tested requirement, which replaced the rule on its links
    detail: { rule: "tested_claim", field: "linked_build_ids" },
  },
  {
    item: "H3",
    name: "a created requirement that is already implemented_tested",
    body: {
      create: {
        record_type: "requirement",
        record: {
          exact_wording: "Every pattern must be playable at a slow tempo before a fast one.",
          source_id: "SRC-F01",
          attribution: "direct_quote",
          title: "Slow first (tested)",
          category: "pedagogy",
          implementation_state: "implemented_tested",
        },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: TESTED,
    detail: { rule: "tested_claim", field: "implementation_state" },
  },

  // ---- H4: only declared fields ----
  {
    item: "H4",
    name: "Y4: a look-alike key 'hq_acceptance ' (trailing space) holding a founder acceptance",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { "hq_acceptance ": { state: "accepted", decision_id: "FD-HQ-0001", decided_by: "founder", decided_at: "2031-03-03" } } },
    status: 422,
    sqlstate: "HQ422",
    message: UNKNOWN("hq_acceptance ", "build"),
    detail: { rule: "unknown_field", field: "hq_acceptance " },
  },
  {
    item: "H4",
    name: "Y4: a look-alike key 'Standing'",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { Standing: "accepted_reported" } },
    status: 422,
    sqlstate: "HQ422",
    message: UNKNOWN("Standing", "build"),
    detail: { rule: "unknown_field", field: "Standing" },
  },
  {
    item: "H4",
    name: "Y4: a made-up key 'founder_accepted_note'",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { founder_accepted_note: "Accepted by the founder" } },
    status: 422,
    sqlstate: "HQ422",
    message: UNKNOWN("founder_accepted_note", "build"),
    detail: { rule: "unknown_field", field: "founder_accepted_note" },
  },
  {
    item: "H4",
    name: "a field of another record type ('decision_ids' on a build)",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { decision_ids: ["FD-FX-01"] } },
    status: 422,
    sqlstate: "HQ422",
    message: UNKNOWN("decision_ids", "build"),
    detail: { rule: "unknown_field", field: "decision_ids" },
  },
  {
    item: "H4",
    name: "a created open item with a key 'Kind'",
    body: { create: { record_type: "open_item", record: { kind: "risk", Kind: "blocker", title: "Odd", statement: { text: "A risk.", epistemic: "submitter_claim", citations: [] } } } },
    status: 422,
    sqlstate: "HQ422",
    message: UNKNOWN("Kind", "open_item"),
    detail: { rule: "unknown_field", field: "Kind" },
  },

  // ---- H6c: the marker of an unreadable value is never written back ----
  {
    item: "H6c",
    name: "a title that is the text 'Not a valid value'",
    body: { target: { type: "defect", id: "DEF-FX-01" }, set: { title: "Not a valid value" } },
    status: 422,
    sqlstate: "HQ422",
    message: MARKER,
    detail: { rule: "not_a_valid_value" },
  },
  {
    item: "H6c",
    name: "the marker deep inside a lifecycle entry",
    body: { target: { type: "module", id: "MOD-FX-DELTA" }, set: { lifecycle: { ...lifecycleOf("MOD-FX-DELTA"), designed: { state: "unknown", basis: "no_evidence", note: "Not a valid value", citations: [] } } } },
    status: 422,
    sqlstate: "HQ422",
    message: MARKER,
    detail: { rule: "not_a_valid_value" },
  },
  {
    item: "H6c",
    name: "a created defect whose module list holds the marker",
    body: { create: { record_type: "defect", record: { title: "Odd", module_ids: ["Not a valid value"], status: "open", statement: { text: "x", epistemic: "submitter_claim", citations: [] } } } },
    status: 422,
    sqlstate: "HQ422",
    message: MARKER,
    detail: { rule: "not_a_valid_value" },
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
  const id = `PROP-7${String(planted).padStart(5, "0")}`;
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

const dbReview = (id: string, decision = "accept") =>
  asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select hq.review_proposal($1, $2, 'ok') as r", [id, decision])).finally(() => clearDatasetCache());

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

beforeAll(async () => {
  w = await freshWorld();
  await put(
    [
      {
        type: "source",
        id: "SRC-FX-SNAP",
        data: {
          id: "SRC-FX-SNAP",
          title: "A source stored as not accessible, with a snapshot",
          kind: "named_not_accessible",
          location: null,
          access: "not_accessible",
          authority: "referenced_only",
          text_snapshot: { file: "source-text/SRC-FX-SNAP.md", sha256: "0".repeat(64), chars: 10 },
        },
      },
      {
        type: "pathway",
        id: "PATH-FX-EX",
        data: {
          id: "PATH-FX-EX",
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
      {
        type: "source",
        id: "SRC-FX-TEXT",
        data: { id: "SRC-FX-TEXT", title: "A named source whose text HQ stores", kind: "named_not_accessible", location: null, access: "not_accessible", authority: "referenced_only" },
      },
    ],
    "Plant two odd sources",
  );
  const client = await admin();
  try {
    // Only the database knows this source's text is stored: the application cannot read hq.source_texts.
    await client.query("insert into hq.source_texts (source_id, text_norm, sha256, chars) values ('SRC-FX-TEXT', 'stored text of a named source', $1, 29)", ["0".repeat(64)]);
  } finally {
    await client.end();
  }
});

describe("ROUND4 — what a proposal may say, on every path", () => {
  for (const c of CASES) {
    describe(`${c.item}: ${c.name}`, () => {
      it(`is refused through the service with ${c.status}, for an AI client's token and a developer's session, and changes nothing`, async () => {
        for (const who of [w.claude, w.developer]) {
          const before = await worldState();
          const err = await expectStatus(submitChangeProposal(who, await serviceInput(c.body, `Probe: ${c.name}`)), c.status);
          expect(err.message).toMatch(c.message);
          if (c.detail) expect(err.detail).toMatchObject(c.detail);
          expect(await worldState()).toEqual(before);
        }
      });

      it(`is refused by hq.submit_proposal on its own with ${c.sqlstate}`, async () => {
        const before = await worldState();
        for (const who of [w.claude, w.developer]) {
          await expect(dbSubmit(who, c.body)).rejects.toMatchObject({ code: c.sqlstate, message: expect.stringMatching(c.message) });
          // The database names the same field as the application (the two walk the record in the same order).
          if (typeof c.detail?.field === "string") await expect(dbSubmit(who, c.body)).rejects.toMatchObject({ message: expect.stringContaining(`field "${c.detail.field}"`) });
        }
        expect(await worldState()).toEqual(before);
      });

      it("a planted proposal is refused when the founder accepts it through the application, with the same detail as at submission; it stays submitted", async () => {
        const id = await plant(c.body, w.claude);
        const before = await worldState();
        const err = await expectStatus(reviewProposal(w.founder, id, "accept"), c.status);
        expect(err.message).toMatch(c.message);
        if (c.detail) expect(err.detail).toMatchObject(c.detail);
        expect(await worldState()).toEqual(before);
        expect((await getProposal(w.founder, id)).status).toBe("submitted");
      });

      it(`a planted proposal is refused by hq.review_proposal on its own with ${c.sqlstate}; it stays submitted`, async () => {
        const id = await plant(c.body, w.developer);
        const before = await worldState();
        await expect(dbReview(id)).rejects.toMatchObject({ code: c.sqlstate, message: expect.stringMatching(c.message) });
        if (typeof c.detail?.field === "string") await expect(dbReview(id)).rejects.toMatchObject({ message: expect.stringContaining(`field "${c.detail.field}"`) });
        expect(await worldState()).toEqual(before);
        expect((await getProposal(w.founder, id)).status).toBe("submitted");
      });
    });
  }

  it("H2: a source whose text only the database holds is frozen there too (the application cannot see it; the database refuses)", async () => {
    const before = await worldState();
    const body = { target: { type: "source", id: "SRC-FX-TEXT" }, set: { summary: "Renamed." } };
    const err = await expectStatus(submitChangeProposal(w.claude, await serviceInput(body)), 403);
    expect(err.message).toMatch(FROZEN_SOURCE);
    await expect(dbSubmit(w.developer, body)).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(FROZEN_SOURCE) });
    const planted = await plant(body, w.claude);
    await expect(dbReview(planted)).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(FROZEN_SOURCE) });
    expect((await getProposal(w.founder, planted)).status).toBe("submitted");
    expect(await worldState()).toEqual({ ...before, proposals: before.proposals + 1, events: before.events + 1 });
  });

  it("H4: a 1 MB key is named in at most 60 characters, and the whole refusal stays small", async () => {
    const key = "k".repeat(1_000_000);
    const err = await expectStatus(submitChangeProposal(w.claude, await serviceInput({ target: { type: "build", id: "BLD-FX-01" }, set: { [key]: 1 } })), 422);
    expect(JSON.stringify({ message: err.message, detail: err.detail }).length).toBeLessThan(4096);
    expect(err.detail).toMatchObject({ rule: "unknown_field", field: "k".repeat(60) });
    const direct = await dbSubmit(w.claude, { target: { type: "build", id: "BLD-FX-01" }, set: { [key]: 1 } }).catch((e: { code: string; message: string }) => e);
    expect(direct).toMatchObject({ code: "HQ422" });
    expect((direct as { message: string }).message.length).toBeLessThan(200);
  });
});

describe("ROUND4 H1 — what still goes through: leave an imported claim as it is, remove it, or give the submitter's own claim", () => {
  it("the Y1 change as the submitter's claim, with its quotations, is accepted, and Gamma's standing does not rise", async () => {
    const ds = (await getDataset(w.founder)).ds;
    const headlineBefore = acceptanceStatus(ds, "module", "MOD-FX-GAMMA")!.headline;
    const lifecycle = {
      ...lifecycleOf("MOD-FX-GAMMA"),
      prototyped: { state: "yes", basis: "submitter_claim", note: "Runnable prototype", citations: [PROTO] },
      automated_tests: { state: "yes", basis: "submitter_claim", note: "All tests pass", citations: [TESTS42] },
    };
    await accept(await submitChangeProposal(w.claude, await serviceInput({ target: { type: "module", id: "MOD-FX-GAMMA" }, set: { lifecycle } })));
    const after = (await stored("module", "MOD-FX-GAMMA")).lifecycle as Record<string, Record<string, unknown>>;
    expect(after.automated_tests).toMatchObject({ basis: "submitter_claim" });
    // The imported entries the proposal left as they were are untouched, byte for byte.
    expect(after.documented).toEqual(lifecycleOf("MOD-FX-GAMMA").documented);
    const status = acceptanceStatus((await getDataset(w.founder)).ds, "module", "MOD-FX-GAMMA")!;
    expect(status.headline).toBe(headlineBefore);
    expect(status.headline).not.toBe("tested_not_accepted");
  });

  it("a submitter's claim still has its quotations verified: an invented one is refused (422)", async () => {
    const before = await worldState();
    const err = await expectStatus(
      submitChangeProposal(
        w.claude,
        await serviceInput({
          target: { type: "module", id: "MOD-FX-DELTA" },
          set: { objective: { text: "Delta is done.", epistemic: "submitter_claim", citations: [{ source_id: "SRC-F01", quote: "Delta was finished and accepted by everyone." }] } },
        }),
      ),
      422,
    );
    expect(err.message).toMatch(/not found verbatim in SRC-F01/);
    await expect(
      dbSubmit(w.developer, {
        target: { type: "module", id: "MOD-FX-DELTA" },
        set: { objective: { text: "Delta is done.", epistemic: "submitter_claim", citations: [{ source_id: "SRC-F01", quote: "Delta was finished and accepted by everyone." }] } },
      }),
    ).rejects.toMatchObject({ code: "HQ422", message: expect.stringMatching(/not found verbatim/) });
    expect(await worldState()).toEqual(before);
  });

  it("an imported claim resent unchanged beside a change elsewhere is accepted (Alpha's capabilities kept, its objective replaced by a submitter's claim)", async () => {
    await accept(
      await submitChangeProposal(
        w.developer,
        await serviceInput({
          target: { type: "module", id: "MOD-FX-ALPHA" },
          set: {
            capabilities: [...alphaCapabilities(), { title: "Loop a bar", detail: "", state: "partial", epistemic: "submitter_claim", citations: [] }],
            objective: { text: "Practise slowly, then at tempo.", epistemic: "submitter_claim", citations: [PROTO] },
          },
        }),
      ),
    );
    const alpha = await stored("module", "MOD-FX-ALPHA");
    expect((alpha.capabilities as unknown[]).slice(0, 2)).toEqual(alphaCapabilities());
    expect(alpha.objective).toMatchObject({ epistemic: "submitter_claim" });
  });

  it("an imported claim can be removed, or labelled no_evidence", async () => {
    await accept(await submitChangeProposal(w.claude, await serviceInput({ target: { type: "module", id: "MOD-FX-BETA" }, set: { objective: null } })));
    expect((await stored("module", "MOD-FX-BETA")).objective).toBeNull();
    await accept(
      await submitChangeProposal(
        w.claude,
        await serviceInput({ target: { type: "commission", id: "COM-FX-01" }, set: { scope: { text: "Nothing accessible says.", epistemic: "no_evidence", citations: [] } } }),
      ),
    );
    expect((await stored("commission", "COM-FX-01")).scope).toMatchObject({ epistemic: "no_evidence" });
  });

  it("the withdrawal of a reported acceptance may relabel the statement as the submitter's claim", async () => {
    await accept(
      await submitChangeProposal(
        w.developer,
        await serviceInput({
          target: { type: "build", id: "BLD-FX-02" },
          set: { standing: "candidate_not_accepted", statement: { text: "Withdrawn pending a recorded decision.", epistemic: "submitter_claim", citations: [BETA] } },
        }),
      ),
    );
    expect(await stored("build", "BLD-FX-02")).toMatchObject({ standing: "candidate_not_accepted", statement: { epistemic: "submitter_claim" } });
  });

  it("L6: a pathway created by proposal is the submitter's claim, and is shown as such", async () => {
    const steps = [{ order: 1, module_id: "MOD-FX-ALPHA", role: "practice" }, { order: 2, module_id: "MOD-FX-BETA", role: "perform" }];
    const filed = await accept(await submitChangeProposal(w.claude, await serviceInput({ create: { record_type: "pathway", record: { name: "Alpha to Beta, as submitted", basis: "submitter_claim", steps } } })));
    const id = String(filed.record_id);
    expect(await stored("pathway", id)).toMatchObject({ basis: "submitter_claim" });
    const answer = await getRecord(w.claude, "pathway", id);
    expect(answer.data).toMatchObject({ valid: true, record: { basis: "submitter_claim" } });
  });

  // ROUND5 K1 changed this: an imported pathway that keeps commission_example is frozen for proposals; a
  // change elsewhere goes through once the proposal relabels it as the submitter's claim.
  it("L6 / ROUND5 K1: an imported pathway that keeps commission_example is not changed by proposal; relabelled as the submitter's claim, it is", async () => {
    const before = await worldState();
    for (const set of [{ description: "Improvise first, then practise." }, { basis: "commission_example", name: "Gamma to Alpha" }]) {
      const err = await expectStatus(submitChangeProposal(w.developer, await serviceInput({ target: { type: "pathway", id: "PATH-FX-EX" }, set })), 403);
      expect(err.detail).toMatchObject({ rule: "source_label", field: "basis" });
    }
    expect(await worldState()).toEqual(before);
    await accept(await submitChangeProposal(w.claude, await serviceInput({ target: { type: "pathway", id: "PATH-FX-EX" }, set: { basis: "submitter_claim", name: "Gamma to Alpha" } })));
    expect(await stored("pathway", "PATH-FX-EX")).toMatchObject({ basis: "submitter_claim", name: "Gamma to Alpha" });
  });

  it("the application's own check finds each H1 case before the database is asked", async () => {
    const ds = (await getDataset(w.founder)).stored;
    for (const c of CASES.filter((x) => x.item === "H1")) {
      const type = (c.body.target?.type ?? c.body.create!.record_type) as never;
      // Against the fixture as imported: the controls above have since changed some targets.
      const current = c.body.target ? fixtureData(c.body.target.id) : null;
      expect(inboxClaimProblem(type, (c.body.set ?? c.body.create!.record) as Record<string, unknown>, current), c.name).toMatchObject({
        status: 403,
        detail: c.detail,
      });
      expect(ds).toBeDefined();
    }
  });
});

describe("ROUND4 H2, H3, H4 — what still goes through", () => {
  it("H2: a source that is only named can still be changed", async () => {
    await accept(await submitChangeProposal(w.claude, await serviceInput({ target: { type: "source", id: "SRC-F03" }, set: { summary: "Named by Handover B; never supplied." } })));
    expect(await stored("source", "SRC-F03")).toMatchObject({ summary: "Named by Handover B; never supplied." });
  });

  it("H3: implemented_unverified with linked evidence is accepted, and the requirement stays outstanding", async () => {
    await accept(
      await submitChangeProposal(w.claude, await serviceInput({ target: { type: "requirement", id: "FR-FX-002" }, set: { implementation_state: "implemented_unverified", linked_evidence_ids: ["EV-FX-01"] } })),
    );
    const ds = (await getDataset(w.founder)).ds;
    expect(isOutstanding(ds.get("requirement", "FR-FX-002")!.data as RequirementRecord, ds)).toBe(true);
  });

  // ROUND5 K2 changed this: a tested requirement is frozen for proposals unless the proposal moves it to
  // another state; retitling it with its links resent unchanged is now refused.
  it("H3 / ROUND5 K2: a tested requirement is not retitled by proposal while it stays tested; moved to another state, it may be", async () => {
    const links = (await stored("requirement", "FR-FX-001")).linked_evidence_ids;
    const before = await worldState();
    const err = await expectStatus(
      submitChangeProposal(w.developer, await serviceInput({ target: { type: "requirement", id: "FR-FX-001" }, set: { title: "Slow before fast (retitled)", linked_evidence_ids: links } })),
      403,
    );
    expect(err.detail).toMatchObject({ rule: "tested_claim", field: "title" });
    expect(await worldState()).toEqual(before);
    await accept(
      await submitChangeProposal(w.developer, await serviceInput({ target: { type: "requirement", id: "FR-FX-001" }, set: { implementation_state: "implemented_unverified", title: "Slow before fast (retitled)", linked_evidence_ids: links } })),
    );
    expect(await stored("requirement", "FR-FX-001")).toMatchObject({ title: "Slow before fast (retitled)", implementation_state: "implemented_unverified", linked_evidence_ids: links });
  });

  it("H4: the tools that build a record still pass: submit_defect_report and record_test_evidence (with code_ref and counts), through to acceptance", async () => {
    const defect = await submitDefectReport(w.claude, { title: "Alpha drops a note", description: "At tempo 200.", module_ids: ["MOD-FX-ALPHA"], build_id: "BLD-FX-01", base_rev: await head() });
    const filedDefect = await accept(defect);
    expect(await stored("defect", String(filedDefect.record_id))).toMatchObject({ reported_via: "hq_proposal_inbox", reported_by: "claude" });
    const evidence = await recordTestEvidence(w.claude, {
      title: "Alpha suite rerun",
      result_summary: "42 passed.",
      module_ids: ["MOD-FX-ALPHA"],
      code_ref: { repository: "harmonybyrd/alpha", ref: "main", path: "tests" },
      counts: { passed: 42, failed: 0, skipped: 0 },
      base_rev: await head(),
    });
    const filedEvidence = await accept(evidence);
    expect(await stored("evidence", String(filedEvidence.record_id))).toMatchObject({ verification: "agent_submitted_unverified", counts: { passed: 42 } });
  });

  it("H4: a record of every type a proposal may create still goes through, with only declared fields", async () => {
    const unknownLifecycle = Object.fromEntries(Object.keys(lifecycleOf("MOD-FX-DELTA")).map((k) => [k, { state: "unknown", basis: "no_evidence", note: "", citations: [] }]));
    const claim = (text: string) => ({ text, epistemic: "submitter_claim", citations: [] });
    const records: [string, Record<string, unknown>][] = [
      ["defect", { title: "A defect", module_ids: ["MOD-FX-ALPHA"], status: "open", statement: claim("It fails.") }],
      ["evidence", { type: "manual_test", title: "Tried it", module_ids: ["MOD-FX-ALPHA"], result: claim("It works for me.") }],
      ["open_item", { kind: "risk", title: "A risk", statement: claim("It may fail.") }],
      ["recommendation", { title: "Do this next", rationale: "Because.", rank: 9, status: "proposed" }],
      ["requirement", { exact_wording: "Every pattern must be playable at a slow tempo before a fast one.", source_id: "SRC-F01", attribution: "direct_quote", title: "Slow first", category: "pedagogy", implementation_state: "no_record" }],
      // ROUND5 K4: a created module carries the lowest evidence level (it was "named_only" before).
      ["module", { name: "Epsilon", kind: "experiment", family: "fixture", evidence_level: "commission_list_only", lifecycle: unknownLifecycle }],
      ["loop", { name: "Epsilon loop", standing: "submitter_claim" }],
      ["pathway", { name: "Alpha to Gamma", basis: "submitter_claim", steps: [{ order: 1, module_id: "MOD-FX-ALPHA", role: "practice" }, { order: 2, module_id: "MOD-FX-GAMMA", role: "improvise" }] }],
      ["commission", { code: "FX-COM-2", title: "A second commission", status: "proposed" }],
      ["build", { label: "epsilon-1", standing: "development", statement: claim("A development build.") }],
      ["source", { title: "A named document", location: null, kind: "named_not_accessible", access: "not_accessible", authority: "referenced_only" }],
    ];
    for (const [record_type, record] of records) {
      const filed = await accept(await submitChangeProposal(w.developer, await serviceInput({ create: { record_type, record } }, `Create a ${record_type}`)));
      expect(filed.record_type, record_type).toBe(record_type);
    }
  });
});

describe("ROUND4 H5 — clearing needs something to clear", () => {
  it("Y6: clearing an acceptance that was never recorded is refused (422) by the application and by the database, and nothing is written", async () => {
    const before = await worldState();
    const effects = [{ type: "set_acceptance", record_type: "build", record_id: "BLD-FX-01", state: "none" }];
    const err = await expectStatus(recordFounderDecision(w.founder, { title: "Clear alpha", exact_text: "Clear it.", effects }), 422);
    expect(err.message).toMatch(/There is no acceptance or rejection recorded in HQ on BLD-FX-01 to clear/);
    await expect(
      asAppRole("authenticated", claimsFor(w.founder), (c) =>
        c.query("select hq.record_founder_decision('Clear alpha', 'Clear it.', null, $1::jsonb, '[]'::jsonb, '[]'::jsonb, null)", [JSON.stringify(effects)]),
      ),
    ).rejects.toMatchObject({ code: "HQ422", message: expect.stringMatching(/there is no acceptance or rejection recorded in HQ on BLD-FX-01 to clear/) });
    expect(await worldState()).toEqual(before);
    expect((await stored("build", "BLD-FX-01")).hq_acceptance).toBeUndefined();
  });

  it("clearing a recorded acceptance or rejection still works, also when the same decision recorded it first", async () => {
    const r = await recordFounderDecision(w.founder, {
      title: "Accept, then clear",
      exact_text: "Accepted, then I take it back.",
      effects: [
        { type: "set_acceptance", record_type: "loop", record_id: "LOOP-FX-01", state: "accepted" },
        { type: "set_acceptance", record_type: "loop", record_id: "LOOP-FX-01", state: "none" },
      ],
    });
    clearDatasetCache();
    expect((await stored("loop", "LOOP-FX-01")).hq_acceptance).toMatchObject({ state: "none", decision_id: r.decision_id });
    await recordFounderDecision(w.founder, { title: "Reject", exact_text: "Rejected.", effects: [{ type: "set_acceptance", record_type: "loop", record_id: "LOOP-FX-01", state: "rejected" }] });
    await recordFounderDecision(w.founder, { title: "Clear the rejection", exact_text: "Cleared.", effects: [{ type: "set_acceptance", record_type: "loop", record_id: "LOOP-FX-01", state: "none" }] });
    clearDatasetCache();
    expect((await stored("loop", "LOOP-FX-01")).hq_acceptance).toMatchObject({ state: "none" });
    // A second clear has nothing left to clear.
    await expectStatus(recordFounderDecision(w.founder, { title: "Clear again", exact_text: "Cleared.", effects: [{ type: "set_acceptance", record_type: "loop", record_id: "LOOP-FX-01", state: "none" }] }), 422);
  });
});

describe("ROUND4 H12 — the freeze's own validity test, the depth of the epistemic check, and bounded echoes", () => {
  const refuseAsOwner = async (set: Record<string, unknown>) => {
    const client = await admin();
    try {
      return await client.query(
        `select hq._refuse_acceptance_claims('build', $1::jsonb,
           (select v from hq.record_versions v where record_type = 'build' and record_id = 'BLD-FX-02' order by version asc limit 1))`,
        [JSON.stringify({ op: "update", set })],
      );
    } finally {
      await client.end();
    }
  };

  it.each([["withdrawn "], ["Withdrawn"], [["withdrawn"]]])(
    "Y22: hq._refuse_acceptance_claims on its own (no enum check first) refuses a reported build 'withdrawn' to %j (HQ403)",
    async (standing) => {
      await expect(refuseAsOwner({ standing })).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/a build reported as accepted is changed only by an import/) });
    },
  );

  it("Y22 control: a valid withdrawal passes the freeze on its own", async () => {
    await expect(refuseAsOwner({ standing: "withdrawn" })).resolves.toBeDefined();
  });

  it.each([
    ["inside a list element", { blockers: [{ text: "x", citations: [], epistemic: "Verified" }] }, '"Verified"'],
    ["two levels deep", { next_actions: [{ text: "x", citations: [], epistemic: "submitter_claim", why: { text: "y", citations: [], epistemic: "Reported" } }] }, '"Reported"'],
    ["at the root of the set", { epistemic: "Reported" }, '"Reported"'],
  ])("Y23: an odd epistemic %s is refused by the database (HQ422) and by the application (422), and nothing is written", async (_where, set, shown) => {
    const before = await worldState();
    const body = { target: { type: "module", id: "MOD-FX-DELTA" }, set };
    await expect(dbSubmit(w.claude, body)).rejects.toMatchObject({ code: "HQ422", message: expect.stringContaining(`field "epistemic" holds ${shown}`) });
    const err = await expectStatus(submitChangeProposal(w.developer, await serviceInput(body)), 422);
    expect(err.detail).toMatchObject({ field: "epistemic", rule: "allowed_values" });
    expect(await worldState()).toEqual(before);
  });

  it("Y24: a 100,000-character record type is cut to 40 characters in the database's refusal", async () => {
    const err = await asAppRole("authenticated", claimsFor(w.claude), (c) =>
      c.query("select hq.submit_proposal('change_proposal', null, null, null, hq.head_rev(), 'probe', 'probe rationale', $1::jsonb)", [
        JSON.stringify({ op: "create", record_type: "Z".repeat(100_000), record: {} }),
      ]),
    ).catch((e: { code: string; message: string }) => e);
    expect(err).toMatchObject({ code: "HQ403" });
    expect((err as { message: string }).message).toBe(`payload.record_type "${"Z".repeat(40)}" cannot be created by proposal`);
  });

  it("Y26: a planted proposal refused at acceptance carries detail.rule and detail.field, as at submission", async () => {
    const cases: [Body, number, Record<string, unknown>][] = [
      [{ target: { type: "build", id: "BLD-FX-01" }, set: { standing: "accepted" } }, 422, { field: "standing", rule: "allowed_values" }],
      [{ target: { type: "build", id: "BLD-FX-01" }, set: { standing: "accepted_reported" } }, 403, { field: "standing", rule: "acceptance_claim" }],
    ];
    for (const [body, status, detail] of cases) {
      const atSubmission = await expectStatus(submitChangeProposal(w.claude, await serviceInput(body)), status);
      expect(atSubmission.detail).toMatchObject(detail);
      const id = await plant(body, w.claude);
      const atAcceptance = await expectStatus(reviewProposal(w.founder, id, "accept"), status);
      expect(atAcceptance.detail).toMatchObject(detail);
      expect((await getProposal(w.founder, id)).status).toBe("submitted");
    }
  });

  it("H12: with the application's own check now answering first at acceptance, the database's re-check of a CREATE still refuses an acceptance claim on its own (HQ403)", async () => {
    // A created build reported as accepted, its statement the submitter's own (so no other rule applies).
    const body = {
      create: {
        record_type: "build",
        record: { label: "gamma-9", module_id: "MOD-FX-GAMMA", standing: "accepted_reported", statement: { text: "Accepted.", epistemic: "submitter_claim", citations: [] } },
      },
    };
    const id = await plant(body, w.claude);
    const before = await worldState();
    await expect(dbReview(id)).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/build standing "accepted_reported": acceptance is recorded only by a founder decision/) });
    expect(await worldState()).toEqual(before);
    const err = await expectStatus(reviewProposal(w.founder, id, "accept"), 403);
    expect(err.detail).toMatchObject({ rule: "acceptance_claim", field: "standing" });
    expect((await getProposal(w.founder, id)).status).toBe("submitted");
  });

  it("H12: a refusal the database makes earlier (a protected field) keeps its own words and status at acceptance", async () => {
    const id = await plant({ target: { type: "build", id: "BLD-FX-01" }, set: { hq_checks: [], Standing: "x" } }, w.claude);
    const err = await expectStatus(reviewProposal(w.founder, id, "accept"), 403);
    expect(err.message).toMatch(/field "hq_checks" is protected and cannot be changed by a proposal/);
  });
});

describe("ROUND4 H7 — what a refusal echoes of a client's input is bounded", () => {
  const huge = "Q".repeat(1_000_000);
  const small = (e: { message: string; detail?: unknown }) => JSON.stringify({ message: e.message, detail: e.detail ?? null }).length;

  it("the not-found answers of the read services, for a 1 MB id or type, stay under 4 KB", async () => {
    for (const call of [
      () => getRecord(w.reader, "module", huge),
      () => getRecord(w.reader, huge, "MOD-FX-ALPHA"),
      () => getProposal(w.founder, huge),
    ]) {
      const err = (await call().catch((e: unknown) => e)) as { status: number; message: string; detail?: unknown };
      expect(err.status).toBeGreaterThanOrEqual(400);
      expect(small(err)).toBeLessThan(4096);
    }
  });

  it("a proposal's refusals, for a 1 MB target id, 20 one-MB linked ids, or a 1 MB proposal id, stay under 4 KB", async () => {
    const missing = await expectStatus(
      submitChangeProposal(w.claude, { title: "Probe", rationale: "Probe.", base_rev: await head(), target: { type: "module", id: huge, base_version: 1 }, set: { summary: "x" } }),
      404,
    );
    expect(small(missing)).toBeLessThan(4096);
    const links = await expectStatus(
      submitChangeProposal(w.claude, await serviceInput({ target: { type: "requirement", id: "FR-FX-003" }, set: { linked_evidence_ids: Array.from({ length: 20 }, (_, i) => `EV-${i}${huge}`) } })),
      422,
    );
    expect(small(links)).toBeLessThan(4096);
    const review = await expectStatus(reviewProposal(w.founder, huge, "accept"), 404);
    expect(small(review)).toBeLessThan(4096);
    const withdraw = (await withdrawProposal(w.claude, huge).catch((e: unknown) => e)) as { message: string };
    expect(withdraw.message.length).toBeLessThan(4096);
  });

  it("a founder decision's refusals, for 1 MB ids, stay under 4 KB", async () => {
    const err = await expectStatus(
      recordFounderDecision(w.founder, {
        title: "Probe",
        exact_text: "Probe.",
        resolves: Array.from({ length: 20 }, () => huge),
        effects: [{ type: "set_acceptance", record_type: "build", record_id: huge, state: "accepted" }],
      }),
      422,
    );
    expect(small(err)).toBeLessThan(4096);
  });

  it("the database's own refusals, for 1 MB ids, stay under 4 KB", async () => {
    const asClaude = (sql: string, args: unknown[]) => asAppRole("authenticated", claimsFor(w.claude), (c) => c.query(sql, args)).catch((e: { message: string }) => e);
    const asFounder = (sql: string, args: unknown[]) => asAppRole("authenticated", claimsFor(w.founder), (c) => c.query(sql, args)).catch((e: { message: string }) => e);
    const answers = [
      await asClaude("select hq.submit_proposal('change_proposal', 'module', $1, 1, hq.head_rev(), 'p', 'probe', $2::jsonb)", [huge, JSON.stringify({ op: "update", set: { summary: "x" } })]),
      await asClaude("select hq.submit_proposal('change_proposal', 'module', 'MOD-FX-DELTA', 1, hq.head_rev(), 'p', 'probe', $1::jsonb)", [
        JSON.stringify({ op: "update", set: { objective: { text: "x", epistemic: "submitter_claim", citations: [{ source_id: huge, quote: "a quotation long enough" }] } } }),
      ]),
      await asClaude("select hq.withdraw_proposal($1)", [huge]),
      await asFounder("select hq.review_proposal($1, 'accept')", [huge]),
      await asFounder("select hq.record_founder_decision('Probe', 'Probe text', null, $1::jsonb)", [JSON.stringify([{ type: "set_acceptance", record_type: "build", record_id: huge, state: "accepted" }])]),
      await asFounder("select hq.record_founder_decision('Probe', 'Probe text', null, $1::jsonb)", [JSON.stringify([{ type: "set_acceptance", record_type: huge, record_id: "x", state: "accepted" }])]),
      await asFounder("select hq.founder_issue_credential($1, 'probe', array['read'], 'hq_x', 'hash')", [huge]),
    ];
    for (const a of answers) expect((a as { message?: string }).message?.length ?? 0, String((a as { message?: string }).message).slice(0, 100)).toBeLessThan(4096);
    for (const a of answers) expect(a).toHaveProperty("message");
  });
});
