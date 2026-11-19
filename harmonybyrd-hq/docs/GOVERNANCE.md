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
- Accepting a proposal also re-validates the **whole record** as it would then stand, with the same
  schema a pack import uses. If the result would not pass, the answer is 422 (`invalid_request`, with
  the problems in `detail`), nothing is applied, the refusal is audited, and the proposal stays in the
  inbox as *submitted*; the founder can still reject it or ask for changes. This check is made before
  the stale check, so an invalid proposal is never marked stale instead. It is made by the
  application: the database checks its own rules (below) at acceptance, but not the whole schema.

## What a proposal may assert

The inbox is where developers and AI clients make claims. A proposal can never make HQ show its
submitter's words as reported by a source, as checked by HQ, as made by HQ, or as an acceptance.
Each rule is checked when the proposal is submitted and again when the founder accepts it, against
the record as it stands then.

**What enters through the inbox is the submitter's claim.** HQ checks that a quotation's words are
in the source. It cannot check that they are about the thing the proposal attaches them to: a
verbatim sentence about one module can be attached to another. So only an import can label
something as reported by a source. In the record a proposal would leave, every object at any depth
whose `epistemic` or `basis` is `reported`, `design_intention`, `source_recommendation`,
`founder_statement` or `commission_example` (a pathway's basis: the commission gives this pathway as
an example, which is also a claim about a source) must be identical, as a whole object, to the object at the same place in the
record as stored (list positions count: moving a claim to another place in a list is a change). A
loop's `standing` and a pathway's `basis` may hold such a label only if they already hold that very
value. Otherwise the proposal is refused (403, rule `source_label`): “a proposal's claim is the
submitter's own: label it submitter_claim (it may carry quotations). Labels that say a source
reports something are set only by an import.” So a created record carries no source label at all,
and an update can leave an imported claim exactly as it is, remove it, or replace it with the
submitter's own claim (`submitter_claim`) or `no_evidence`. A pathway created by proposal has the
basis `submitter_claim` and is shown as the submitter's claim. A submitter's claim never raises a
module's standing and is never counted as an acceptance; the screens show it as the submitter's
claim.

**Quotations are still verified.** Every object anywhere in a proposal that has both a `source_id`
and a `quote` must quote that source verbatim: at least twelve characters once spacing is
normalised, found in the text snapshot HQ stored when it imported the source (`hq.source_texts`).
This holds for a submitter's claim too, and it proves only that the words are in the source, not
that they support what they are attached to. A new requirement's `exact_wording` must likewise occur
verbatim in its source, with at least eight non-space characters. A source with no stored text — for
example a document that is named but was not accessible — cannot be cited. A citation without a
`source_id` and a `quote` is refused.

**Labels.**

| Label | In a proposal |
| --- | --- |
| `verified`, `hq_recommendation` | Never. They are HQ's own (field `epistemic` or `basis` anywhere, and a loop's top-level `standing`) |
| `reported`, `design_intention`, `source_recommendation`, `founder_statement`, and a pathway's `commission_example` | Never, unless the record as stored already holds that very object at the same place (an imported claim left exactly as it is) |
| `submitter_claim`, `no_evidence` | Always. A submitter's claim may carry quotations, which are verified |

**Only the fields its record type has.** A proposal's `set` (an update) or `record` (a create) may
contain only the top-level fields its record type declares in `src/lib/domain/schemas.ts`. The
database holds the same list (`hq.record_fields`; `tests/db/record-fields.test.ts` compares the two).
Any other key, a look-alike such as `"hq_acceptance "` or `Standing` included, is refused (422, rule
`unknown_field`, naming the key in at most 60 characters). An import still keeps keys it does not
know, so that an older application can read a newer pack.

**Never the text HQ shows for a value it cannot read.** A proposal in which any text, at any depth,
is exactly “Not a valid value” is refused (422, rule `not_a_valid_value`). The *Propose a change*
form fills its fields from the record as stored, so it never offers that text.

**“Implemented and tested” is not a proposal's to say.** A proposal cannot set a requirement's
`implementation_state` to `implemented_tested` unless it already is, and cannot change the
`linked_evidence_ids` or `linked_build_ids` of a requirement that is (403, rule `tested_claim`). A
proposal can still say `implemented_unverified` and link evidence; the requirement then stays
outstanding. Only an import sets `implemented_tested`, and the refusal says so: “record the tests
as evidence; only an import marks a requirement as implemented and tested (the founder can record it
as satisfied by a decision)”. A founder decision sets no implementation state; it can set the
requirement's standing, for example to *satisfied*, which takes it off the outstanding list.

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
| `made_by` | A recommendation created through the inbox is stored as “Proposed through the inbox by *handle*”, never as HQ's. An imported recommendation that names nobody reads “Not stated” (its page: “This recommendation does not say who made it.”), never HQ's |
| `recorded_from_cluster` | Written only by HQ's build |

