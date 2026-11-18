/**
 * Quotation rules shared by the record schemas and the pack gate.
 *
 * Kept in its own module (no Node imports) so the schemas, which are also used by the screens,
 * can apply the same minimums the pack gate applies, without pulling in the file system.
 */

/**
 * Whitespace-insensitive comparison: line wrapping in an export must not defeat verification.
 * The database's hq._norm_quote mirrors this exactly; do not change it without changing both.
 */
export function normaliseForQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A citation's quotation must still be this long once whitespace is normalised. */
export const MIN_QUOTE_CHARS = 12;

/** A requirement's exact wording must have at least this many non-whitespace characters. */
export const MIN_WORDING_NON_SPACE_CHARS = 8;

/**
 * Why a citation's quotation is too weak to verify anything, or null when it is acceptable.
 * The length is counted after normalisation, so padding a short word with spaces does not pass.
 */
export function quoteProblem(quote: string): string | null {
  const normalised = normaliseForQuote(quote);
  if (normalised === "") return "the quotation is empty once spaces and line breaks are removed";
  if (normalised.length < MIN_QUOTE_CHARS) {
    return `the quotation is too short: it needs at least ${MIN_QUOTE_CHARS} characters, not counting extra spaces and line breaks (it has ${normalised.length})`;
  }
  return null;
}

/** Why a requirement's exact wording is too weak to verify, or null when it is acceptable. */
export function wordingProblem(text: string): string | null {
  const normalised = normaliseForQuote(text);
  if (normalised === "") return "the exact wording is empty once spaces and line breaks are removed";
  const visible = normalised.replace(/\s/g, "").length;
  if (visible < MIN_WORDING_NON_SPACE_CHARS) {
    return `the exact wording is too short: it needs at least ${MIN_WORDING_NON_SPACE_CHARS} characters other than spaces (it has ${visible})`;
  }
  return null;
}
