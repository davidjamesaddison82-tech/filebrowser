# Governance: who can do what

HQ exists so that nothing is silently lost and nothing is silently changed. These are the rules it
enforces. Each is enforced in the database (a trigger, a function or a row-level-security policy),
not only in the user interface, and each has a test that tries to break it.

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

- It names the record **version** and **dataset revision** it was written against.
- It is visible only to its submitter and to the founder. One AI client cannot read another's proposals.
- Its history (submitted, changes requested, accepted, rejected, withdrawn, marked stale) is append-only.
- When the founder accepts it, HQ re-checks that the target has not changed. If it has, the proposal
  is **marked stale and not applied**, and the founder is told which version it was based on and
  which version is current. Nothing is merged silently.

## What a proposal can never do

Whatever role submits it, a proposal cannot set:

| Field | Why |
| --- | --- |
| `exact_wording`, `source_id`, `locator`, `source_date`, `attribution` | A founder requirement's original is permanent. A correction is a new requirement that supersedes it |
| `disposition`, `disposition_decision_id` | Only a founder decision changes a requirement's standing |
| `hq_acceptance` | Acceptance in HQ exists only as the effect of a founder decision |
| `recorded_in`, `decided_by`, `decided_at` | A decision “recorded in HQ” can only be made by the founder |
| `verification`, `submitted_by` | Evidence cannot upgrade its own verification status |
| `id` | Identifiers are durable |

A proposal that tries is refused when it is submitted (HTTP 422), and the refusal is audited.

## Evidence from agents

Test evidence submitted through `record_test_evidence` is stored — if the founder files it — with
the verification status **agent-submitted, unverified** (or *submitted, unverified* for a person),
permanently. An agent's statement that something is complete is recorded as that agent's statement.
It never counts towards “accepted”, and it appears under *Unverified claims* on the dashboard.

## Founder decisions

Only the founder, in a signed-in session, can:

- **accept, reject or ask for changes** to a proposal;
- **record a decision**, in their own words, stored exactly as typed. A decision may also
  - set the standing of a requirement (active, satisfied, deferred, superseded, conflicted, withdrawn), or
  - record acceptance or rejection of a build, module, loop, piece of evidence or commission, with a scope note;
- resolve a pending decision or open item by naming it in the decision;
- issue and revoke API tokens; read the audit log.

Recommendations — HQ's own, or an assistant's — are stored as recommendations with the status
`proposed`, and are displayed apart from approved work. Nothing turns a recommendation into an
approval except a founder decision.

## “Accepted” has two meanings, kept apart

- **Acceptance reported in a source** — a document says the founder accepted something. HQ shows it
  as reported, with the quotation and the scope the document states. HQ has not seen the founder do it.
- **Acceptance recorded in HQ** — the founder recorded it here. This is the only thing HQ itself calls accepted.

Passing tests are counted separately from both and are never shown as acceptance.

## History and audit

- Every record version is kept, with who made it, when, through which proposal or decision, and under which commission.
- Any earlier dataset revision can be opened (add `?rev=N` to a page, or pass `rev` to any tool) and
  shows the records exactly as they stood.
- The audit log records sign-ins, token use, writes and every refusal. It is append-only and visible only to the founder.

## Imported text is data, not instruction

Source documents, repository text and anything a client submits are stored and displayed as text.
Nothing in them can grant a permission, change a role or trigger an action: permissions come only
from the identity of the caller, checked in the database.
