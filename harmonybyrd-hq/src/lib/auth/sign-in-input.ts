/**
 * Limits on what the sign-in form may send (G7). A server action accepts a body of about 1 MB, and the
 * name the client typed was kept as a throttle lane key, so long names could fill the server's memory.
 * A name or passphrase over these limits is answered with the usual "do not match" at once: no lane, no
 * database look-up, no passphrase check, no device-cookie check. No real sign-in can be over them.
 */

/** The longest handle hq.principals allows: its check is '^[a-z0-9][a-z0-9_-]{1,40}$' (migration 0001). */
export const MAX_HANDLE_LENGTH = 41;
/** Far longer than any passphrase a person types or a password manager makes. */
export const MAX_PASSPHRASE_LENGTH = 1024;

export interface TooLong {
  field: "name" | "passphrase";
  /** Length in characters (UTF-16 code units). The value itself is never kept or logged. */
  length: number;
}

/**
 * Which input is over its limit, if any: the name (as trimmed; lower-casing can lengthen it, so it is
 * measured both ways, the second only once the first is short) first, then the passphrase.
 */
export function tooLongSignInInput(handle: string, passphrase: string): TooLong | null {
  if (handle.length > MAX_HANDLE_LENGTH || handle.toLowerCase().length > MAX_HANDLE_LENGTH) return { field: "name", length: handle.length };
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) return { field: "passphrase", length: passphrase.length };
  return null;
}