**Fields only HQ's build writes**, refused in a proposal for the record type named:
module `addenda_from_clusters`, `commission_entry`, `lifecycle_other_reports`; decision and build
`other_mentions`; build `possibly_same_as`, `code_ref`; evidence `search_results`; requirement
`linked_tests`; source `doc_kind`, `content_kind`, `importance`, `identifiers`, `other_names`.

**Records HQ did not write are not rewritten by proposal.** Two kinds of record are frozen for
proposals: any change is refused (403, rule `frozen_record`).

- Evidence whose `verification` is `source_reported` or `hq_verified`: “evidence that a source
  reports or HQ's build checked is changed only by an import; submit new evidence instead”.
- A source HQ has read: one with a text snapshot, one whose `access` is anything but
  `not_accessible`, or one whose text the database stores: “a source HQ has read is changed only by
  an import; a proposal can change a source that is only named”. The application cannot read the
  stored texts, so a source known to be read only through them is refused by the database, with
  its message and no `detail.rule`.

A source that is only named can still be changed, apart from what it says about a snapshot
(`sha256`, `bytes`, `text_snapshot`, `access`, `kind`, `authority`, `retrieved_at`, `parts`,
`version`, `location`). A proposal can add only a source that is named but not accessible (kind
`named_not_accessible`, access `not_accessible`, authority `referenced_only`, with no checksum or
snapshot). A change to an unverified evidence submission keeps it unverified and attributes it to
whoever proposed the change.

**A proposal can never assert acceptance, or reshape one a source reports.** A verbatim quotation
proves that words are in a source, not that they report an acceptance, so a citation is not enough.
Acceptance is recorded only by a founder decision in HQ or by an import. On an update and on a
create, whatever labels or citations the proposal carries, the database refuses (and the application
refuses first, with the same words):

- **any change to a build a source reports as accepted** (current standing `accepted_reported`),
  unless the proposal withdraws that report by giving the build another standing that is one of the
  valid standings. Statement, module, label, artifact, checksum and every other field are covered at
  once. The message is “a build reported as accepted is changed only by an import or a founder
  decision; a proposal may only withdraw the reported acceptance”. A proposal that does withdraw it
  may change the other fields too: withdrawing a claim is not asserting one. The rest of the record
  it leaves must still keep the rules above, so a withdrawal may relabel the build's statement as the
  submitter's claim but may not rewrite it as a report;
- a build whose standing would become `accepted_reported`, when the record did not already have it;
- a module whose `lifecycle.founder_accepted` would be **positive**, unless the whole entry is
  identical to the record's current one. Positive means anything other than an object whose `state`
  is exactly `no`, `unknown` or `not_applicable`: `yes` and `partial`, but also a missing state,
  `Yes`, `yes ` or a list. Identical means the whole entry object is equal, not only some of its keys:
  an added key such as `scope` is a change. Replacing the whole `lifecycle`, or giving a `lifecycle`
  that holds only `founder_accepted`, is caught the same way;
- on any record type, a top-level field named `founder_accepted` (also spelt as a dotted path such as
  `lifecycle.founder_accepted`);
- evidence of type `founder_acceptance` (see below).

At acceptance the rule is checked again against the record as it stands then, before the stale
check, so a refused proposal stays in the inbox as *submitted*. If an import has since made the
target a build reported as accepted, accepting a proposal written before that is refused too.

**The database checks the values that drive labels itself.** For each record type it holds the
fields whose value must come from a fixed list, and the lists (`hq.field_enums`, the same lists as
`FIELD_ENUMS` in `src/lib/domain/schemas.ts`: `tests/db/field-enums.test.ts` compares the table with
`FIELD_ENUMS`, and `tests/unit/schemas.test.ts` compares `FIELD_ENUMS` with the record schemas). They
are: a build's `standing`; a module's `kind`, `evidence_level`, the dimension names in `lifecycle`
and each entry's `state` and `basis`; evidence `type` and `verification`; a commission's and a
decision's `status` and a decision's `recorded_in`; a defect's `severity` and `status`; an open
item's `kind`; a loop's `standing`; a pathway's `basis`; a recommendation's `status`; a requirement's
`attribution`, `category`, `disposition` and `implementation_state`; a source's `kind`, `access` and
`authority`; and `epistemic` in any object at any depth. A value must be a JSON string on its list;
anything else is refused with 422 (`detail.field` names the field, `detail.rule` is
`allowed_values`). A created record is checked in full. For an update, the fields the proposal sets
are checked as they would stand, and the fields that drive acceptance (build `standing`, module
`lifecycle`, evidence `type`) are always checked in the whole resulting record. So an odd value
imported before this rule does not block an unrelated change, except in those fields: a build with an
odd standing can only be changed by a proposal that gives it a valid one. The check runs at
submission and again at acceptance. **What it does not cover:** a listed value inside a list other
than an `epistemic` label — a module capability's `state`, a loop or pathway step's `shared_stage`.
Accepting a proposal through the application still refuses such a value, because the whole record
is then checked against its schema (above); a founder act made straight in the database with the
founder's identity is not.

