/**
 * What the proposal inbox may assert (design D1a–c, D15) — migration 0005 and services.ts.
 *
 * Every rule is tried three ways, and each must refuse with the same status and change nothing:
 *   1. through the service layer as an AI client (API token) and as a developer (session);
 *   2. straight at the database with hq.submit_proposal as the authenticated role, so the database
 *      rule is proven on its own, without the application's mirror;
 *   3. at acceptance: the payload is planted in the inbox as the owner (bypassing submission) and the
 *      founder's accept is refused by hq.review_proposal.
 * Positive controls show that a proposal quoting the fixture's source text verbatim still goes through.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { normaliseForQuote } from "@/lib/domain/pack";
import { BUILD_ONLY_FIELDS, PROTECTED_FIELDS } from "@/lib/domain/schemas";
import { getProposal, getRecord, proposalImpact, recordTestEvidence, reviewProposal, submitChangeProposal } from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld, worldState } from "../helpers/db";

let w: TestWorld;

interface Body {
  target?: { type: string; id: string };
  set?: Record<string, unknown>;
  create?: { record_type: string; record: Record<string, unknown> };
}

interface Case {
  rule: string;
  name: string;
  body: Body;
  status: 403 | 409 | 422;
  sqlstate: "HQ403" | "HQ409" | "HQ422";
  /** Matches both the application's message and the database's. */
  message: RegExp;
  /** When the database words it differently. */
  dbMessage?: RegExp;
}

const invented = "This sentence was invented by the client and is in no source.";

