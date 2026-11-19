# Governance: who can do what

HQ exists so that nothing is silently lost and nothing is silently changed. These are the rules it
enforces. Unless a rule says otherwise, it is enforced in the database (a trigger, a function or a
row-level-security policy), not only in the user interface; the application checks the same rules
first so that it can give a clear message. The tests that try to break them are described in
docs/TESTING.md.

## Standing of HQ itself

HQ is a **non-authoritative prototype**. The commission makes HB-AI-P00 the prerequisite for an
authoritative HQ; no accessible source shows P00 to be completed or accepted. Every screen and every
API answer says so. Building HQ satisfies neither P00 nor P02 nor any acceptance gate, and only the
founder can change HQ's standing.

## Roles

| Role | Who | Can read | Can propose | Can review, accept, decide |
| --- | --- | --- | --- | --- |
| Founder | a person, signed in | everything, including the audit log | yes | **yes — and only in a signed-in session** |
| Developer | a person | all records; own proposals | yes | no |
| AI client | Claude, ChatGPT, any agent (API token) | all records; own proposals | only with the `propose` scope | no |
| Reader | a person | all records | no | no |

There is no token scope for approval. A founder cannot be issued a token at all (the database
refuses), so founder authority cannot be delegated to a script or an assistant, and an AI client
cannot be promoted to founder (a founder must be a person).

## What a proposal is

A proposal is a request to change a record or to add one. It lives in an inbox that is separate from
the records, and it changes nothing until the founder accepts it.

- It names the record **version** (`base_version`) and **dataset revision** it was written against.
- It is visible only to its submitter and to the founder. One AI client cannot read another's
  proposals, and the database's status look-up (`hq.proposal_status`) answers no one else.
- Its history is append-only and has a fixed order: *submitted* first, then exactly one closing
  event — *accepted*, *rejected*, *changes requested*, *withdrawn* or *marked stale*. The database
  refuses any other order (HTTP 409). Withdrawing and accepting take the same lock, so they cannot
  both succeed.
- Only its submitter can withdraw it, and only while that person or client is active and may still
  propose (a token needs the `propose` scope).
- When the founder accepts it, HQ re-checks every rule below against the record as it stands then,
  and re-checks that the target has not changed. If it has changed, the proposal is **marked stale
  and not applied**, and the founder is told which version it was based on and which version is
  current. Nothing is merged silently.

## What a proposal may assert

The inbox is where developers and AI clients make claims. A proposal can never make HQ show its
submitter's words as source-verified, as checked by HQ, as made by HQ, or as an acceptance. Each rule is checked when
the proposal is submitted and again when the founder accepts it.

**Quotations are verified on the proposal path too.** Every object anywhere in a proposal that has
both a `source_id` and a `quote` must quote that source verbatim: at least twelve characters once
spacing is normalised, found in the text snapshot HQ stored when it imported the source
(`hq.source_texts`). A new requirement's `exact_wording` must likewise occur verbatim in its source,
with at least eight non-space characters. A source with no stored text — for example a document that
is named but was not accessible — cannot be cited. A citation without a `source_id` and a `quote` is
refused.

**Labels.**

| Label | In a proposal |
| --- | --- |
| `verified`, `hq_recommendation` | Never. They are HQ's own (field `epistemic` or `basis` anywhere, and a loop's top-level `standing`) |
| `reported`, `design_intention`, `source_recommendation`, `founder_statement` | Only with at least one citation, which is then verified |
| `submitter_claim`, `no_evidence` | Always |

**Fields a proposal cannot set on any record:**

| Field | Why |
| --- | --- |
| `id` | Identifiers are durable |
| `exact_wording`, `source_id`, `locator`, `source_date`, `attribution` | A founder requirement's original is permanent. A correction is a new requirement that supersedes it. (When a proposal *creates* a requirement it gives these, and the wording is verified as above) |
| `disposition`, `disposition_decision_id` | Only a founder decision changes a requirement's standing |
| `hq_acceptance` | Acceptance in HQ exists only as the effect of a founder decision |
| `recorded_in`, `decided_by`, `decided_at` | A decision “recorded in HQ” can only be made by the founder |
| `verification`, `submitted_by` | Evidence cannot upgrade its own verification status |
| `hq_checks` | Checks HQ's build made are written only by that build |
| `made_by` | A recommendation created through the inbox is stored as “Proposed through the inbox by *handle*”, never as HQ's |
| `recorded_from_cluster` | Written only by HQ's build |

