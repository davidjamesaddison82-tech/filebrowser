#!/usr/bin/env python3
"""Regenerate the synthetic fixture pack (data/packs/fixture).

Everything in this pack is invented test data. It describes no real HarmonyByrd module, build,
decision or person. It exists so the automated tests have a small, deterministic dataset that
exercises every record type and every review rule.

    python3 scripts/dev/build-fixture-pack.py
"""
import json, os, hashlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "packs", "fixture")

SRC_A = """# Fixture Document A (synthetic)

This document is synthetic test data for HarmonyByrd HQ. It describes no real HarmonyByrd module.

## Alpha module
Alpha lets a learner practise a scale pattern slowly, then at tempo.
Alpha is for adult beginners who already read simple notation.
Alpha exists as a runnable prototype named alpha-candidate-7.
The alpha-candidate-7 suite ran 42 automated tests and all 42 passed.
Alpha candidate 7 is a candidate and has not been accepted.
Alpha hands a finished pattern to Beta for review.
Known defect: Alpha drops the last note of a pattern when the tempo is above 180.

## Beta module
Beta reviews a pattern the learner made earlier and asks them to recall it after three days.
Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only.
The resolved defect: Beta showed the wrong key signature; this was fixed in Beta build 2.

## Gamma module
Gamma is a design only. No Gamma software has been written.
Gamma should let a learner improvise over the pattern they practised in Alpha.

## Founder instructions (synthetic)
The founder said: "Every pattern must be playable at a slow tempo before a fast one."
The founder said: "Never show a score out of ten."
The founder said: "Show the learner a score out of ten after each pattern."
The founder said: "Keep the interface free of pop-up windows."
The founder ruled on 1 February 2031 that Gamma work waits until Alpha is accepted.
Decision FX-D2 on whether Gamma may use recorded audio is unissued.

## Loop
Meet the pattern, hear it, play it slowly, play it at tempo, then come back to it after three days.
"""

SRC_B = """# Fixture Handover B (synthetic)

This handover is synthetic test data for HarmonyByrd HQ.

The founder said: "Every pattern must be playable at a slow tempo before a fast one."
Alpha was demonstrated in a real browser on 9 April 2031.
This handover does not mention Gamma.
Blocker: Beta cannot import patterns until the shared pattern format is agreed.
The Fixture Master State document governs both modules.
"""

def cite(src, quote, locator=None):
    return {"source_id": src, "locator": locator, "quote": quote}

def claim(text, epistemic, *cites):
    return {"text": text, "epistemic": epistemic, "citations": list(cites)}

DIMS = ["documented", "designed", "prototyped", "implemented", "automated_tests", "browser_tested", "hardware_tested",
        "independently_assessed", "founder_accepted", "integrated", "released", "learner_validated"]

def lifecycle(**known):
    out = {}
    for d in DIMS:
        if d in known:
            state, note, cites = known[d]
            out[d] = {"state": state, "basis": "reported" if cites else "no_evidence", "note": note, "citations": cites}
        else:
            out[d] = {"state": "unknown", "basis": "no_evidence", "note": "", "citations": []}
    return out

def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

FAMILY = "Fixture family (synthetic)"

sources = [
    {"id": "SRC-F01", "title": "Fixture Document A (synthetic)", "kind": "fixture", "location": None, "version": "1", "sha256": sha(SRC_A),
     "bytes": len(SRC_A.encode()), "retrieved_at": None, "doc_date": "2031-03-10", "updated": "2031-03-10", "access": "read_full",
     "authority": "fixture", "authority_note": "Synthetic test data. Not a HarmonyByrd record.", "summary": "Invented description of three invented modules.",
     "product_scope": "fixture", "prepared_by": "HQ test fixture", "commission_codes": ["FX-COM-1"],
     "text_snapshot": {"file": "SRC-F01.md", "sha256": sha(SRC_A), "chars": len(SRC_A)}},
    {"id": "SRC-F02", "title": "Fixture Handover B (synthetic)", "kind": "fixture", "location": None, "version": "1", "sha256": sha(SRC_B),
     "bytes": len(SRC_B.encode()), "retrieved_at": None, "doc_date": "2031-04-12", "updated": "2031-04-12", "access": "read_full",
     "authority": "fixture", "authority_note": "Synthetic test data. Not a HarmonyByrd record.", "summary": "Invented later handover that omits one module.",
     "product_scope": "fixture", "prepared_by": "HQ test fixture", "commission_codes": [],
     "text_snapshot": {"file": "SRC-F02.md", "sha256": sha(SRC_B), "chars": len(SRC_B)}},
    {"id": "SRC-F03", "title": "Fixture Master State (synthetic, never supplied)", "kind": "named_not_accessible", "location": None,
     "access": "not_accessible", "authority": "referenced_only",
     "authority_note": "Named by Fixture Handover B as governing; no copy exists in the fixture pack.", "summary": "", "product_scope": "fixture",
     "named_in": [cite("SRC-F02", "The Fixture Master State document governs both modules.")]},
]

