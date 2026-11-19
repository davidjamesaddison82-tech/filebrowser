import type pg from "pg";
import { describe, expect, it } from "vitest";
import { MAX_PASSPHRASE_LENGTH } from "@/lib/auth/sign-in-input";
import { verifyPassphrase } from "@/lib/auth/secrets";
import { setPassphrase } from "../../scripts/lib/principals";

/**
 * G11c: a passphrase that could never be used cannot be set. Sign-in refuses a passphrase longer than
 * MAX_PASSPHRASE_LENGTH before any work (G7), so setting one would lock its person out for good.
 * setPassphrase is the only place a passphrase is set (npm run setup, scripts/credentials.ts, the test harness).
 */
function recordingClient() {
  const queries: unknown[][] = [];
  const client = { query: async (...args: unknown[]) => (queries.push(args), { rows: [], rowCount: 1 }) } as unknown as pg.Client;
  return { client, queries };
}

describe("a passphrase longer than sign-in accepts cannot be set (G11c)", () => {
  it("one character over the limit is refused with a plain message, and nothing is written", async () => {
    const { client, queries } = recordingClient();
    const long = "a".repeat(MAX_PASSPHRASE_LENGTH + 1);
    await expect(setPassphrase(client, "00000000-0000-0000-0000-000000000000", long)).rejects.toThrow(
      `A passphrase can be at most ${MAX_PASSPHRASE_LENGTH} characters long (this one has ${MAX_PASSPHRASE_LENGTH + 1}). Sign-in refuses a longer one, so it could never be used.`,
    );
    expect(queries).toEqual([]);
  });

  it("a passphrase of exactly the limit is set, and verifies", async () => {
    const { client, queries } = recordingClient();
    const longest = "b".repeat(MAX_PASSPHRASE_LENGTH);
    await setPassphrase(client, "00000000-0000-0000-0000-000000000000", longest);
    expect(queries).toHaveLength(1);
    const hash = (queries[0][1] as string[])[1];
    expect(verifyPassphrase(longest, hash)).toBe(true);
  });
});