**Fields only HQ's build writes**, refused in a proposal for the record type named:
module `addenda_from_clusters`, `commission_entry`, `lifecycle_other_reports`; decision and build
`other_mentions`; build `possibly_same_as`, `code_ref`; evidence `search_results`; requirement
`linked_tests`; source `doc_kind`, `content_kind`, `importance`, `identifiers`, `other_names`.

**A proposal can never assert acceptance.** A verbatim quotation proves that words are in a source,
not that they report an acceptance, so a citation is not enough. Acceptance is recorded only by a
founder decision in HQ or by an import. On an update and on a create, whatever labels or citations
the proposal carries, the database refuses (and the application refuses first):

- a build whose standing would become `accepted_reported`, unless the record already had that standing;
- a module whose `lifecycle.founder_accepted.state` would become `yes` or `partial`, unless the record's
  current `lifecycle.founder_accepted` is identical (state, basis, note and citations). Replacing the
  whole `lifecycle`, or giving a `lifecycle` that holds only `founder_accepted`, is caught the same way;
- on any record type, a top-level field named `founder_accepted` (also spelt as a dotted path such as
  `lifecycle.founder_accepted`);
- evidence of type `founder_acceptance` (see below).

At acceptance the rule is checked again against the record as it stands then, before the stale
check, so a refused proposal stays in the inbox as *submitted*.

**Rules for particular record types:**

- Decision records cannot be created or changed by proposal: they are written only by a founder decision.
- A source HQ has read keeps what it says about the snapshot: a proposal cannot change its `sha256`,
  `bytes`, `text_snapshot`, `access`, `kind`, `authority`, `retrieved_at`, `parts`, `version` or
  `location`. A proposal can add only a source that is named but not accessible (kind
  `named_not_accessible`, access `not_accessible`, authority `referenced_only`, with no checksum or snapshot).
- Evidence of type `founder_acceptance` or `hq_check` is never accepted from a proposal or from
  `record_test_evidence`.
- Evidence that a source reports, or that HQ's build checked, cannot have its `type`, `result`,
  `sha256`, `date` or `build_id` changed by proposal; submit new evidence instead. A change to an
  unverified submission keeps it unverified and attributes it to whoever proposed the change.
- A proposal that sets `linked_evidence_ids`, `linked_build_ids` or `decision_ids` must name existing
  evidence, build and decision records. *This rule is checked by the application only, not by the database.*

**A founder acceptance binds.** A record whose HQ acceptance is *accepted* or *rejected* cannot be
changed by proposal at all. To change it, the founder first records a decision that clears the
acceptance, or someone proposes a new record. If the acceptance arrived after a proposal was
submitted, accepting that proposal is refused and the proposal stays in the inbox; it is not marked
stale. The database also refuses any write to such a record other than a founder decision.

### How a refusal is answered

| Refusal | HTTP status | Error code |
| --- | --- | --- |
| A protected or build-only field, an HQ-only label, a forbidden evidence type, a source or evidence integrity rule, a decision record | 403 | `forbidden` (`detail.protected_fields` lists the fields, where there are any) |
| A claim of acceptance: a build standing `accepted_reported`, a module `lifecycle.founder_accepted` of `yes` or `partial`, or a `founder_accepted` field | 403 | `forbidden` (`detail.rule` is `acceptance_claim`; `detail.field` names the field) |
| A quotation or wording that cannot be verified, a source label without a citation, a malformed citation | 422 | `invalid_request` (`detail.unverified_quotations` lists every quotation that failed) |
| A linked id that does not exist | 422 | `invalid_request` (`detail.unknown_links`) |
| A target carrying a founder acceptance or rejection recorded in HQ | 409 | `conflict` (`detail.acceptance`; the message says “acceptance” or “rejection”, whichever it is) |
| A target that changed since `base_version` | 409 | `conflict` |

The application writes these refusals to the audit log (see “History and audit”), whether they
come through the API or the browser form.

## Evidence from agents

Test evidence submitted through `record_test_evidence` is stored — if the founder files it — with
the verification status **agent-submitted, unverified** (or *submitted, unverified* for a person),
permanently. An agent's statement that something is complete is recorded as that agent's statement.
It never counts towards “accepted”, and it appears under *Unverified claims* on the dashboard.

An agent's evidence never counts as an acceptance instrument. For a build marked as accepted, only two
things count:

- evidence of type `founder_acceptance` that a source reports or HQ's build checked, whose `build_id`
  is that build; or
