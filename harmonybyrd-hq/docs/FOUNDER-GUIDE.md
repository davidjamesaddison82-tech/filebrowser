# Founder demonstration guide

Fifteen minutes, start to finish. Everything below works on a local installation with the real
evidence pack loaded (see INSTALL.md). With only the synthetic fixture loaded the steps are the same;
the records are invented and a banner says so.

Sign in at `http://localhost:3210` as **founder** with the passphrase that `npm run setup` printed.

Sign in from a browser you have used before when you can. After a successful sign-in HQ leaves a
small cookie in that browser that says “this person has signed in here”. If someone keeps sending
wrong passphrases to the sign-in page — it takes only about two requests a second — a browser without
that cookie can be told “Too many sign-in attempts are in progress. Try again in a moment.” for as
long as they keep it up; a browser with it is not held up by them (docs/KNOWN-GAPS.md describes the
one way it still can be). The cookie does not sign you in and opens nothing on its own. Signing out
leaves it in place.

---

## 1. The banner (10 seconds)

Every screen carries the same line at the top: *Prototype — not an authoritative record.* It links to
the reason: HQ could not find evidence that the HB-AI-P00 prerequisite is completed and accepted.
That stays true until you supply the evidence and decide otherwise.

## 2. Dashboard — the eight questions (3 minutes)

The opening screen answers the commission's closing questions:

| Question | Where on the screen |
| --- | --- |
| What are we building? | **Ecosystem overview** — every module, grouped by family. Hover or tab to one to see what it connects to; click it to open it |
| What already exists? Is it actually working? | The colour of each module: accepted in HQ · rejected in HQ (red) · acceptance reported in a document · tested, not accepted · prototype, untested · designed only · documented only · named only |
| What evidence proves that? | **Development health** — each figure opens the list behind it. “Founder acceptance recorded in HQ” and “Founder rejected in HQ” start at zero: they count only what you have decided here. “Checks made by HQ's build” counts what the build that produced the dataset checked (checksums, quotations, test runs); the running application re-checks quotations at import but does not re-run the rest |
| What is missing? What has not been fulfilled? | **Missing and forgotten work** — documents named but not readable, modules with no source, requirements with no implementation or test record, modules nobody has mentioned recently |
| What should happen next, and why? | **Development priorities** — HQ's recommendations, ranked, each with what it needs first. They are recommendations; nothing is approved until you decide |
| What changed? | **Recent changes** — every dataset revision: what, when, why, by whom, under which commission |

Try: click **Tested, not accepted**, then one of the modules listed.

Each pending decision is counted once, even when an open item records the same decision (it is
listed with it), and a blocker is counted once. *Open defects* and *Unverified claims* include
records that came in through the proposal inbox; their notes say “Reported through the inbox
(PROP-…); not verified.”

## 3. A module (3 minutes)

*Modules* → pick one you know well.

- **Purpose**: objective, intended user, why it exists, what the learner should be able to do. If a
  line says “Not stated in any accessible source”, that is a gap in the documents HQ could read, not an opinion.
- **Lifecycle**: twelve separate questions, never one percentage. Each answer has its basis; “yes”
  and “partial” always carry the quotation they rest on, which you can open and read.
- Every statement carries a small label — *Reported in source*, *Design intention*, *Founder statement*,
  *Source author's recommendation*, *Checked by HQ's build*, *Submitter's claim (unverified)* — and
  “source quotations” you can open to read the exact words and jump to the document. Only an import
  can give the first four labels. Anything that came in through the proposal inbox is the
  submitter's claim; its quotations are marked “quoted by the submitter — HQ checked the words are in
  the source, not that they support this”. A quotation proves only that the words are in the
  document: read it before you rely on the statement. A submitter's claim never raises a module's
  standing.
- A record that came in through the proposal inbox carries the chip *Entered through the proposal
  inbox (PROP-…)*, or *Last changed through the proposal inbox* when a later version did.
- A record you have accepted or rejected in HQ has no **Propose a change** button. Instead a notice
  says that proposals cannot change it: to change it, first record a decision that clears your
  acceptance, or propose a new record.
- **Executable versions**, **defects**, **tests and evidence**, **decisions**, **connections**, **blockers and next actions**.
  A build marked as accepted whose statement does not quote a source reporting it is labelled
  *Acceptance claimed — no source quoted*. HQ does not count it as a reported acceptance, and lists
  it under *Unverified claims*. A build that a source reports as accepted says on its page that a
  proposal can only withdraw that report; its **Propose a change** form offers the standing alone.
