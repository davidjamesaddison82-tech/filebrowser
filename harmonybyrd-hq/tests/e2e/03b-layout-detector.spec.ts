import type { Page } from "@playwright/test";
import { measureLayout } from "./layout-measure";
import { expect, test } from "./support";

/**
 * Self-test of the AC11 layout detector (tests-7). Each case is a small page shaped like HQ's shell
 * (side navigation, main, heading, text, a table with a sticky first column). The detector must report
 * a covering for every kind of overlay the review showed the old check missed, and nothing for the
 * clean page and the legitimate positioned elements HQ really uses.
 */
test.use({ viewport: { width: 1366, height: 768 } });

const words = "The founder's requirement is quoted here word for word so that a covering of any kind is visible. ";
const SHELL = (extraMain = "", extraNav = "", extraBody = "", cell = "") => `<!doctype html>
<html><head><style>
  body { margin: 0; font: 16px/1.5 sans-serif; }
  .shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
  aside.nav { position: sticky; top: 0; align-self: start; height: 100vh; background: #eee; }
  main { padding: 24px; background: #fff; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #ccc; padding: 4px; background: #fff; }
  td.first { position: sticky; left: 0; }
</style></head><body><div class="shell">
  <aside class="nav"><a href="#">Dashboard</a><a href="#">Modules</a>${extraNav}</aside>
  <main><h1>A screen</h1><span class="sr-only">Only for screen readers</span>
    ${Array.from({ length: 14 }, (_, i) => `<p>${i + 1}. ${words.repeat(3)}</p>`).join("")}
    <table><tr><td class="first">FR-FX-001 ${cell}</td><td>Slow tempo first</td><td>Active</td></tr></table>
    ${extraMain}
    <p>The last line of the page.</p>
  </main></div>${extraBody}</body></html>`;

async function coverings(page: Page, html: string): Promise<string[]> {
  await page.setContent(html);
  return (await measureLayout(page)).coverings;
}

test.describe("the layout detector finds what covers the content", () => {
  test("a clean page, a 1 px screen-reader element, the sticky navigation and a sticky first column pass", async ({ page }) => {
    expect(await coverings(page, SHELL())).toEqual([]);
  });

  test("(a) an absolutely positioned overlay over most of the content, clear of the heading and the end", async ({ page }) => {
    const found = await coverings(page, SHELL(`<div style="position:absolute; left:300px; top:150px; width:1000px; height:540px; background:#fff; z-index:9">Overlay</div>`));
    expect(found.join("\n")).toMatch(/div \(absolute/);
  });

  test("(b) a fixed bar 85 px high across the middle of the window", async ({ page }) => {
    const found = await coverings(page, SHELL("", "", `<div style="position:fixed; left:0; top:340px; width:1366px; height:85px; background:#ffd">Banner</div>`));
    expect(found.join("\n")).toMatch(/div \(fixed, 1366×85/);
  });

  test("a fixed bar of any size that covers text, here 24 px high", async ({ page }) => {
    const found = await coverings(page, SHELL("", "", `<div style="position:fixed; left:260px; top:200px; width:600px; height:24px; background:#000; color:#fff">Cookie notice</div>`));
    expect(found.join("\n")).toMatch(/div \(fixed, 600×24.*drawn over the text/);
  });

  test("(c) a fixed overlay rendered inside the navigation but drawn over the content", async ({ page }) => {
    const found = await coverings(page, SHELL("", `<div class="menu-sheet" style="position:fixed; left:230px; top:100px; width:1136px; height:600px; background:#fff">Menu</div>`));
    expect(found.join("\n")).toMatch(/div\.menu-sheet/);
  });

  test("(d) a fixed overlay rendered inside a table cell", async ({ page }) => {
    const found = await coverings(page, SHELL("", "", "", `<div class="cell-pop" style="position:fixed; left:300px; top:120px; width:900px; height:500px; background:#fff">Details</div>`));
    expect(found.join("\n")).toMatch(/div\.cell-pop/);
  });

  test("an overlay that lets clicks through (pointer-events: none) is still found", async ({ page }) => {
    const found = await coverings(page, SHELL("", "", `<div style="position:fixed; left:300px; top:200px; width:500px; height:200px; background:#fff; pointer-events:none">Watermark</div>`));
    expect(found.join("\n")).toMatch(/div \(fixed, 500×200/);
  });

  test("an overlay with no text under it is found by its size over the content", async ({ page }) => {
    const found = await coverings(page, SHELL("", "", `<div style="position:fixed; right:0; top:0; width:400px; height:768px; background:transparent"></div>`));
    expect(found.length).toBeGreaterThan(0);
  });

  test("a box that escapes a sticky table cell and covers text is found", async ({ page }) => {
    const html = SHELL().replace("td.first { position: sticky; left: 0; }", "td.first { position: sticky; left: 0; } td.first span { position: absolute; left: 0; top: -300px; width: 700px; height: 200px; background: #fff; }").replace("FR-FX-001 ", 'FR-FX-001 <span class="escape">x</span>');
    const found = await coverings(page, html);
    expect(found.join("\n")).toMatch(/span\.escape/);
  });
});
