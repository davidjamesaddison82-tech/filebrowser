export interface CodeUnderTest {
  commit: string | null;
  dirty: boolean;
}
export function codeUnderTest(repo: string): CodeUnderTest;
export function shouldWriteResults(wanted: readonly string[]): boolean;
export function resultsText(input: { lines: readonly string[]; summary: string; code: CodeUnderTest; date: Date; count: number }): string;