modules = [
    {"id": "MOD-FX-ALPHA", "name": "Alpha (fixture)", "aliases": ["alpha-candidate-7"], "kind": "module", "parent_id": None, "family": FAMILY,
     "commission_listed": True, "evidence_level": "documented_in_sources",
     "summary": "Synthetic module with a prototype and passing automated tests, and no acceptance.",
     "objective": claim("Let a learner practise a scale pattern slowly, then at tempo.", "reported",
                        cite("SRC-F01", "Alpha lets a learner practise a scale pattern slowly, then at tempo.", "Alpha module")),
     "intended_user": claim("Adult beginners who read simple notation.", "reported",
                            cite("SRC-F01", "Alpha is for adult beginners who already read simple notation.", "Alpha module")),
     "why_exists": None, "learner_outcome": None,
     "core_loop": claim("Meet, hear, play slowly, play at tempo, return after three days.", "reported",
                        cite("SRC-F01", "Meet the pattern, hear it, play it slowly, play it at tempo, then come back to it after three days.", "Loop")),
     "capabilities": [
         {"title": "Slow then at-tempo practice", "detail": "", "state": "existing", "epistemic": "reported",
          "citations": [cite("SRC-F01", "Alpha lets a learner practise a scale pattern slowly, then at tempo.")]},
         {"title": "Hand a pattern to Beta", "detail": "", "state": "partial", "epistemic": "reported",
          "citations": [cite("SRC-F01", "Alpha hands a finished pattern to Beta for review.")]}],
     "ui_requirements": [],
     "lifecycle": lifecycle(
         documented=("yes", "Described in Fixture Document A.", [cite("SRC-F01", "Alpha lets a learner practise a scale pattern slowly, then at tempo.")]),
         prototyped=("yes", "alpha-candidate-7", [cite("SRC-F01", "Alpha exists as a runnable prototype named alpha-candidate-7.")]),
         automated_tests=("yes", "42 of 42 reported", [cite("SRC-F01", "The alpha-candidate-7 suite ran 42 automated tests and all 42 passed.")]),
         browser_tested=("partial", "Demonstrated once", [cite("SRC-F02", "Alpha was demonstrated in a real browser on 9 April 2031.")]),
         founder_accepted=("no", "Candidate only", [cite("SRC-F01", "Alpha candidate 7 is a candidate and has not been accepted.")])),
     "blockers": [], "next_actions": [], "loop_ids": ["LOOP-FX-01"],
     "connections": [{"to": "MOD-FX-BETA", "nature": "hands finished patterns to", "epistemic": "reported",
                      "citations": [cite("SRC-F01", "Alpha hands a finished pattern to Beta for review.")]}],
     "citations": []},
    {"id": "MOD-FX-BETA", "name": "Beta (fixture)", "aliases": [], "kind": "module", "parent_id": None, "family": FAMILY,
     "commission_listed": False, "evidence_level": "documented_in_sources",
     "summary": "Synthetic module whose source reports a scoped founder acceptance.",
     "objective": claim("Review an earlier pattern and prompt recall after three days.", "reported",
                        cite("SRC-F01", "Beta reviews a pattern the learner made earlier and asks them to recall it after three days.")),
     "intended_user": None, "why_exists": None, "learner_outcome": None, "core_loop": None, "capabilities": [], "ui_requirements": [],
     "lifecycle": lifecycle(
         documented=("yes", "", [cite("SRC-F01", "Beta reviews a pattern the learner made earlier and asks them to recall it after three days.")]),
         prototyped=("yes", "Beta build 2", [cite("SRC-F01", "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only.")]),
         founder_accepted=("partial", "Desktop browsers only", [cite("SRC-F01", "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only.")])),
     "blockers": [claim("Cannot import patterns until the shared pattern format is agreed.", "reported",
                        cite("SRC-F02", "Blocker: Beta cannot import patterns until the shared pattern format is agreed."))],
     "next_actions": [], "loop_ids": [], "connections": [], "citations": []},
    {"id": "MOD-FX-GAMMA", "name": "Gamma (fixture)", "aliases": [], "kind": "module", "parent_id": None, "family": FAMILY,
     "commission_listed": False, "evidence_level": "documented_in_sources",
     "summary": "Synthetic module that exists only as a design and is absent from the later handover.",
     "objective": claim("Let a learner improvise over a practised pattern.", "design_intention",
                        cite("SRC-F01", "Gamma should let a learner improvise over the pattern they practised in Alpha.")),
     "intended_user": None, "why_exists": None, "learner_outcome": None, "core_loop": None, "capabilities": [
         {"title": "Improvise over a practised pattern", "detail": "", "state": "intended_absent", "epistemic": "design_intention",
          "citations": [cite("SRC-F01", "Gamma should let a learner improvise over the pattern they practised in Alpha.")]}],
     "ui_requirements": [],
     "lifecycle": lifecycle(
         documented=("yes", "", [cite("SRC-F01", "Gamma is a design only. No Gamma software has been written.")]),
         designed=("yes", "", [cite("SRC-F01", "Gamma is a design only. No Gamma software has been written.")]),
         prototyped=("no", "", [cite("SRC-F01", "Gamma is a design only. No Gamma software has been written.")])),
     "blockers": [], "next_actions": [], "loop_ids": [],
     "connections": [{"to": "MOD-FX-ALPHA", "nature": "would build on patterns practised in", "epistemic": "design_intention",
                      "citations": [cite("SRC-F01", "Gamma should let a learner improvise over the pattern they practised in Alpha.")]}],
     "citations": []},
    {"id": "MOD-FX-DELTA", "name": "Delta (fixture, named only)", "aliases": [], "kind": "module", "parent_id": None, "family": FAMILY,
     "commission_listed": True, "evidence_level": "commission_list_only",
     "summary": "Synthetic module that is listed but described by no source.",
     "objective": None, "intended_user": None, "why_exists": None, "learner_outcome": None, "core_loop": None, "capabilities": [],
     "ui_requirements": [], "lifecycle": lifecycle(), "blockers": [], "next_actions": [], "loop_ids": [], "connections": [], "citations": []},
]

