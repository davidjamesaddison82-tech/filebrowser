/**
 * L9: tests/mutation/RESULTS.txt says which code it ran against. A full run writes, as its first line,
 * the commit (and whether the working tree had uncommitted changes), the date and the number of
 * mutations; a run of named mutations writes no file.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeUnderTest, resultsText, shouldWriteResults } from "../mutation/results-file.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const sample = { lines: ["noop (control, no mutation) → none fail; 10 tests pass", "m01 → 2: db › x"], summary: "1 mutation(s) run: 1 caught." };

describe("RESULTS.txt names the code it ran against (L9)", () => {
  it("the first line gives the commit, the date and the number of mutations", () => {
    const text = resultsText({ ...sample, code: { commit: "a".repeat(40), dirty: false }, date: new Date("2026-11-19T10:00:00Z"), count: 1 });
    const first = text.split("\n")[0];
    expect(first).toBe(`Run on commit ${"a".repeat(40)}, 2026-11-19, 1 mutation.`);
    expect(text).toContain(sample.lines[1]);
    expect(text).toContain(sample.summary);
  });

  it("says when the working tree had uncommitted changes", () => {
    const first = resultsText({ ...sample, code: { commit: "b".repeat(40), dirty: true }, date: new Date("2026-11-19T23:59:00Z"), count: 97 }).split("\n")[0];
    expect(first).toBe(`Run on commit ${"b".repeat(40)} with uncommitted changes, 2026-11-19, 97 mutations.`);
  });

  it("reads the commit and the state of the working tree from git", () => {
    const code = codeUnderTest(repo);
    let head: string | null = null;
    try {
      head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    } catch {
      /* not a git work tree: codeUnderTest says so */
    }
    if (head === null) {
      expect(code.commit).toBeNull();
      return;
    }
    expect(code.commit).toBe(head);
    const clean = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim() === "";
    expect(code.dirty).toBe(!clean);
  });

  it("without git, the first line says the commit is not known", () => {
    const first = resultsText({ ...sample, code: { commit: null, dirty: false }, date: new Date("2026-11-19T10:00:00Z"), count: 2 }).split("\n")[0];
    expect(first).toBe("Run on an unknown commit (git could not be asked), 2026-11-19, 2 mutations.");
  });

  it("only a full run writes the file", () => {
    expect(shouldWriteResults([])).toBe(true);
    expect(shouldWriteResults(["m01_founder_role"])).toBe(false);
    expect(shouldWriteResults(["noop"])).toBe(false);
  });
});
