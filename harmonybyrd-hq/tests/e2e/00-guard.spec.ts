import type { Page } from "@playwright/test";
import { expect, test } from "./support";

/**
 * Self-test of the browser guard in support.ts (tests-8). Every other browser test relies on it to
 * fail a screen whose own requests are refused, missing or broken, so it is proven here on pages
 * served by page.route (no server involved):
 *   - a test marked test.fail() passes only if the guard fails it;
 *   - the other tests show the guard lets through exactly the refusals a test declares, and no more.
 */
const PAGE = "/__guard/page";

/** Serve a page that loads one image and makes one fetch, each answered with the given status. */
async function servePage(page: Page, status: number | "abort"): Promise<void> {
  await page.route("**/__guard/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === PAGE) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><main><h1>Guard</h1><img alt="" src="/__guard/picture.png"><p id="out">waiting</p></main>
<script>fetch("/__guard/data").then((r) => { document.getElementById("out").textContent = "fetched " + r.status; },
  () => { document.getElementById("out").textContent = "fetch failed"; });</script></body></html>`,
      });
      return;
    }
    if (status === "abort") await route.abort("connectionrefused");
    else await route.fulfill({ status, contentType: "text/plain", body: "refused" });
  });
}

async function load(page: Page, status: number | "abort"): Promise<void> {
  await servePage(page, status);
  await page.goto(PAGE);
  await expect(page.locator("#out")).not.toHaveText("waiting");
  // Give the image request time to finish as well.
  await page.waitForLoadState("load");
}

test.describe("the guard fails a test whose page is refused something it did not expect", () => {
  for (const status of [401, 403, 404, 409, 422]) {
    test(`an unexpected ${status} on a fetch and an image fails the test`, async ({ page }) => {
      test.fail(true, "the guard must fail this test");
      await load(page, status);
    });
  }

  test("a 500 fails the test", async ({ page }) => {
    test.fail(true, "the guard must fail this test");
    await load(page, 500);
  });

  test("a failed request fails the test", async ({ page }) => {
    test.fail(true, "the guard must fail this test");
    await load(page, "abort");
  });

  test("an uncaught page error fails the test", async ({ page }) => {
    test.fail(true, "the guard must fail this test");
    await page.route("**/__guard/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><main><h1>x</h1></main><script>throw new Error('boom')</script>" }),
    );
    await page.goto(PAGE);
  });

  test("a 500 can never be declared as expected", async ({ allowResourceStatuses }) => {
    test.fail(true, "declaring a 5xx as expected must be refused");
    allowResourceStatuses(500);
  });
});

test.describe("a test that declares an expected refusal", () => {
  test.use({ allowedResourceStatuses: [403] });

  test("passes when exactly that refusal happens", async ({ page }) => {
    await load(page, 403);
    await expect(page.locator("#out")).toHaveText("fetched 403");
  });

  test("still fails on a different refusal", async ({ page }) => {
    test.fail(true, "only the declared status is allowed");
    await load(page, 404);
  });
});

test.describe("an expected refusal declared inside one test", () => {
  test("passes when that refusal happens", async ({ page, allowResourceStatuses }) => {
    allowResourceStatuses(404);
    await load(page, 404);
    await expect(page.locator("#out")).toHaveText("fetched 404");
  });

  test("does not carry over to the next test", async ({ page }) => {
    test.fail(true, "the previous test's allowance must not leak");
    await load(page, 404);
  });

  test("a page with no refusals passes", async ({ page }) => {
    await load(page, 200);
    await expect(page.locator("#out")).toHaveText("fetched 200");
  });
});