loop_quote = cite("SRC-F01", "Meet the pattern, hear it, play it slowly, play it at tempo, then come back to it after three days.", "Loop")
loops = [
    {"id": "LOOP-FX-01", "name": "Pattern practice loop (fixture)", "module_ids": ["MOD-FX-ALPHA"], "variant_of": None, "standing": "reported",
     "objective": claim("Secure one pattern from first meeting to later recall.", "reported", loop_quote),
     "concepts": ["scale pattern", "tempo"],
     "student_does": claim("Hears the pattern, then plays it slowly and at tempo.", "reported", loop_quote),
     "system_observes": None, "feedback_scaffolding": None,
     "retrieval_transfer": claim("Returns to the pattern after three days.", "reported", loop_quote),
     "success_evidence": None, "assessment_authority": None,
     "steps": [
         {"order": 1, "source_term": "Meet the pattern", "description": "", "shared_stage": "encounter", "module_id": "MOD-FX-ALPHA", "citations": [loop_quote]},
         {"order": 2, "source_term": "hear it", "description": "", "shared_stage": "hear", "module_id": "MOD-FX-ALPHA", "citations": [loop_quote]},
         {"order": 3, "source_term": "play it slowly", "description": "", "shared_stage": "perform", "module_id": "MOD-FX-ALPHA", "citations": [loop_quote]},
         {"order": 4, "source_term": "play it at tempo", "description": "", "shared_stage": "perform", "module_id": "MOD-FX-ALPHA", "citations": [loop_quote]},
         {"order": 5, "source_term": "come back to it after three days", "description": "", "shared_stage": "retrieve", "module_id": "MOD-FX-BETA", "citations": [loop_quote]}],
     "citations": [loop_quote]},
    {"id": "LOOP-FX-02", "name": "Improvisation loop (fixture, design only)", "module_ids": ["MOD-FX-GAMMA"], "variant_of": "LOOP-FX-01",
     "standing": "design_intention",
     "objective": claim("Use a practised pattern creatively.", "design_intention",
                        cite("SRC-F01", "Gamma should let a learner improvise over the pattern they practised in Alpha.")),
     "concepts": ["improvisation"], "student_does": None, "system_observes": None, "feedback_scaffolding": None, "retrieval_transfer": None,
     "success_evidence": None, "assessment_authority": None,
     "steps": [{"order": 1, "source_term": "improvise over the pattern", "description": "", "shared_stage": "create", "module_id": "MOD-FX-GAMMA",
                "citations": [cite("SRC-F01", "Gamma should let a learner improvise over the pattern they practised in Alpha.")]}],
     "citations": []},
]