const CASES: Case[] = [
  // D1a — quotations verified against the stored source text
  {
    rule: "D1a",
    name: "an invented quotation in an update",
    body: {
      target: { type: "module", id: "MOD-FX-GAMMA" },
      set: { objective: { text: "Gamma is ready.", epistemic: "reported", citations: [{ source_id: "SRC-F01", quote: invented }] } },
    },
    status: 422,
    sqlstate: "HQ422",
    message: /quotation not found verbatim in SRC-F01: "This sentence was invented/i,
  },
  {
    rule: "D1a",
    name: "a created requirement whose exact wording is not in its source",
    body: {
      create: {
        record_type: "requirement",
        record: { exact_wording: "Ship the leaderboard to all children by Friday", source_id: "SRC-F01", attribution: "direct_quote", title: "Leaderboard", category: "scope", implementation_state: "no_record" },
      },
    },
    status: 422,
    sqlstate: "HQ422",
    message: /exact_wording not found verbatim in SRC-F01: "Ship the leaderboard/i,
  },
  {
    rule: "D1a",
    name: "a created requirement citing a source that does not exist",
    body: {
      create: {
        record_type: "requirement",
        record: { exact_wording: "Keep the interface free of pop-up windows.", source_id: "SRC-NOPE", attribution: "direct_quote", title: "Ghost", category: "ui_ux", implementation_state: "no_record" },
      },
    },
    status: 422,
    sqlstate: "HQ422",
    message: /SRC-NOPE has no stored text/i,
  },
  {
    rule: "D1a",
    name: "a citation of a source that is named but has no text",
    body: {
      create: {
        record_type: "open_item",
        record: {
          kind: "risk",
          title: "Master state",
          statement: { text: "The master state governs.", epistemic: "reported", citations: [{ source_id: "SRC-F03", quote: "The Fixture Master State document governs both modules." }] },
        },
      },
    },
    status: 422,
    sqlstate: "HQ422",
    message: /SRC-F03 has no stored text/i,
  },
  {
    rule: "D1a",
    name: "a quotation that is in the source but shorter than 12 characters once spaces are normalised",
    body: {
      target: { type: "module", id: "MOD-FX-GAMMA" },
      set: { objective: { text: "No scores.", epistemic: "reported", citations: [{ source_id: "SRC-F01", quote: "Never   show" }] } },
    },
    status: 422,
    sqlstate: "HQ422",
    message: /shorter than 12 characters/i,
  },
  {
    rule: "D1a",
    name: "an invented quotation hidden deep in an undeclared field",
    body: { target: { type: "module", id: "MOD-FX-GAMMA" }, set: { notes: [{ deeper: { source_id: "SRC-F02", quote: invented } }] } },
    status: 422,
    sqlstate: "HQ422",
    message: /not found verbatim in SRC-F02/i,
  },
  // D1b — HQ's own labels, and source labels without citations
  {
    rule: "D1b",
    name: 'a claim labelled "verified"',
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { statement: { text: "Checked by HQ.", epistemic: "verified", citations: [] } } },
    status: 403,
    sqlstate: "HQ403",
    message: /label "verified" is HQ's own/i,
  },
  {
    rule: "D1b",
    name: 'a lifecycle entry with basis "verified" (founder accepted, no source)',
    body: {
      target: { type: "module", id: "MOD-FX-GAMMA" },
      set: { lifecycle: { founder_accepted: { state: "yes", basis: "verified", note: "Founder accepted it", citations: [] } } },
    },
    status: 403,
    sqlstate: "HQ403",
    message: /label "verified" is HQ's own/i,
  },
  {
    rule: "D1b",
    name: 'a loop whose standing is "hq_recommendation"',
    body: { target: { type: "loop", id: "LOOP-FX-01" }, set: { standing: "hq_recommendation" } },
    status: 403,
    sqlstate: "HQ403",
    message: /label "hq_recommendation" is HQ's own/i,
  },
  {
    rule: "D1b",
    name: 'a "founder_statement" claim with no citation',
    body: { create: { record_type: "open_item", record: { kind: "risk", title: "Ruling", statement: { text: "The founder approved it.", epistemic: "founder_statement", citations: [] } } } },
    status: 422,
    sqlstate: "HQ422",
    message: /"founder_statement" statement must cite at least one source/i,
  },
  {
    rule: "D1b",
    name: 'a "reported" lifecycle entry with no citation',
    body: { target: { type: "module", id: "MOD-FX-DELTA" }, set: { lifecycle: { documented: { state: "no", basis: "reported", note: "", citations: [] } } } },
    status: 422,
    sqlstate: "HQ422",
    message: /"reported" statement must cite at least one source/i,
  },
  // D1c — more protected fields
  {
    rule: "D1c",
    name: "hq_checks on a build",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { hq_checks: [{ check: "SHA-256 recomputed by HQ", result: "matches" }] } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*hq_checks|hq_checks.*protected/i,
  },
  {
    rule: "D1c",
    name: "made_by on an existing recommendation",
    body: { target: { type: "recommendation", id: "REC-FX-01" }, set: { made_by: "Founder" } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*made_by|made_by.*protected/i,
  },
  {
    rule: "D1c",
    name: "made_by on a created recommendation",
    body: { create: { record_type: "recommendation", record: { title: "Do it", rationale: "Because.", rank: 9, status: "proposed", made_by: "the founder" } } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*made_by|made_by.*protected/i,
  },
  {
    rule: "D1c",
    name: "recorded_from_cluster on any record",
    body: { target: { type: "defect", id: "DEF-FX-01" }, set: { recorded_from_cluster: "cluster-7" } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*recorded_from_cluster|recorded_from_cluster.*protected/i,
  },
  {
    rule: "D1c",
    name: "a source's sha256",
    body: { target: { type: "source", id: "SRC-F01" }, set: { sha256: "0".repeat(64) } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*sha256|sha256.*protected/i,
  },
  {
    rule: "D1c",
    name: "a source's kind (which also drives the fixture-data banner)",
    body: { target: { type: "source", id: "SRC-F01" }, set: { kind: "google_drive" } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*kind|kind.*protected/i,
  },
  {
    rule: "D1c",
    name: "a source's authority and access",
    body: { target: { type: "source", id: "SRC-F02" }, set: { authority: "founder_instrument", access: "read_full" } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*(authority|access)|(authority|access).*protected/i,
  },
  {
    rule: "D1c",
    name: "creating a fixture-kind source",
    body: {
      create: { record_type: "source", record: { title: "Fixture again", kind: "fixture", access: "read_full", authority: "fixture", authority_note: "", summary: "", product_scope: "fixture" } },
    },
    status: 403,
    sqlstate: "HQ403",
    message: /only add a source that is named but not accessible/i,
  },
  {
    rule: "D1c",
    name: "creating a named source that claims a checksum",
    body: {
      create: {
        record_type: "source",
        record: { title: "Named doc", kind: "named_not_accessible", access: "not_accessible", authority: "referenced_only", sha256: "a".repeat(64) },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: /named but not accessible/i,
    dbMessage: /"sha256" is protected/i,
  },
  {
    rule: "D1c",
    name: "creating founder_acceptance evidence",
    body: {
      create: {
        record_type: "evidence",
        record: { type: "founder_acceptance", title: "Accepted", result: { text: "The founder accepted it.", epistemic: "submitter_claim", citations: [] } },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: /evidence of type "founder_acceptance" cannot be made by proposal/i,
  },
  {
    rule: "D1c",
    name: "retyping source-reported evidence as hq_check",
    body: { target: { type: "evidence", id: "EV-FX-01" }, set: { type: "hq_check" } },
    status: 403,
    sqlstate: "HQ403",
    message: /evidence of type "hq_check" cannot be made by proposal/i,
  },
  {
    rule: "D1c",
    name: "rewriting the result of source-reported evidence",
    body: { target: { type: "evidence", id: "EV-FX-01" }, set: { result: { text: "All 300 tests pass.", epistemic: "submitter_claim", citations: [] } } },
    status: 403,
    sqlstate: "HQ403",
    message: /cannot be rewritten by proposal; submit new evidence instead/i,
  },
  {
    rule: "D1c",
    name: "changing the date of evidence HQ's build checked",
    body: { target: { type: "evidence", id: "EV-FX-02" }, set: { date: "2031-05-01" } },
    status: 403,
    sqlstate: "HQ403",
    message: /cannot be rewritten by proposal/i,
  },
  // D15 — build-only fields
  {
    rule: "D15",
    name: "a module's lifecycle_other_reports",
    body: { target: { type: "module", id: "MOD-FX-ALPHA" }, set: { lifecycle_other_reports: {} } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*lifecycle_other_reports|lifecycle_other_reports.*protected/i,
  },
  {
    rule: "D15",
    name: "a build's code_ref",
    body: { target: { type: "build", id: "BLD-FX-01" }, set: { code_ref: { repository: "x/y", ref: "main", commit: null } } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*code_ref|code_ref.*protected/i,
  },
  {
    rule: "D15",
    name: "a created build's possibly_same_as",
    body: {
      create: {
        record_type: "build",
        record: { label: "Copy", standing: "development", statement: { text: "A copy.", epistemic: "submitter_claim", citations: [] }, possibly_same_as: ["BLD-FX-01"] },
      },
    },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*possibly_same_as|possibly_same_as.*protected/i,
  },
  {
    rule: "D15",
    name: "a source's other_names",
    body: { target: { type: "source", id: "SRC-F02" }, set: { other_names: ["Handover"] } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*other_names|other_names.*protected/i,
  },
  {
    rule: "D15",
    name: "a requirement's linked_tests",
    body: { target: { type: "requirement", id: "FR-FX-004" }, set: { linked_tests: ["t1"] } },
    status: 403,
    sqlstate: "HQ403",
    message: /protected.*linked_tests|linked_tests.*protected/i,
  },
];

async function baseVersion(type: string, id: string): Promise<number> {
  const ctx = await getDataset(w.founder);
  const record = ctx.ds.get(type as never, id);
  if (!record) throw new Error(`fixture has no ${type} ${id}`);
  return record.meta.version;
}

async function serviceInput(c: Case) {
  return {
    title: `Probe: ${c.name}`.slice(0, 200),
    rationale: "Regression probe.",
    base_rev: (await getDataset(w.founder)).head,
    ...(c.body.target ? { target: { ...c.body.target, base_version: await baseVersion(c.body.target.type, c.body.target.id) } } : {}),
    ...(c.body.set ? { set: c.body.set } : {}),
    ...(c.body.create ? { create: c.body.create } : {}),
  };
}

function payloadOf(c: Case) {
  return c.body.set ? { op: "update", set: c.body.set } : { op: "create", record_type: c.body.create!.record_type, record: c.body.create!.record };
}

let planted = 0;
/** Put a proposal straight into the inbox as the owner, as if submission had been bypassed. */
async function plant(c: Case, submitter: Principal): Promise<string> {
  planted += 1;
  const id = `PROP-9${String(planted).padStart(5, "0")}`;
  const client = await admin();
  try {
    const head = (await getDataset(w.founder)).head;
    const base = c.body.target ? await baseVersion(c.body.target.type, c.body.target.id) : null;
    await client.query(
      `insert into hq.proposals (id, kind, target_type, target_id, base_version, base_rev, title, rationale, payload, submitted_by)
       values ($1, 'change_proposal', $2, $3, $4, $5, 'Planted probe', 'Bypassed submission.', $6::jsonb, $7)`,
      [id, c.body.target?.type ?? null, c.body.target?.id ?? null, base, head, JSON.stringify(payloadOf(c)), submitter.id],
    );
    await client.query("insert into hq.proposal_events (proposal_id, event, actor) values ($1, 'submitted', $2)", [id, submitter.id]);
  } finally {
    await client.end();
  }
  return id;
}

beforeAll(async () => {
  w = await freshWorld();
});

describe("D1a–c, D15 — a proposal cannot assert what HQ did not check", () => {
  for (const c of CASES) {
    describe(`${c.rule}: ${c.name}`, () => {
      it(`is refused through the service with ${c.status}, for an AI client's token and a developer's session, and changes nothing`, async () => {
        for (const who of [w.claude, w.developer]) {
          const before = await worldState();
          const err = await expectStatus(submitChangeProposal(who, await serviceInput(c)), c.status);
          expect(err.message).toMatch(c.message);
          expect(await worldState()).toEqual(before);
        }
      });

      it(`is refused by the database on its own with ${c.sqlstate}`, async () => {
        const before = await worldState();
        for (const who of [w.claude, w.developer]) {
          const input = await serviceInput(c);
          await expect(
            asAppRole("authenticated", claimsFor(who), (client) =>
              client.query("select hq.submit_proposal('change_proposal', $1, $2, $3, $4, 'Direct probe', 'Bypassing the application.', $5::jsonb)", [
                c.body.target?.type ?? null,
                c.body.target?.id ?? null,
                input.target?.base_version ?? null,
                input.base_rev,
                JSON.stringify(payloadOf(c)),
              ]),
            ),
          ).rejects.toMatchObject({ code: c.sqlstate, message: expect.stringMatching(c.dbMessage ?? c.message) });
        }
        expect(await worldState()).toEqual(before);
      });

      it("is refused again when the founder accepts a proposal that bypassed submission; it stays submitted", async () => {
        const id = await plant(c, w.claude);
        const before = await worldState();
        const err = await expectStatus(reviewProposal(w.founder, id, "accept"), c.status);
        expect(err.message).toMatch(c.dbMessage ?? c.message);
        expect(await worldState()).toEqual(before);
        expect((await getProposal(w.founder, id)).status).toBe("submitted");
      });
    });
  }

  it("a refusal is written to the audit log, naming the quotation that failed", async () => {
    const client = await admin();
    try {
      const rows = await client.query<{ outcome: string; detail: { status: number; message: string } }>(
        "select outcome, detail from hq.audit_log where action = 'proposal.submit' and principal_handle = 'claude' and detail ->> 'status' = '422' order by id",
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(rows.rows[0]).toMatchObject({ outcome: "denied", detail: { message: expect.stringMatching(/not found verbatim in SRC-F01/) } });
    } finally {
      await client.end();
    }
  });

  it("test evidence of a type only the founder or HQ's build records is refused before it reaches the inbox", async () => {
    const before = await worldState();
    for (const type of ["founder_acceptance", "hq_check"]) {
      const err = await expectStatus(recordTestEvidence(w.claude, { title: "Accepted", type, result_summary: "Accepted by the founder.", base_rev: 1 }), 403);
      expect(err.message).toMatch(new RegExp(`Evidence of type "${type}" cannot be submitted`));
    }
    expect(await worldState()).toEqual(before);
  });

  it("the application's list of protected fields matches the database's", async () => {
    const client = await admin();
    try {
      const dbProtected = (await client.query<{ f: string[] }>("select hq.protected_fields() as f")).rows[0].f;
      for (const field of PROTECTED_FIELDS) expect(dbProtected).toContain(field);
      expect(dbProtected).toEqual(expect.arrayContaining(["hq_checks", "made_by", "recorded_from_cluster"]));
      const types = ["source", "module", "loop", "pathway", "requirement", "decision", "commission", "build", "evidence", "defect", "open_item", "recommendation"];
      const union = new Set<string>();
      for (const t of types) for (const f of (await client.query<{ f: string[] }>("select hq.build_only_fields($1) as f", [t])).rows[0].f) union.add(f);
      expect([...union].sort()).toEqual([...BUILD_ONLY_FIELDS].sort());
    } finally {
      await client.end();
    }
  });
});

describe("D1a — what still goes through", () => {
  it("a requirement whose exact wording is verbatim in its source is accepted and applied", async () => {
    const submitted = await submitChangeProposal(w.claude, {
      title: "Register the slow-tempo rule again",
      rationale: "Quoted from Fixture Document A.",
      base_rev: (await getDataset(w.founder)).head,
      create: {
        record_type: "requirement",
        record: {
          // Line-wrapped differently from the source: only spacing is forgiven.
          exact_wording: "Every pattern must be playable\n  at a slow tempo before a fast one.",
          source_id: "SRC-F01",
          attribution: "direct_quote",
          title: "Slow before fast",
          category: "pedagogy",
          implementation_state: "no_record",
        },
      },
    });
    const filed = await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    const record = await getRecord(w.founder, "requirement", String(filed.record_id));
    expect(record.data.record).toMatchObject({ source_id: "SRC-F01", attribution: "direct_quote", disposition: "unreviewed" });
    expect(record.data.meta.origin).toBe("proposal_acceptance");
  });

  it("a developer's update citing the source verbatim is accepted and applied", async () => {
    const quote = "Gamma should let a learner improvise over the pattern they practised in Alpha.";
    const submitted = await submitChangeProposal(w.developer, {
      title: "Gamma objective",
      rationale: "From Fixture Document A.",
      base_rev: (await getDataset(w.founder)).head,
      target: { type: "module", id: "MOD-FX-GAMMA", base_version: await baseVersion("module", "MOD-FX-GAMMA") },
      set: { objective: { text: "Improvise over a practised pattern.", epistemic: "design_intention", citations: [{ source_id: "SRC-F01", locator: "Gamma module", quote }] } },
    });
    const filed = await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    expect(filed.record_id).toBe("MOD-FX-GAMMA");
    const ctx = await getDataset(w.founder);
    expect(ctx.ds.get("module", "MOD-FX-GAMMA")!.data.objective).toMatchObject({ epistemic: "design_intention", citations: [{ quote }] });
  });

  it("a named-only source can still be proposed, with a verified mention", async () => {
    const submitted = await submitChangeProposal(w.claude, {
      title: "Name the master state",
      rationale: "Fixture Handover B names it.",
      base_rev: (await getDataset(w.founder)).head,
      create: {
        record_type: "source",
        record: {
          title: "Fixture Master State (copy two)",
          location: null,
          kind: "named_not_accessible",
          access: "not_accessible",
          authority: "referenced_only",
          named_in: [{ source_id: "SRC-F02", locator: null, quote: "The Fixture Master State document governs both modules." }],
        },
      },
    });
    const filed = await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    expect(String(filed.record_id)).toMatch(/^SRC-HQ-/);
  });

  it("a created recommendation is attributed to its submitter, never to HQ's builder", async () => {
    const submitted = await submitChangeProposal(w.claude, {
      title: "Suggest a fix",
      rationale: "The dropped note blocks review.",
      base_rev: (await getDataset(w.founder)).head,
      create: { record_type: "recommendation", record: { title: "Fix the dropped note first", rationale: "It blocks a fair review.", rank: 5, status: "proposed" } },
    });
    const filed = await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    const client = await admin();
    try {
      const row = await client.query<{ made_by: string }>("select data ->> 'made_by' as made_by from hq.record_versions where record_id = $1", [filed.record_id]);
      expect(row.rows[0].made_by).toBe("Proposed through the inbox by claude");
    } finally {
      await client.end();
    }
    const record = await getRecord(w.reader, "recommendation", String(filed.record_id));
    expect((record.data.record as { made_by: string }).made_by).not.toMatch(/HQ builder/);
  });

  it("source-reported evidence may still get a new title, and keeps its verification", async () => {
    const submitted = await submitChangeProposal(w.claude, {
      title: "Clearer evidence title",
      rationale: "Names the build.",
      base_rev: (await getDataset(w.founder)).head,
      target: { type: "evidence", id: "EV-FX-01", base_version: await baseVersion("evidence", "EV-FX-01") },
      set: { title: "alpha-candidate-7 automated suite (42 tests)" },
    });
    await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    const record = (await getDataset(w.founder)).ds.get("evidence", "EV-FX-01")!;
    expect(record.data).toMatchObject({ title: "alpha-candidate-7 automated suite (42 tests)", verification: "source_reported", type: "automated_test" });
  });

  it("a change to an unverified submission keeps it unverified and attributes it to whoever proposed the change", async () => {
    const filed = await reviewProposal(
      w.founder,
      (
        (await recordTestEvidence(w.claude, { title: "Re-run of the alpha suite", result_summary: "42 passed.", module_ids: ["MOD-FX-ALPHA"], base_rev: (await getDataset(w.founder)).head })).proposal as {
          id: string;
        }
      ).id,
      "accept",
    );
    const id = String(filed.record_id);
    const submitted = await submitChangeProposal(w.developer, {
      title: "Correct the count",
      rationale: "It was 41.",
      base_rev: (await getDataset(w.founder)).head,
      target: { type: "evidence", id, base_version: await baseVersion("evidence", id) },
      set: { result: { text: "41 passed, 1 failed.", epistemic: "submitter_claim", citations: [] } },
    });
    await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    expect((await getDataset(w.founder)).ds.get("evidence", id)!.data).toMatchObject({ verification: "submitted_unverified", submitted_by: "developer" });
  });
});

describe("D1a — the database checks quotations with the application's own normalisation", () => {
  it("hq._norm_quote gives exactly normaliseForQuote's result for every JavaScript whitespace character", async () => {
    const spaces = ["\t", "\n", "\v", "\f", "\r", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", "　", "﻿"];
    const samples = [...spaces.map((s) => `${s}a${s}${s}b ${s}c${s}`), "no-break​space (zero width is not whitespace)", "  ", "x"];
    const client = await admin();
    try {
      for (const sample of samples) {
        const row = await client.query<{ n: string }>("select hq._norm_quote($1) as n", [sample]);
        expect(row.rows[0].n, JSON.stringify(sample)).toBe(normaliseForQuote(sample));
      }
    } finally {
      await client.end();
    }
  });

  it("every import stores each snapshot's normalised text, matching the source record's checksum", async () => {
    const client = await admin();
    try {
      const rows = await client.query<{ source_id: string; sha256: string; chars: number; record_sha: string }>(
        `select t.source_id, t.sha256, t.chars, (select v.data #>> '{text_snapshot,sha256}' from hq.record_versions v
            where v.record_type = 'source' and v.record_id = t.source_id order by v.version desc limit 1) as record_sha
           from hq.source_texts t order by t.source_id`,
      );
      expect(rows.rows.map((r) => r.source_id)).toEqual(["SRC-F01", "SRC-F02"]);
      for (const r of rows.rows) expect(r.sha256).toBe(r.record_sha);
    } finally {
      await client.end();
    }
  });

  it("the source texts are owner-only: no API role can read them or load them", async () => {
    await expect(asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select * from hq.source_texts"))).rejects.toMatchObject({ code: "42501" });
    await expect(
      asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select hq.admin_put_source_texts('[]'::jsonb)")),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq._quote_ok('SRC-F01', 'Never show a score out of ten.')"))).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("the quotation check the application uses is open only to principals who may propose, and returns no text", async () => {
    const items = JSON.stringify([
      { source_id: "SRC-F01", quote: "Never show a score out of ten." },
      { source_id: "SRC-F01", quote: invented },
    ]);
    const result = await asAppRole("authenticated", claimsFor(w.claude), (c) => c.query<{ r: { index: number; reason: string; message: string }[] }>("select hq.quotes_ok($1::jsonb) as r", [items]));
    expect(result.rows[0].r).toEqual([expect.objectContaining({ index: 1, source_id: "SRC-F01", reason: "not_found" })]);
    await expect(asAppRole("authenticated", claimsFor(w.reader), (c) => c.query("select hq.quotes_ok($1::jsonb)", [items]))).rejects.toMatchObject({ code: "HQ403" });
    await expect(asAppRole("authenticated", claimsFor(w.claudeReadOnly), (c) => c.query("select hq.quotes_ok($1::jsonb)", [items]))).rejects.toMatchObject({ code: "HQ403" });
  });
});

describe("D1d — the founder's review shows what the proposal touches", () => {
  it("proposalImpact flags type/result/statement/sha256 changes and reports the target's acceptance", async () => {
    const submitted = await submitChangeProposal(w.claude, {
      title: "Restate the beta build",
      rationale: "Tidier statement.",
      base_rev: (await getDataset(w.founder)).head,
      target: { type: "build", id: "BLD-FX-02", base_version: await baseVersion("build", "BLD-FX-02") },
      set: { statement: { text: "Beta build 2, accepted for desktop.", epistemic: "submitter_claim", citations: [] }, sha256: "2".repeat(64), label: "Beta build 2" },
    });
    const impact = await proposalImpact(w.founder, await getProposal(w.founder, (submitted.proposal as { id: string }).id));
    expect(impact.sensitive_fields).toEqual(expect.arrayContaining(["statement", "sha256"]));
    expect(impact.sensitive_fields).not.toContain("label");
    expect(impact.target_acceptance).toBeNull();
  });
});
