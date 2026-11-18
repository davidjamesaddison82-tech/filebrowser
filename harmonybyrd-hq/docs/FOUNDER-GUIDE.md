# Founder demonstration guide

Fifteen minutes, start to finish. Everything below works on a local installation with the real
evidence pack loaded (see INSTALL.md). With only the synthetic fixture loaded the steps are the same;
the records are invented and a banner says so.

Sign in at `http://localhost:3210` as **founder** with the passphrase that `npm run setup` printed.

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
| What already exists? Is it actually working? | The colour of each module: accepted in HQ · acceptance reported in a document · tested, not accepted · prototype, untested · designed only · documented only · named only |
| What evidence proves that? | **Development health** — each figure opens the list behind it. “Founder acceptance recorded in HQ” starts at zero: it counts only what you have accepted here |
| What is missing? What has not been fulfilled? | **Missing and forgotten work** — documents named but not readable, modules with no source, requirements with no implementation or test record, modules nobody has mentioned recently |
| What should happen next, and why? | **Development priorities** — HQ's recommendations, ranked, each with what it needs first. They are recommendations; nothing is approved until you decide |
| What changed? | **Recent changes** — every dataset revision: what, when, why, by whom, under which commission |

Try: click **Tested, not accepted**, then one of the modules listed.

## 3. A module (3 minutes)

*Modules* → pick one you know well.

- **Purpose**: objective, intended user, why it exists, what the learner should be able to do. If a
  line says “Not stated in any accessible source”, that is a gap in the documents HQ could read, not an opinion.
- **Lifecycle**: twelve separate questions, never one percentage. Each answer has its basis; “yes”
  and “partial” always carry the quotation that supports them.
- Every statement carries a small label — *Reported in source*, *Design intention*, *Founder statement*,
  *Source author's recommendation* — and “source quotations” you can open to read the exact words and jump to the document.
- **Executable versions**, **defects**, **tests and evidence**, **decisions**, **connections**, **blockers and next actions**.
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
- Every requirement starts **Unreviewed**. Only you can make it active, satisfied, deferred, superseded or withdrawn (step 8).
- *Review items* lists possible duplicates, conflicts, restated wordings and acceptance claims with no instrument behind them.

## 6. Sources (1 minute)

*Sources* is the inventory of what HQ actually read: location, version, SHA-256, how much was read,
and what authority HQ assigned it — and, separately, every document that is named somewhere but
could not be reached. Start with the governance gate at the top.

## 7. A proposal (2 minutes)

Anyone who may propose — a developer, or Claude or ChatGPT through the API — can ask for a change. Nothing changes until you accept it.

1. On any record, **Propose a change**. Pick a field, give the new value and the reason. Submit.
2. *Proposal inbox* (or *Decision centre*) now shows it. Open it: you see the current value beside
   the proposed one, what else refers to the record, the sources it rests on, and the risks.
3. **Accept and apply**, **Ask for changes** or **Reject**. Accepting creates a new dataset revision;
   *Changes* records it with your name and the proposal's id.
4. If the record changed after the proposal was written, HQ refuses to apply it and marks it stale.

Notice what the proposal form does not offer: a requirement's original wording, its standing, and acceptance.

## 8. A decision (2 minutes)

*Decision centre* lists what the documents record as still waiting for you, and lets you record a
decision **in your own words**, stored exactly as typed.

A decision can also change something in HQ:
- set a requirement's standing; or
- record that you accept (or reject) a build, module, loop, piece of evidence or commission — with a scope note such as “desktop browsers only”.

This is the only way anything in HQ becomes *accepted*. No assistant and no developer can do it:
there is no such tool in the API, and the database refuses every attempt.

## 9. Access for Claude and ChatGPT (1 minute)

*AI & API access* lists the 18 tools both assistants would use, shows what has been tested and what
has not, and lets you issue a token per client (shown once) and revoke it. At the bottom is the
audit log: every refusal is there.

Neither assistant is connected yet. The page explains what each needs.

---

## Looking back in time

Add `?rev=3` to a page's address to see the records exactly as they stood at dataset revision 3. A blue notice confirms it.

## If something looks wrong

- A record is wrong → propose a change, or record a decision that says what is right.
- Something is missing → *Missing and forgotten work* may already list it. If not, report it as a defect from the *Proposal inbox*.
- HQ's own behaviour is wrong → that is a defect in HQ; report it the same way, against the module “HarmonyByrd HQ”.