pathways = [
    {"id": "PATH-FX-01", "name": "Alpha → Beta → Gamma (fixture)", "description": "Synthetic cross-module route.", "basis": "design_intention",
     "steps": [
         {"order": 1, "module_id": "MOD-FX-ALPHA", "role": "focused practice of a pattern", "shared_stage": "perform",
          "citations": [cite("SRC-F01", "Alpha lets a learner practise a scale pattern slowly, then at tempo.")]},
         {"order": 2, "module_id": "MOD-FX-BETA", "role": "later recall of the pattern", "shared_stage": "retrieve",
          "citations": [cite("SRC-F01", "Beta reviews a pattern the learner made earlier and asks them to recall it after three days.")]},
         {"order": 3, "module_id": "MOD-FX-GAMMA", "role": "creative use of the pattern", "shared_stage": "create",
          "citations": [cite("SRC-F01", "Gamma should let a learner improvise over the pattern they practised in Alpha.")]}],
     "citations": []},
]

def req(rid, wording, src, title, category, modules, **extra):
    base = {"id": rid, "exact_wording": wording, "source_id": src, "locator": "Founder instructions (synthetic)", "source_date": "2031-03-10",
            "attribution": "direct_quote", "title": title, "category": category, "interpretation": None, "module_ids": modules,
            "disposition": "unreviewed", "implementation_state": "no_record", "implementation_note": None, "acceptance_criteria": [],
            "depends_on": [], "linked_code": [], "linked_evidence_ids": [], "linked_build_ids": [], "decision_ids": [], "conflicts_with": [],
            "supersedes": [], "superseded_by": [], "duplicate_of": None, "citations": []}
    base.update(extra)
    return base

requirements = [
    req("FR-FX-001", "Every pattern must be playable at a slow tempo before a fast one.", "SRC-F01", "Slow tempo first", "pedagogy", ["MOD-FX-ALPHA"],
        implementation_state="implemented_tested", linked_evidence_ids=["EV-FX-01"], linked_build_ids=["BLD-FX-01"],
        linked_code=[{"repository": "fixture/alpha", "ref": "0000000000000000000000000000000000000000", "path": "src/tempo.ts", "note": "synthetic reference"}],
        implementation_note=claim("The fixture source reports slow-then-tempo practice exists.", "reported",
                                  cite("SRC-F01", "Alpha lets a learner practise a scale pattern slowly, then at tempo."))),
    req("FR-FX-002", "Never show a score out of ten.", "SRC-F01", "No score out of ten", "ui_ux", ["MOD-FX-ALPHA", "MOD-FX-BETA"],
        conflicts_with=[{"id": "FR-FX-003", "note": "One instruction forbids a score out of ten; the other requires it."}]),
    req("FR-FX-003", "Show the learner a score out of ten after each pattern.", "SRC-F01", "Score out of ten after each pattern", "ui_ux", ["MOD-FX-ALPHA"],
        conflicts_with=[{"id": "FR-FX-002", "note": "One instruction forbids a score out of ten; the other requires it."}]),
    req("FR-FX-004", "Keep the interface free of pop-up windows.", "SRC-F01", "No pop-up windows", "ui_ux", []),
    req("FR-FX-005", "Every pattern must be playable at a slow tempo before a fast one.", "SRC-F02", "Slow tempo first (restated in handover)", "pedagogy",
        ["MOD-FX-ALPHA"], locator=None, source_date="2031-04-12"),
    req("FR-FX-006", "The founder ruled on 1 February 2031 that Gamma work waits until Alpha is accepted.", "SRC-F01", "Gamma waits for Alpha", "scope",
        ["MOD-FX-GAMMA"], attribution="ruling_recorded_by_source", source_date="2031-02-01", disposition="superseded", decision_ids=["FD-FX-01"]),
]

