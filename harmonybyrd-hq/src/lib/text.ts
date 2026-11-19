/**
 * Text that HQ echoes or stores from a client (ROUND5 K8).
 *
 * A JavaScript string can hold a lone UTF-16 surrogate ("\ud83d"), which is not a character. PostgreSQL's
 * jsonb refuses one, and a strict UTF-8 reader may refuse an answer that carries one, so whatever HQ echoes
 * in an answer or writes into the audit log is first made well formed: each lone surrogate becomes U+FFFD
 * (the replacement character). A cut is made on whole characters (code points), never inside a pair.
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The string with every lone surrogate replaced by U+FFFD (what String.prototype.toWellFormed does). */
export function wellFormed(value: string): string {
  return value.replace(LONE_SURROGATE, "�");
}

/** At most `max` characters (code points) of a value as text, well formed. */
export function cutText(value: unknown, max: number): string {
  const text = wellFormed(String(value));
  // Fast path: a string of at most `max` UTF-16 units has at most `max` code points.
  if (text.length <= max) return text;
  let out = "";
  let count = 0;
  for (const ch of text) {
    if (count === max) break;
    out += ch;
    count += 1;
  }
  return out;
}

/**
 * JSON text in which every string (keys included) is well formed. JSON.stringify writes a lone surrogate as
 * an escape ("\ud83d") and a paired one as the character itself, so every surrogate escape in its output is
 * a lone one; each becomes the escape of U+FFFD. An escaped backslash before "u" is left alone.
 */
export function wellFormedJson(value: unknown): string | undefined {
  const text = JSON.stringify(value);
  if (text === undefined) return undefined;
  return text.replace(/\\\\|\\u[dD][89a-fA-F][0-9a-fA-F]{2}/g, (m) => (m === "\\\\" ? m : "\\ufffd"));
}
