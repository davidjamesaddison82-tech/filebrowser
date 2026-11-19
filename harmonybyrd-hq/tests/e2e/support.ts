import { expect, type Page, test as base } from "@playwright/test";

/** Passphrases set by tests/helpers/db.ts for the test database. They exist nowhere else. */
export const PASSPHRASES = {
  founder: "founder-test-passphrase",
  developer: "developer-test-passphrase",
  reader: "reader-test-passphrase",
} as const;
export type Who = keyof typeof PASSPHRASES;

/** The primary screens, with the heading each must show. */
export const SCREENS: { path: string; nav: string; h1: string }[] = [
  { path: "/", nav: "Dashboard", h1: "HarmonyByrd development" },
  { path: "/modules", nav: "Modules", h1: "Module atlas" },
  { path: "/loops", nav: "Learning loops", h1: "Learning loop explorer" },
  { path: "/requirements", nav: "Founder requirements", h1: "Founder requirements register" },
  { path: "/evidence", nav: "Development & evidence", h1: "Development and evidence register" },
  { path: "/sources", nav: "Sources", h1: "Source-access inventory" },
  { path: "/decisions", nav: "Decision centre", h1: "Founder decision centre" },
  { path: "/proposals", nav: "Proposal inbox", h1: "Proposal inbox" },
  { path: "/review", nav: "Review items", h1: "Review items" },
  { path: "/changes", nav: "Changes", h1: "Changes" },
  { path: "/access", nav: "AI & API access", h1: "AI and API access" },
];

/** Screens that always show the latest revision: a `?rev=` there is ignored, and the pin bar says so. */
export const UNPINNABLE = ["/proposals", "/decisions", "/changes", "/access"];

/** Detail screens reached from the registers (fixture ids). */
export const DETAIL_SCREENS: { path: string; h1: string }[] = [
  { path: "/modules/MOD-FX-ALPHA", h1: "Alpha (fixture)" },
  { path: "/loops/LOOP-FX-01", h1: "Pattern practice loop (fixture)" },
  { path: "/requirements/FR-FX-001", h1: "Slow tempo first" },
  { path: "/records/build/BLD-FX-01", h1: "alpha-candidate-7" },
  { path: "/records/source/SRC-F01", h1: "Fixture Document A (synthetic)" },
];

/** Fill in and submit the sign-in form. */
export async function signInThroughForm(page: Page, who: Who): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill(who);
  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASES[who]);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in")),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

type SavedCookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
const sessions = new Map<Who, SavedCookies>();

/**
 * Be signed in as `who`. The first call for each identity goes through the real form; later
 * calls reuse that session cookie, so the suite does not sign in dozens of times.
 */
export async function signIn(page: Page, who: Who): Promise<void> {
  const saved = sessions.get(who);
  if (saved) {
    await page.context().clearCookies();
    await page.context().addCookies(saved);
    await page.goto("/");
    if (!new URL(page.url()).pathname.startsWith("/sign-in")) return;
  }
  await signInThroughForm(page, who);
  sessions.set(who, await page.context().cookies());
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await Promise.all([page.waitForURL(/\/sign-in/), page.getByRole("button", { name: "Sign out" }).click()]);
}

/** The dataset revision shown in the navigation footer. */
export async function headRevision(page: Page): Promise<number> {
  const res = await page.request.get("/api/v1/tools/get_ecosystem_overview");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { revision: { rev: number } };
  return body.revision.rev;
}

/** The browser's console text for a sub-resource or document that came back with an HTTP error. */
const FAILED_RESOURCE = /Failed to load resource: the server responded with a status of (\d{3})/;

/**
 * `test` with a guard: any uncaught page error, any console error, and any response from HQ itself
 * with status 400 or above fails the test, so a screen that "works" while throwing, or while one of
 * its own requests is refused or missing, does not pass.
 *
 * A test that deliberately makes the browser load something HQ refuses (a 404 page, a 403 action)
 * says so, for exactly the statuses it expects, and asserts on the refusal itself:
 *   test.use({ allowedResourceStatuses: [404] })   // for every test in a describe block or file
 *   allowResourceStatuses(404)                      // inside one test, before the request
 * Nothing else is allowed. 5xx answers and failed requests are never allowed: the browser reports
 * them as console errors, and this guard counts every console error.
 *
 * Requests made with page.request (the API client) are not browser loads and are not watched;
 * tests that use it assert on the status directly.
 */
export const test = base.extend<{
  allowedResourceStatuses: number[];
  allowResourceStatuses: (...statuses: number[]) => void;
  allowedThisTest: Set<number>;
  problems: string[];
}>({
  allowedResourceStatuses: [[], { option: true }],
  // A fresh set per test, so one test's allowance never leaks into the next.
  allowedThisTest: async ({ allowedResourceStatuses }, use) => {
    await use(new Set(allowedResourceStatuses));
  },
  allowResourceStatuses: async ({ allowedThisTest }, use) => {
    await use((...statuses) => {
      for (const status of statuses) {
        if (status >= 500) throw new Error(`a ${status} answer is never an expected refusal`);
        allowedThisTest.add(status);
      }
    });
  },
  problems: [
    async ({ page, allowedThisTest, baseURL }, use) => {
      const problems: string[] = [];
      const allowed = (status: number) => status < 500 && allowedThisTest.has(status);
      const origin = baseURL ? new URL(baseURL).origin : null;
      page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        const status = FAILED_RESOURCE.exec(text);
        if (status && allowed(Number(status[1]))) return;
        problems.push(`console error: ${text}`);
      });
      // The console message does not name the URL; this does. Only HQ's own answers are judged here.
      page.on("response", (response) => {
        const status = response.status();
        if (status < 400 || allowed(status)) return;
        const url = new URL(response.url());
        if (origin && url.origin !== origin) return;
        problems.push(`HTTP ${status} from ${url.pathname}${url.search}`);
      });
      await use(problems);
      expect(problems, "the page must not log errors or receive unexpected refusals").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
