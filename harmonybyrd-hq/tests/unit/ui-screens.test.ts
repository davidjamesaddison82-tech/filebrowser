/**
 * Screen helpers that keep pages from crashing on loose stored values (ui-3) and keep a pinned
 * revision on every link (ui-8, honesty-8, D14). Browser-level checks are in tests/e2e.
 */
import { describe, expect, it } from "vitest";
import { humanise, isoDate, statusLabel, statusTone } from "@/lib/ui/format";
import { citations, claim, codeRef, hqChecks, lifecycleReports, otherMentions, searchResults, strings } from "@/lib/ui/guards";
import { isPinnablePath, readRev, withRev } from "@/lib/ui/pin-rules";

describe("pinned revision links (D14)", () => {
  it("adds rev to an internal link and keeps the #fragment last", () => {
    expect(withRev("/modules/MOD-FX-ALPHA", 3)).toBe("/modules/MOD-FX-ALPHA?rev=3");
    expect(withRev("/evidence?tab=builds", 3)).toBe("/evidence?tab=builds&rev=3");
    expect(withRev("/changes#rev-2", 3)).toBe("/changes?rev=3#rev-2");
    expect(withRev("/sources?list=named#gate", 3)).toBe("/sources?list=named&rev=3#gate");
  });

  it("leaves a link that already names a revision, an external link and a bare fragment alone", () => {
    expect(withRev("/records/build/BLD-FX-01?rev=1", 3)).toBe("/records/build/BLD-FX-01?rev=1");
    expect(withRev("https://example.org/x", 3)).toBe("https://example.org/x");
    expect(withRev("//example.org/x", 3)).toBe("//example.org/x");
    expect(withRev("#purpose", 3)).toBe("#purpose");
    expect(withRev("/modules", null)).toBe("/modules");
  });

  it("accepts only a positive whole number written in digits as a revision", () => {
    expect(readRev("3")).toBe(3);
    expect(readRev(undefined)).toBe("absent");
    expect(readRev("")).toBe("absent");
    for (const bad of ["0", "-1", "1.5", "1e9", "abc", "03", " 3", "99999999999999999999"]) expect(readRev(bad), bad).toBe("invalid");
  });

  it("knows which screens always show the latest", () => {
    for (const p of ["/proposals", "/proposals/PROP-000001", "/proposals/new", "/decisions", "/changes", "/access"]) expect(isPinnablePath(p), p).toBe(false);
    for (const p of ["/", "/modules", "/modules/MOD-FX-ALPHA", "/records/source/SRC-F01", "/review", "/search", "/proposalsX"]) expect(isPinnablePath(p), p).toBe(true);
  });
});

describe("loose stored values are read through guards (ui-3)", () => {
  it("other_mentions: a null element is dropped and a non-text status is absent", () => {
    const m = otherMentions([null, { status_in_that_source: 5, statement: { text: 1 } }, "x"]);
    expect(m).toHaveLength(1);
    expect(m[0].status_in_that_source).toBeNull();
    expect(m[0].statement).toBeNull();
    expect(otherMentions("abc")).toEqual([]);
  });

  it("search_results: malformed rows and hits are dropped", () => {
    expect(searchResults([null, { term: "x", hits: "abc" }, { term: "y", hits: [{ source_id: 42, count: 1 }, { source_id: "SRC-F01", count: 2 }] }, { hits: [] }])).toEqual([
      { term: "x", hits: [] },
      { term: "y", hits: [{ source_id: "SRC-F01", count: 2 }] },
    ]);
  });

  it("code_ref, possibly_same_as and hq_checks of the wrong shape are absent", () => {
    expect(codeRef("x")).toBeNull();
    expect(codeRef({ repository: 5 })).toBeNull();
    expect(codeRef({ repository: "r", ref: "main" })).toEqual({ repository: "r", ref: "main", commit: null, path: null });
    expect(strings([123, null, "BLD-FX-01"])).toEqual(["BLD-FX-01"]);
    expect(hqChecks([null, { check: 1 }, { check: "sha", result: "ok" }])).toEqual([{ check: "sha", result: "ok" }]);
  });

  it("lifecycle_other_reports: a null entry is dropped and an unknown basis is not passed on as a label", () => {
    const r = lifecycleReports([null, { state: "yes", basis: "founder_approved" }, { state: "maybe" }]);
    expect(r).toHaveLength(1);
    expect(r[0].basis).toBeNull();
    expect(lifecycleReports("abc")).toEqual([]);
  });

  it("a citation whose locator is an object keeps its quote and loses the locator", () => {
    expect(citations([{ source_id: "SRC-F01", quote: "a quotation", locator: { evil: 1 } }, { source_id: 1, quote: "x" }, null])).toEqual([
      { source_id: "SRC-F01", quote: "a quotation", locator: null },
    ]);
    expect(claim({ text: "t", epistemic: "founder_approved", citations: [] })).toBeNull();
    expect(claim({ text: "t", epistemic: "submitter_claim" })).toEqual({ text: "t", epistemic: "submitter_claim", citations: [] });
  });

  it("formatting helpers never throw on a value that is not text", () => {
    expect(humanise(5)).toBe("—");
    expect(humanise({})).toBe("—");
    expect(isoDate(5)).toBe("—");
    expect(statusLabel(5)).toBe("—");
    expect(statusTone(5)).toBe("plain");
    expect(statusLabel("constructor")).toBe("Constructor");
  });
});
