import type { Page } from "@playwright/test";
import { expect, PASSPHRASES, signIn, signInThroughForm, test } from "./support";

/** Submit one sign-in attempt and return how long the server took to answer it, in ms. */
async function timedAttempt(page: Page, name: string, passphrase: string): Promise<number> {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  const started = Date.now();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/sign-in"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  const elapsed = Date.now() - started;
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  return elapsed;
}

test.describe("signing in", () => {
  test("a signed-out visitor is sent to sign-in and sees no records", async ({ page }) => {
    for (const path of ["/", "/modules", "/modules/MOD-FX-ALPHA", "/requirements/FR-FX-001", "/access"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
      await expect(page.getByText("Alpha (fixture)")).toHaveCount(0);
    }
  });

  test("the API refuses a request with no identity", async ({ request }) => {
    const res = await request.get("/api/v1/tools/get_ecosystem_overview");
    expect(res.status()).toBe(401);
  });

  test("a wrong passphrase is refused without saying which part was wrong", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Name", { exact: true }).fill("founder");
    await page.getByLabel("Passphrase", { exact: true }).fill("not-the-passphrase");
    await page.getByRole("button", { name: "Sign in" }).click();
    const alert = page.getByRole("alert").filter({ hasText: /./ });
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/passphrase is wrong|unknown name|no such user/i);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("the founder signs in, reaches the dashboard and signs out again", async ({ page }) => {
    await signInThroughForm(page, "founder");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("HarmonyByrd development");
    await expect(page.getByText("Founder · signed in")).toBeVisible();
    await Promise.all([page.waitForURL(/\/sign-in/), page.getByRole("button", { name: "Sign out" }).click()]);
    await page.goto("/modules");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  // D8, F5: a growing delay per name instead of a lock-out. The test server uses a 200 ms base delay
  // (HQ_SIGNIN_BASE_DELAY_MS, honoured only on a test server); production waits 500 ms, doubling to 8 s.
  // Each attempt waits on its own (attempts no longer queue); one after another, as here, the waits are
  // the same as before. Parallel floods and the caps are tested over HTTP in tests/api/sign-in.test.ts.
  test("wrong passphrases slow that name down, but never lock out the right passphrase", async ({ page }) => {
    await page.goto("/sign-in");
    const alert = page.getByRole("alert").filter({ hasText: /./ });
    const durations: number[] = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      durations.push(await timedAttempt(page, "developer", `wrong-${attempt}`));
      await expect(alert).toContainText("That name and passphrase do not match.");
      await expect(alert).not.toContainText("Too many attempts");
    }
    const free = Math.max(...durations.slice(0, 5));
    // Attempts 6, 7 and 8 wait 200, 400 and 800 ms before they are checked.
    expect(durations[7]).toBeGreaterThanOrEqual(750);
    expect(durations[7] - free).toBeGreaterThanOrEqual(500);
    expect(durations[7]).toBeGreaterThan(durations[5]);
    // The ninth attempt, with the right passphrase, waits 1.6 s and then signs in.
    const started = Date.now();
    await page.getByLabel("Name", { exact: true }).fill("developer");
    await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASES.developer);
    await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/sign-in")), page.getByRole("button", { name: "Sign in" }).click()]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    await expect(page.getByText("Developer · signed in")).toBeVisible();
  });

  test("a different X-Forwarded-For on every attempt does not reset the delay, and other names are unaffected", async ({ page }) => {
    await page.goto("/sign-in");
    const durations: number[] = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.0.0.${attempt}` });
      durations.push(await timedAttempt(page, "nobody-at-all", `wrong-${attempt}`));
    }
    expect(durations[7]).toBeGreaterThanOrEqual(750);
    expect(durations[7] - Math.max(...durations.slice(0, 5))).toBeGreaterThanOrEqual(500);
    // Spoofing the founder's own address does not touch the founder either: the delay is per name.
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "127.0.0.1" });
    const started = Date.now();
    await signInThroughForm(page, "reader");
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(page.getByText("Reader · signed in")).toBeVisible();
  });

  // F5: changed in the second round. A browser that has signed in before carries a device cookie and has
  // a lane of its own, so wrong attempts from another browser do not slow it down; signing out keeps it.
  test("a browser that signed in before is not slowed by wrong attempts from elsewhere, and keeps its device cookie after sign-out", async ({ page, browser }) => {
    await signInThroughForm(page, "developer");
    const names = async () => (await page.context().cookies()).map((c) => c.name).sort();
    expect(await names()).toEqual(["hq_device", "hq_session"]);
    const device = (await page.context().cookies()).find((c) => c.name === "hq_device")!;
    expect(device.httpOnly).toBe(true);
    expect(device.sameSite).toBe("Lax");
    await Promise.all([page.waitForURL(/\/sign-in/), page.getByRole("button", { name: "Sign out" }).click()]);
    // Signed out: the session cookie is gone, the device cookie stays, and it opens nothing.
    expect(await names()).toEqual(["hq_device"]);
    await page.goto("/decisions");
    await expect(page).toHaveURL(/\/sign-in/);

    const elsewhere = await browser.newContext();
    try {
      const other = await elsewhere.newPage();
      await other.goto("/sign-in");
      for (let attempt = 1; attempt <= 8; attempt += 1) await timedAttempt(other, "developer", `wrong-elsewhere-${attempt}`);
      // That browser's next attempt waits 1.6 s (eight failures in the name's lane) ...
      expect(await timedAttempt(other, "developer", "wrong-elsewhere-9")).toBeGreaterThanOrEqual(1500);
      // ... while the browser that signed in before signs in without waiting.
      const started = Date.now();
      await signInThroughForm(page, "developer");
      expect(Date.now() - started).toBeLessThan(1500);
      await expect(page.getByText("Developer · signed in")).toBeVisible();
    } finally {
      await elsewhere.close();
    }
  });

  // G7 (round 3): a name or passphrase over its limit is answered at once with the usual message, and
  // never reaches the name's lane: the ordinary attempts after it start from no failures.
  test("an over-long name or passphrase gets the usual message at once, and does not count against the name", async ({ page }) => {
    await page.goto("/sign-in");
    const alert = page.getByRole("alert").filter({ hasText: /./ });
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      expect(await timedAttempt(page, "reader", `${"p".repeat(2000)}${attempt}`)).toBeLessThan(1500);
      await expect(alert).toContainText("That name and passphrase do not match.");
    }
    expect(await timedAttempt(page, "n".repeat(5000), "anything")).toBeLessThan(1500);
    await expect(alert).toContainText("That name and passphrase do not match.");
    // Eight over-long attempts for "reader" were not failures in its lane, so the right passphrase waits
    // for nothing (eight failures would make it wait 1.6 s).
    const started = Date.now();
    await signInThroughForm(page, "reader");
    expect(Date.now() - started).toBeLessThan(1200);
    await expect(page.getByText("Reader · signed in")).toBeVisible();
  });

  for (const next of ["/%09/evil.example/", "/.%2F%2Fevil.example", "/%5Cevil.example", "/%0a/evil.example/"]) {
    test(`signing in with next=${next} stays on HQ`, async ({ page, baseURL }) => {
      const offSite: string[] = [];
      // Match the host, not the text: the sign-in URL itself carries "evil.example" in its query.
      const offSiteHost = (url: URL | string) => new URL(url).hostname.endsWith("evil.example");
      await page.route(offSiteHost, (route) => {
        offSite.push(route.request().url());
        return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Session expired</title>" });
      });
      page.on("request", (request) => {
        if (offSiteHost(request.url())) offSite.push(request.url());
      });
      await page.goto(`/sign-in?next=${next}`);
      await expect(page.locator('input[name="next"]')).toHaveValue("/");
      await page.getByLabel("Name", { exact: true }).fill("reader");
      await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASES.reader);
      await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/sign-in")), page.getByRole("button", { name: "Sign in" }).click()]);
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
      expect(offSite).toEqual([]);
      await expect(page.getByText("Reader · signed in")).toBeVisible();
    });
  }

  test("a safe next is still followed after sign-in", async ({ page }) => {
    await page.goto("/sign-in?next=%2Frequirements%3Fq%3Dtempo");
    await page.getByLabel("Name", { exact: true }).fill("reader");
    await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASES.reader);
    await Promise.all([page.waitForURL(/\/requirements/), page.getByRole("button", { name: "Sign in" }).click()]);
    expect(new URL(page.url()).pathname).toBe("/requirements");
  });

  test("signing out ends the session for every copy of the cookie and every browser (api-5)", async ({ page, browser, request }) => {
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    try {
      await signInThroughForm(otherPage, "founder");
      await signInThroughForm(page, "founder");
      const cookie = (await page.context().cookies()).find((c) => c.name === "hq_session")!;
      expect(cookie).toBeDefined();
      const replay = { headers: { cookie: `hq_session=${cookie.value}` } };
      expect((await request.get("/api/v1/whoami", replay)).status()).toBe(200);

      await Promise.all([page.waitForURL(/\/sign-in/), page.getByRole("button", { name: "Sign out" }).click()]);

      const whoami = await request.get("/api/v1/whoami", replay);
      expect(whoami.status()).toBe(401);
      const decisions = await request.get("/decisions", { ...replay, maxRedirects: 0 });
      expect(decisions.status()).not.toBe(200);
      await otherPage.goto("/decisions");
      await expect(otherPage).toHaveURL(/\/sign-in/);

      // A fresh sign-in still works.
      await signInThroughForm(page, "founder");
      await expect(page.getByText("Founder · signed in")).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test("every screen says it is a prototype and that the fixture is not real data", async ({ page }) => {
    await signIn(page, "founder");
    for (const path of ["/", "/modules/MOD-FX-ALPHA", "/requirements", "/access"]) {
      await page.goto(path);
      const banner = page.getByRole("note").first();
      await expect(banner).toContainText("PROTOTYPE — NOT AN AUTHORITATIVE RECORD");
      await expect(banner).toContainText("SYNTHETIC FIXTURE DATA LOADED");
    }
  });
});
