import { expect, signIn, signInThroughForm, test } from "./support";

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

  test("repeated wrong passphrases are throttled, and the lock does not spread to other names", async ({ page }) => {
    await page.goto("/sign-in");
    const alert = page.getByRole("alert").filter({ hasText: /./ });
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await page.getByLabel("Name", { exact: true }).fill("nobody-at-all");
      await page.getByLabel("Passphrase", { exact: true }).fill(`wrong-${attempt}`);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(alert).toContainText("do not match");
      await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    }
    await page.getByLabel("Name", { exact: true }).fill("nobody-at-all");
    await page.getByLabel("Passphrase", { exact: true }).fill("wrong-9");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(alert).toContainText("Too many attempts");
    // A different name is unaffected.
    await signInThroughForm(page, "reader");
    await expect(page.getByText("Reader · signed in")).toBeVisible();
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