**Rules for particular record types:**

- Decision records cannot be created or changed by proposal: they are written only by a founder decision.
- Evidence of type `founder_acceptance` or `hq_check` is never accepted from a proposal or from
  `record_test_evidence`.
- A proposal that sets `linked_evidence_ids`, `linked_build_ids` or `decision_ids` must name existing
  evidence, build and decision records. *This rule is checked by the application only, not by the database.*

**A founder acceptance binds.** A record whose HQ acceptance is *accepted* or *rejected* cannot be
changed by proposal at all. To change it, the founder first records a decision that clears the
acceptance, or someone proposes a new record. If the acceptance arrived after a proposal was
submitted, accepting that proposal is refused and the proposal stays in the inbox; it is not marked
stale. The database also refuses any write to such a record other than a founder decision.

### How a refusal is answered

When a proposal breaks more than one rule, the first refusal answers. The database's order is: the
shape of the proposal (protected and build-only fields, decision records, HQ-only labels, quotations,
a created record's allowed values); then, for an update, a founder acceptance or rejection on the
target, the frozen records and the allowed values; then the acceptance claims; then what a proposal
may say (the “Not a valid value” text, undeclared fields, “implemented and tested”, source labels);
then, for an update, the stale check. The application checks the same rules before the database is
asked, and two of its own: linked ids, and the whole record against its schema (last). Its order
differs in one way: for an update it checks a founder acceptance on the target, the frozen records,
the base version and the linked ids before the labels and quotations, so a stale proposal is
answered as stale (409) by the application where the database would name another rule first.

| Refusal | HTTP status | Error code and detail |
| --- | --- | --- |
| A protected or build-only field, an HQ-only label, a forbidden evidence type, a source a proposal may not create, a decision record | 403 | `forbidden` (`detail.protected_fields` lists the fields, where there are any; for an HQ-only label, `detail.field` and `detail.label`) |
| A record HQ did not write: evidence a source reports or HQ's build checked, a source HQ has read | 403 | `forbidden` (`detail.rule` is `frozen_record`) |
| A claim of acceptance: a build standing `accepted_reported`, any change to a build reported as accepted that does not withdraw it, a positive module `lifecycle.founder_accepted` that is not identical to the current one, or a `founder_accepted` field | 403 | `forbidden` (`detail.rule` is `acceptance_claim`; `detail.field` names the field: `standing` for a build) |
| “Implemented and tested” set by proposal, or the links of a tested requirement changed | 403 | `forbidden` (`detail.rule` is `tested_claim`; `detail.field` is `implementation_state`, `linked_evidence_ids` or `linked_build_ids`) |
| A source label the record does not already hold at that place | 403 | `forbidden` (`detail.rule` is `source_label`; `detail.field` is the place, such as `statement`, `lifecycle.prototyped`, `capabilities[2]` or `standing`, in at most 80 characters) |
| A quotation or wording that cannot be verified, a malformed citation | 422 | `invalid_request` (`detail.unverified_quotations` lists the quotations that failed, at most 50; a malformed citation has no detail) |
| A value outside its field's list | 422 | `invalid_request` (`detail.field`; `detail.rule` is `allowed_values`) |
| A field the record type does not declare | 422 | `invalid_request` (`detail.rule` is `unknown_field`; `detail.field` names the key, in at most 60 characters) |
| The text “Not a valid value” anywhere in the proposal | 422 | `invalid_request` (`detail.rule` is `not_a_valid_value`) |
| A record that would not pass its schema: at submission, and at acceptance as it would then stand | 422 | `invalid_request` (`detail` lists the problems, at most 10 and a count of the rest; at acceptance the proposal stays *submitted*) |
| A linked id that does not exist | 422 | `invalid_request` (`detail.unknown_links`) |
| A target carrying a founder acceptance or rejection recorded in HQ | 409 | `conflict` (`detail.acceptance`; the message says “acceptance” or “rejection”, whichever it is) |
| A target that changed since `base_version` | 409 | `conflict` |

**At acceptance the answer is the same as at submission.** Before the founder's acceptance reaches
the database, the application runs its own copies of the frozen-record, allowed-values,
acceptance-claim and what-a-proposal-may-say rules against the record as stored, in the database's
order, so the refusal carries the same status, `detail.rule` and `detail.field` as it would have at
submission. A proposal the database refuses earlier in its order (a protected field, an HQ-only
label, a quotation, an acceptance recorded in HQ) is left to the database, and the answer carries
the database's message and status. A caller that goes straight to the database gets the database's
SQLSTATE (`HQ403`, `HQ409`, `HQ422`) and message, with no `detail.rule`.

The application writes these refusals to the audit log (see “History and audit”), whether they
come through the API or the browser form. A refused acceptance is logged as `proposal.review`
*denied*, with the status (403, 409 or 422), the code and the message.

## Evidence from agents

Test evidence submitted through `record_test_evidence` is stored — if the founder files it — with
the verification status **agent-submitted, unverified** (or *submitted, unverified* for a person),
permanently. An agent's statement that something is complete is recorded as that agent's statement.
It never counts towards “accepted”, and it appears under *Unverified claims* on the dashboard.

An agent's evidence never counts as an acceptance instrument. For a build marked as accepted, only two
things count:

- evidence of type `founder_acceptance` that a source reports or HQ's build checked, whose `build_id`
  is that build and whose record passes validation; or
- an issued decision recorded in HQ whose effects include a `set_acceptance` that accepts that build,
  and only while the build's current HQ acceptance has the state *accepted* and names that decision.
  An acceptance the founder later cleared, or replaced by a rejection, is no instrument: the review
  item comes back. A decision or build record that fails validation is no instrument either.

Nothing else counts: not a decision that only names the build's module, not a decision a source
reports (those carry no reference to a build), and never a link the build itself carries, such as
`decision_ids`, because a proposal can set those. A build marked as accepted without an instrument is
listed under *Review items*: “A source states this build was accepted, but HQ holds no
founder-acceptance evidence for it and no founder decision recorded in HQ accepts it.” (For a build
claimed as accepted with no source quoted, the item says that instead.) This is the
cautious reading, and it lists more builds for review than the earlier rule did.

A requirement counts as outstanding unless it is recorded as implemented and tested **and** at least
one linked evidence record exists that a source reports or HQ's build checked and that passes
validation (or the founder has given it a closed standing such as *satisfied*). A requirement whose
own record fails validation is always outstanding. A requirement whose implementation state claims
tests but has no linked evidence record is listed under *Review items*. A proposal cannot make a
requirement implemented and tested, nor change what a tested one links to (see “What a proposal may
assert”).

## Founder decisions

Only the founder, in a signed-in session, can:

- **accept, reject or ask for changes** to a proposal;
- **record a decision**, in their own words, stored exactly as typed. A decision may also
  - set the standing of a requirement: `unreviewed`, `active`, `satisfied`, `deferred`, `superseded`,
    `conflicted` or `withdrawn`; or
  - record acceptance or rejection of a build, module, loop, piece of evidence or commission, with a
    scope note, or clear an earlier acceptance or rejection. Clearing needs something to clear: an
    effect with the state `none` on a record that has no acceptance or rejection recorded in HQ is
    refused (422: “there is no acceptance or rejection recorded in HQ on <id> to clear”), and nothing
    is recorded. The effects are applied in order, so one decision can record an acceptance and then
    clear it. The decision API
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
  it. Such a report reaches HQ only through an import: a proposal can neither introduce one nor change
  a build that carries one, except to withdraw it (see “A proposal can never assert acceptance”). HQ counts it as reported only when it is labelled `reported` or
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
unless the founder has accepted them in HQ. What a proposal adds to a record is its submitter's
claim; only the imported claims it left exactly as they were keep their source's label (see “What a
proposal may assert”). The screens label a submitter's claim *Submitter's claim*, head a build's statement
with that label “What the submitter says” (never “What the source says”), and mark its quotations
as quoted by the submitter: HQ checked that the words are in the source, not that they support the
statement.

## History and audit

- Every record version is kept, with who made it, when, through which proposal or decision, and under which commission.
- Record and overview screens can show an earlier dataset revision: add `?rev=N` to the address, or
  pass `rev` to a read tool (all except `get_recent_changes` and `list_my_proposals`). They then show
  the records exactly as they stood. The proposal inbox, proposal pages, the decision centre, *Changes*
  and *AI & API access* always show the latest, and say so when an address names a revision.
- The audit log records sign-ins, sign-outs, token use, writes and refusals. It is append-only and
  visible only to the founder. Refusals of callers without a valid identity are bounded: per server
  process, at most 120 a minute for each action and reason are written in full, and the rest are
  counted in one summary row for that minute (docs/SECURITY.md). Refusals are recorded by the application, in a transaction of their
  own. A refusal raised inside a database function cannot record itself (the refusal rolls its own
  write back), so a caller that goes round the application leaves no record of being refused.

## Imported text is data, not instruction

Source documents, repository text and anything a client submits are stored and displayed as text.
Nothing in them can grant a permission, change a role or trigger an action: permissions come only
from the identity of the caller, checked in the database.
