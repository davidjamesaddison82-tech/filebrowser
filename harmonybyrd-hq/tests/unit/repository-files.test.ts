/**
 * G4 — every file the application needs is in the repository.
 *
 * The repository HQ sits in ignores *.mjs, so next.config.mjs (the response headers) and the mutation
 * runner were never committed and a clone lacked them. This lists every file git ignores under this
 * folder and fails on anything outside what is meant to stay local. It is skipped, saying why, where
 * git is not available or the folder is not in a git work tree (the source archive).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");

/** Folders whose whole content is meant to be ignored (paths relative to this folder, "/"-separated). */
const IGNORED_FOLDERS = ["node_modules/", ".next/", "test-results/", "playwright-report/", ".local/", "private/", "tests/mutation/mut/"];
/** Single local files that are meant to be ignored, at any depth. */
const IGNORED_NAMES = [".env.local", ".env", ".hq-local-credentials.json", "next-env.d.ts"];

/** Whether git is meant to ignore this path. Pure, so the rule itself is tested below. */
function meantToBeIgnored(file: string): boolean {
  if (IGNORED_FOLDERS.some((folder) => file.startsWith(folder))) return true;
  // data/packs/* except the synthetic fixture: the real evidence pack never enters the repository.
  if (file.startsWith("data/packs/") && !file.startsWith("data/packs/fixture/")) return true;
  const name = file.split("/").pop() ?? "";
  return IGNORED_NAMES.includes(name) || name.endsWith(".tsbuildinfo");
}

function git(args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

const probe = git(["rev-parse", "--is-inside-work-tree"]);
const inWorkTree = !probe.error && probe.status === 0 && probe.stdout.trim() === "true";
if (!inWorkTree) {
  console.warn(`repository-files: skipped — ${probe.error ? "git is not available" : "this folder is not inside a git work tree (for example, the source archive)"}.`);
}

describe("G4 — git ignores nothing the application needs", () => {
  it("the rule: what is meant to be ignored, and what is not", () => {
    for (const file of ["node_modules/x/index.js", ".next/server/app.js", "private/notes.md", "data/packs/harmonybyrd-evidence/manifest.json", ".env.local", "tsconfig.tsbuildinfo", "tests/mutation/mut/m01.sql"]) {
      expect(meantToBeIgnored(file), file).toBe(true);
    }
    for (const file of ["next.config.mjs", "tests/mutation/run.mjs", "tests/mutation/vitest.mut.config.mjs", "data/packs/fixture/manifest.json", "src/app/page.tsx", "tests/mutation/RESULTS.txt"]) {
      expect(meantToBeIgnored(file), file).toBe(false);
    }
  });

  /** Files under this folder that the ignore rules match, relative to this folder. */
  const ignoredBy = (args: string[]) => {
    const result = git(["ls-files", "--ignored", "--exclude-standard", "--full-name", "-z", ...args, "--", "."]);
    expect(result.status, result.stderr).toBe(0);
    const prefix = git(["rev-parse", "--show-prefix"]).stdout.trim();
    return result.stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => (file.startsWith(prefix) ? file.slice(prefix.length) : file));
  };

  it.skipIf(!inWorkTree)("git ls-files --others --ignored --exclude-standard lists nothing outside the folders and files meant to stay local", () => {
    // --directory reports an ignored folder once instead of every file in it (node_modules is large).
    expect(ignoredBy(["--others", "--directory"]).filter((file) => !meantToBeIgnored(file))).toEqual([]);
  });

  it.skipIf(!inWorkTree)("no committed file matches an ignore rule either (a clone made from a fresh checkout would keep it, but a new copy of it would be left out)", () => {
    expect(ignoredBy(["--cached"]).filter((file) => !meantToBeIgnored(file))).toEqual([]);
  });

  it.skipIf(!inWorkTree)("the files the parent repository's *.mjs rule used to hide are not ignored", () => {
    for (const file of ["next.config.mjs", "tests/mutation/run.mjs", "tests/mutation/vitest.mut.config.mjs"]) {
      // --no-index: ask the ignore rules themselves, whether or not the file is already committed.
      expect(git(["check-ignore", "--no-index", "-q", file]).status, file).toBe(1);
    }
  });
});