- A stored value HQ does not recognise — a status that is not on its list, a list where text should
  be — is shown as *Not a valid value*, never as a status, and such a record's page says it does not
  pass validation. HQ counts nothing in such a record as proof: not an acceptance, a test, a check or
  a link. A defect it cannot read counts as open. A module that such a record names carries a warning
  under its heading — “N record(s) that name this module cannot be read in full; its figures
  may be incomplete.” — with a link to each, and the module register and dashboard say so too. A
  module whose own record fails validation reads *Not reliable* instead of figures.
- **History & lineage** (top right) shows every version of the record and the hash chain.

Check it against what you know. Where HQ is wrong, do not edit — use **Propose a change** (step 7), or tell your developer to.

## 4. Learning loops (1 minute)

*Learning loops* shows each loop in its source's own steps, laid against the shared progression
(Encounter → Understand → Predict → Hear → Physically perform → Use creatively → Capture/reflect →
Retrieve later → Transfer). A stage is filled only where the source supports it; gaps are left as gaps.
Cross-module pathways are drawn below. Open one loop to see what the student does, what HarmonyByrd
observes, the feedback, when retrieval or transfer happens, what would count as success — and who
decides what is musically correct.

## 5. Your requirements (2 minutes)

*Founder requirements* is the register of your instructions.

- Open one. **Original wording** is the exact text from its source and can never be changed, by anyone.
  **Interpretation** is HQ's reading, kept separate, and can be changed by proposal.
- *How we have these words* tells you whether it is your own commission text, a direct quotation, a
  ruling recorded by a document, or a document author's restatement of what you asked.
- Every requirement starts **Unreviewed**. Only you can make it active, satisfied, deferred, superseded,
  conflicted or withdrawn, or set it back to unreviewed (step 8).
- *Review items* lists possible duplicates, conflicts, restated wordings and acceptance claims with no instrument behind them.
  For a build, only two things count as an instrument: founder-acceptance evidence for that build that a
  source reports or HQ's build checked, or a decision you recorded in HQ that accepts that build
  (either must pass validation). A
  decision about its module, or one a document reports, no longer counts, and your decision counts
  only while the build's HQ acceptance is still the one it recorded: if you later clear it, or reject
  the build, the review item comes back. So more builds may now be listed for review than before;
  that is the cautious reading, not a change in the builds.

## 6. Sources (1 minute)

*Sources* is the inventory of what HQ actually read: location, version, SHA-256, how much was read,
and what authority HQ assigned it — and, separately, every document that is named somewhere but
could not be reached. Start with the governance gate at the top.

## 7. A proposal (2 minutes)

Anyone who may propose — a developer, or Claude or ChatGPT through the API — can ask for a change. Nothing changes until you accept it.

1. On any record, **Propose a change**. Pick a field, give the new value and the reason. Submit.
   The form offers only the fields that kind of record has, and shows each as it is stored (a stored
   value of the wrong kind appears as JSON, never as “Not a valid value”).
   Text fields take text. Structured fields — statements, lists, objects — and numbers and true/false
   values are edited as JSON, even when they are empty; the help text shows the shape of a statement,
   and `null` clears a field. A statement you propose is your own claim: label it `submitter_claim`
   (it may quote a source) or `no_evidence`. An imported statement can be left as it is, removed, or
   replaced by your claim.
2. *Proposal inbox* (or *Decision centre*) now shows it. Open it: you see the current value beside
   the proposed one, what else refers to the record, the sources it rests on, and the risks. For a
   proposal that creates a record, *Original context* lists the sources the new record cites, and says
   for each whether HQ holds its text (only then can its quotations be checked). Under *Known risks to
   weigh*, a proposal that sets where a record stands — its lifecycle, standing, statement, status,
   type or result — says so, and one that withdraws a build's reported acceptance says that too. If
   the record has since gained an acceptance or rejection of yours, or the proposal would change a
   build a source reports as accepted without withdrawing that, the page warns that the proposal
   cannot be accepted.