decisions = [
    {"id": "FD-FX-01", "code": "FX-D1", "title": "Gamma work waits until Alpha is accepted", "status": "issued", "recorded_in": "source", "date": "2031-02-01",
     "statement": claim("The fixture source records a founder ruling that Gamma waits for Alpha's acceptance.", "founder_statement",
                        cite("SRC-F01", "The founder ruled on 1 February 2031 that Gamma work waits until Alpha is accepted.")),
     "exact_text": None, "module_ids": ["MOD-FX-GAMMA", "MOD-FX-ALPHA"], "requirement_ids": ["FR-FX-006"], "commission_code": None, "citations": []},
    {"id": "FD-FX-02", "code": "FX-D2", "title": "May Gamma use recorded audio?", "status": "unissued", "recorded_in": "source", "date": None,
     "statement": claim("The fixture source says this decision has not been issued.", "reported",
                        cite("SRC-F01", "Decision FX-D2 on whether Gamma may use recorded audio is unissued.")),
     "exact_text": None, "module_ids": ["MOD-FX-GAMMA"], "requirement_ids": [], "commission_code": None, "citations": []},
]

commissions = [
    {"id": "COM-FX-01", "code": "FX-COM-1", "title": "Fixture commission (synthetic)", "date": "2031-03-01", "status": "delivered",
     "scope": claim("Describe the three fixture modules.", "reported", cite("SRC-F01", "This document is synthetic test data for HarmonyByrd HQ.")),
     "module_ids": ["MOD-FX-ALPHA", "MOD-FX-BETA", "MOD-FX-GAMMA"], "output_source_ids": ["SRC-F01"], "citations": []},
]

builds = [
    {"id": "BLD-FX-01", "label": "alpha-candidate-7", "module_id": "MOD-FX-ALPHA", "filename": "alpha-candidate-7.html",
     "sha256": "1111111111111111111111111111111111111111111111111111111111111111", "bytes": "12,345", "standing": "candidate_not_accepted",
     "statement": claim("A candidate build; not accepted.", "reported", cite("SRC-F01", "Alpha candidate 7 is a candidate and has not been accepted.")),
     "artifact_source_id": None, "citations": []},
    {"id": "BLD-FX-02", "label": "Beta build 2", "module_id": "MOD-FX-BETA", "filename": None, "sha256": None, "bytes": None, "standing": "accepted_reported",
     "statement": claim("Reported as accepted by the founder for desktop browsers only.", "reported",
                        cite("SRC-F01", "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only.")),
     "artifact_source_id": None, "citations": []},
]

evidence = [
    {"id": "EV-FX-01", "type": "automated_test", "title": "alpha-candidate-7 automated suite", "module_ids": ["MOD-FX-ALPHA"], "build_id": "BLD-FX-01",
     "result": claim("42 automated tests ran; 42 passed.", "reported", cite("SRC-F01", "The alpha-candidate-7 suite ran 42 automated tests and all 42 passed.")),
     "verification": "source_reported", "date": "2031-03-10", "sha256": None, "citations": []},
    {"id": "EV-FX-02", "type": "hq_check", "title": "Fixture Document A checksum recomputed", "module_ids": [], "build_id": None,
     "result": claim("The SHA-256 of the fixture snapshot was recomputed and matches the source record.", "verified"),
     "verification": "hq_verified", "date": "2031-04-12", "sha256": sha(SRC_A), "citations": []},
]