- an issued decision recorded in HQ whose effects include a `set_acceptance` that accepts that build
  (the same thing the build's HQ acceptance records).

Nothing else counts: not a decision that only names the build's module, not a decision a source
reports (those carry no reference to a build), and never a link the build itself carries, such as
`decision_ids`, because a proposal can set those. A build marked as accepted without an instrument is
listed under *Review items*: “A source states this build was accepted, but HQ holds no
founder-acceptance evidence for it and no founder decision recorded in HQ accepts it.” (For a build
claimed as accepted with no source quoted, the item says that instead.) This is the
cautious reading, and it lists more builds for review than the earlier rule did.

A requirement counts as outstanding unless it is recorded as implemented and tested **and** at least
one linked evidence record exists that a source reports or HQ's build checked. A requirement whose
implementation state claims tests but has no linked evidence record is listed under *Review items*.

## Founder decisions

Only the founder, in a signed-in session, can:

- **accept, reject or ask for changes** to a proposal;
- **record a decision**, in their own words, stored exactly as typed. A decision may also
  - set the standing of a requirement: `unreviewed`, `active`, `satisfied`, `deferred`, `superseded`,
    `conflicted` or `withdrawn`; or
  - record acceptance or rejection of a build, module, loop, piece of evidence or commission, with a
    scope note, or clear an earlier acceptance or rejection. The decision API
    (`POST /api/v1/decisions`) also accepts a requirement as the target; the screen does not offer it.
    The acceptance stores the record version it was written at (`accepted_version`);
- resolve a pending decision or open item by naming it in the decision;
- issue and revoke API tokens; read the audit log.

Every id a decision names must exist: what it resolves must be a decision or an open item, its
modules must be modules, and each effect's target must exist. Otherwise nothing is recorded (HTTP 422,
naming each id).

Recommendations — HQ's own, or an assistant's — are stored as recommendations with the status
`proposed`, and are displayed apart from approved work. Nothing turns a recommendation into an
approval except a founder decision.

## “Accepted” and “rejected”, kept apart

- **Acceptance reported in a source** — a document says the founder accepted something. HQ shows it
  as reported, with the quotation and the scope the document states. HQ has not seen the founder do
  it. Such a report reaches HQ only through an import, never through a proposal (see “A proposal can
  never assert acceptance”). HQ counts it as reported only when it is labelled `reported` or
  `founder_statement` and quotes a source: a module's lifecycle entry, or a build's statement. A pack
  is refused if a build in it has the standing `accepted_reported` with no citation, and is warned if
  the citing statement has another label.
- **Acceptance claimed — no source quoted** — a build marked as accepted whose statement does not meet
  that test (for example, one stored before this rule). HQ shows it with this label, lists it under
  *Unverified claims*, and does not count it as reported.
- **Acceptance recorded in HQ** — the founder recorded it here. This is the only thing HQ itself calls accepted.
- **Rejection recorded in HQ** — the founder recorded a rejection here. It is shown as “Founder
  rejected in HQ”, it outranks anything a source reports, and it has its own development-health list.
  An acceptance or rejection that a later decision cleared is shown with the decision that cleared it.

Passing tests are counted separately from all three and are never shown as acceptance.

## Records that came in through the inbox

While a record's current version comes from an accepted proposal, it is marked on its own page and
in the defect, evidence and open-item lists: “Entered through the proposal inbox”, with the proposal
id, for a record's first version, and “Last changed through the proposal inbox” for a later one. Such
records are counted under *Unverified claims*, and their notes say “Reported through the inbox”,
unless the founder has accepted them in HQ.

## History and audit

- Every record version is kept, with who made it, when, through which proposal or decision, and under which commission.
- Record and overview screens can show an earlier dataset revision: add `?rev=N` to the address, or
  pass `rev` to a read tool (all except `get_recent_changes` and `list_my_proposals`). They then show
  the records exactly as they stood. The proposal inbox, proposal pages, the decision centre, *Changes*
  and *AI & API access* always show the latest, and say so when an address names a revision.
- The audit log records sign-ins, sign-outs, token use, writes and refusals. It is append-only and
  visible only to the founder. Refusals are recorded by the application, in a transaction of their
  own. A refusal raised inside a database function cannot record itself (the refusal rolls its own
  write back), so a caller that goes round the application leaves no record of being refused.

## Imported text is data, not instruction

Source documents, repository text and anything a client submits are stored and displayed as text.
Nothing in them can grant a permission, change a role or trigger an action: permissions come only
from the identity of the caller, checked in the database.