3. **Accept and apply**, **Ask for changes** or **Reject**. Accepting creates a new dataset revision;
   *Changes* records it with your name and the proposal's id. The page then says “Your acceptance
   was recorded.” (or rejection, or request for changes). If someone — or you, in another tab —
   closed the proposal first, it says “Your … was not applied: this proposal was already … by … at …”.
4. If the record changed after the proposal was written, HQ refuses to apply it and marks it stale.
5. HQ re-checks the proposal as you accept it: every quotation must be in its source, it may not
   use HQ's own labels or give a source's labels to its own words, it may not claim an acceptance or
   say a requirement is implemented and tested, it may not change a record HQ did not write, every
   listed value must be on its list, it may set only fields the record has, and the whole record must
   still be valid as it would then stand. A proposal that fails is refused, not applied, and stays in
   the inbox: you can still reject it or ask for changes.

Notice what the proposal form does not offer: a requirement's original wording, its standing,
acceptance, the fields only HQ's build writes, and, for sources, what HQ recorded about the
snapshot; for a requirement already implemented and tested, its linked evidence and builds. The card
*What cannot be proposed* lists the locked fields for that record. Evidence that a source reports or
HQ's build checked, and a source HQ has read, have no form at all: a notice says that only an import
changes them (for evidence: submit new evidence instead).

## 8. A decision (2 minutes)

*Decision centre* lists what the documents record as still waiting for you, and lets you record a
decision **in your own words**, stored exactly as typed.

A decision can also change something in HQ:
- set a requirement's standing, including back to unreviewed; or
- record that you accept (or reject) a build, module, loop, piece of evidence or commission — with a
  scope note such as “desktop browsers only” — or clear an acceptance or rejection you recorded earlier.
  HQ refuses to clear one that is not there, and records nothing.

Anything the decision names — what it resolves, its modules, what it accepts — must exist in HQ;
otherwise nothing is recorded and HQ lists the ids it could not find.

This is the only way anything in HQ becomes *accepted*. No assistant and no developer can do it:
there is no such tool in the API, and the database refuses every attempt. A proposal cannot even
claim that a document reports something — a source's label on its own words is refused whatever it
quotes, and so is marking a build as accepted, or a module's founder acceptance as anything but no,
unknown or not applicable — and it cannot change a build a document reports as accepted, except to
withdraw that report. Such reports come in only through an import.

## 9. Access for Claude and ChatGPT (1 minute)

*AI & API access* lists the 18 tools both assistants would use, shows what has been tested and what
has not, and lets you issue a token per client (shown once) and revoke it. At the bottom is the
audit log, including the refusals HQ recorded (docs/SECURITY.md says which ones it cannot record).

Neither assistant is connected yet. The page explains what each needs.

**Sign out** (bottom of the menu) signs you out everywhere: every browser where you are signed in,
and any copy of your session. Setting a new passphrase does the same. Tokens you issued keep working
until you revoke them.

---

## Looking back in time

Add `?rev=3` to the address of a record or overview screen — the dashboard, modules, loops,
requirements, evidence, sources, records, review items, search, the health and missing-work lists —
to see the records exactly as they stood at dataset revision 3. A bar at the top of every screen
says “You are viewing dataset revision 3, not the latest (revision N)” with a **Return to the latest**
link. Links on that screen keep revision 3, and the menu's counts are hidden. The proposal inbox,
proposal pages, the decision centre, *Changes* and *AI & API access* always show the latest; with
`?rev=` they say “this screen always shows the latest”. On a record or overview screen, a revision
that does not exist, or a `rev` that is not a whole number, gives the “not found” page.

## Checking the history

*Review items* starts with a check of the stored history. “The stored history is internally
consistent” means every version links to the one before it, every revision's seal matches its
records, and the seals chain back to revision 1. It cannot show that someone with full control of
the database did not rewrite history and seals together. For that, the screen shows the **seal of the
latest revision**: keep a copy of it and its revision number outside HQ (for example in an email to
yourself). A revision's seal never changes; if the one stored for that revision ever differs from
your copy, the history up to it was rewritten. On a pinned screen the check is not shown.

## If something looks wrong

- A record is wrong → propose a change, or record a decision that says what is right.
- Something is missing → *Missing and forgotten work* may already list it. If not, report it as a defect from the *Proposal inbox*.
- HQ's own behaviour is wrong → that is a defect in HQ; report it the same way, against the module “HarmonyByrd HQ”.