defects = [
    {"id": "DEF-FX-01", "title": "Alpha drops the last note above tempo 180", "module_ids": ["MOD-FX-ALPHA"], "build_id": "BLD-FX-01", "status": "open",
     "severity": "major", "statement": claim("The last note of a pattern is dropped when the tempo is above 180.", "reported",
                                               cite("SRC-F01", "Known defect: Alpha drops the last note of a pattern when the tempo is above 180.")),
     "citations": []},
    {"id": "DEF-FX-02", "title": "Beta showed the wrong key signature", "module_ids": ["MOD-FX-BETA"], "build_id": "BLD-FX-02", "status": "resolved",
     "severity": "minor", "statement": claim("Reported fixed in Beta build 2.", "reported",
                                               cite("SRC-F01", "The resolved defect: Beta showed the wrong key signature; this was fixed in Beta build 2.")),
     "citations": []},
]

open_items = [
    {"id": "OPEN-FX-01", "kind": "pending_founder_decision", "title": "Recorded audio in Gamma",
     "statement": claim("Whether Gamma may use recorded audio is undecided.", "reported",
                        cite("SRC-F01", "Decision FX-D2 on whether Gamma may use recorded audio is unissued.")),
     "module_ids": ["MOD-FX-GAMMA"], "decision_id": "FD-FX-02", "citations": []},
    {"id": "OPEN-FX-02", "kind": "blocker", "title": "Shared pattern format not agreed",
     "statement": claim("Beta cannot import patterns until the shared pattern format is agreed.", "reported",
                        cite("SRC-F02", "Blocker: Beta cannot import patterns until the shared pattern format is agreed.")),
     "module_ids": ["MOD-FX-BETA", "MOD-FX-ALPHA"], "decision_id": None, "citations": []},
]

recommendations = [
    {"id": "REC-FX-01", "title": "Fix the dropped last note in Alpha", "rationale": "An open defect blocks a fair acceptance review of the candidate.",
     "rank": 1, "status": "proposed", "made_by": "HQ test fixture", "module_ids": ["MOD-FX-ALPHA"], "prerequisite_ids": [], "blocked_by": [], "citations": []},
    {"id": "REC-FX-02", "title": "Put alpha-candidate-7 to the founder for an acceptance decision", "rationale": "Tests pass, but tests are not acceptance.",
     "rank": 2, "status": "proposed", "made_by": "HQ test fixture", "module_ids": ["MOD-FX-ALPHA"], "prerequisite_ids": ["REC-FX-01"],
     "blocked_by": ["DEF-FX-01"], "citations": []},
]

RECORDS = {"source": sources, "module": modules, "loop": loops, "pathway": pathways, "requirement": requirements, "decision": decisions,
           "commission": commissions, "build": builds, "evidence": evidence, "defect": defects, "open_item": open_items, "recommendation": recommendations}

os.makedirs(os.path.join(ROOT, "records"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "source-text"), exist_ok=True)
for name, rows in RECORDS.items():
    with open(os.path.join(ROOT, "records", f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1, ensure_ascii=False)
        f.write("\n")
with open(os.path.join(ROOT, "source-text", "SRC-F01.md"), "w", encoding="utf-8") as f:
    f.write(SRC_A)
with open(os.path.join(ROOT, "source-text", "SRC-F02.md"), "w", encoding="utf-8") as f:
    f.write(SRC_B)
manifest = {"pack_id": "hq-fixture", "title": "HarmonyByrd HQ synthetic fixture pack", "kind": "fixture", "version": "1.0.0",
            "generated_at": "2031-04-12T00:00:00Z", "generator": "scripts/dev/build-fixture-pack.py", "commission_ref": "FIXTURE",
            "notes": "Synthetic test data only. Describes no real HarmonyByrd module, build, decision or person."}
with open(os.path.join(ROOT, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=1)
    f.write("\n")
print("fixture pack written:", {k: len(v) for k, v in RECORDS.items()})
