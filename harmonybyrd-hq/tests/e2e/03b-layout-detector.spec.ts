import type { Page } from "@playwright/test";
import { coveringsTopAndEnd, measureLayout } from "./layout-measure";
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

/** Coverings at the top of the page and scrolled to its end, as 03-layout measures every screen. */
async function coveringsAnywhere(page: Page, html: string): Promise<string[]> {
  await page.setContent(html);
  const { top, end } = await coveringsTopAndEnd(page);
  return [...top.coverings, ...end.coverings];
}

/** Paragraphs that are on screen but not what the browser shows at their first line (what a reader cannot see). */
async function hiddenParagraphs(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("main p")).filter((p) => {
      const r = p.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return false;
      const shown = document.elementFromPoint(r.left + 200, r.top + 8);
      return !!shown && !p.contains(shown);
    }).length,
  );
}

test.describe("the layout detector finds shifted blocks and pseudo-element overlays (F11)", () => {
  const cases: { name: string; main?: string; css?: string; expected: RegExp }[] = [
    {
      name: "a position: relative block with a z-index moved over earlier paragraphs (top: -500px)",
      main: `<div class="shifted" style="position:relative; top:-500px; z-index:5; height:400px; background:#fff">Shifted</div>`,
      expected: /div\.shifted \(relative\) is drawn over the text/,
    },
    {
      name: "a statically positioned block moved with transform: translateY(-500px)",
      main: `<div class="moved" style="transform:translateY(-500px); height:400px; background:#fff">Moved</div>`,
      expected: /div\.moved \(static, transformed\) is drawn over the text/,
    },
    {
      name: "a fixed overlay drawn by body::before",
      css: `body::before { content: ""; position: fixed; left: 300px; top: 100px; width: 900px; height: 500px; background: #fff; z-index: 99; }`,
      expected: /body::before \(fixed, 900×500 at 300,100\) is drawn over the text/,
    },
    {
      name: "a fixed overlay drawn by main::after",
      css: `main::after { content: ""; position: fixed; left: 300px; top: 100px; width: 900px; height: 500px; background: #fff; z-index: 99; }`,
      expected: /main::after \(fixed, 900×500 at 300,100\) is drawn over the text/,
    },
  ];
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      const html = SHELL(c.main ?? "").replace("</style>", `${c.css ?? ""}</style>`);
      // The overlay really hides text: at the top or at the end of the page, paragraphs a reader would
      // see are not what the browser shows.
      await page.setContent(html);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const atEnd = await hiddenParagraphs(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(atEnd + (await hiddenParagraphs(page)), "the overlay hides paragraphs").toBeGreaterThan(0);
      expect((await coveringsAnywhere(page, html)).join("\n")).toMatch(c.expected);
    });
  }

  test("clean controls: a decorative pseudo-element, a raised badge, a transform that moves nothing and a closed quotation report nothing", async ({ page }) => {
    const html = SHELL(
      `<details class="cites"><summary>1 source quotation</summary><div class="cite">${words.repeat(4)}</div></details>
       <p>The line after a closed quotation, where its hidden text would lie.</p>
       <p><span style="position:relative; z-index:2; top:1px; background:#eef">badge</span> beside its text, and
        <span style="display:inline-block; transform:translateY(-1px)">a nudged word</span>.</p>
       <div style="transform:translateX(0); background:#fafafa">A transformed block that stays in place.</div>`,
    ).replace(
      "</style>",
      `main::before { content: ""; display: block; height: 4px; background: #48f; }
       h1::after { content: " ·"; color: #888; }
       .shell::after { content: ""; position: fixed; left: 0; bottom: 0; width: 240px; height: 2px; background: #48f; }</style>`,
    );
    expect(await coveringsAnywhere(page, html)).toEqual([]);
    expect(await coveringsAnywhere(page, SHELL())).toEqual([]);
  });
});

/**
 * Sideways scroll on a phone (F10). A mobile browser widens window.innerWidth to fit content that
 * overflows, so a measure against innerWidth always reads 0. The detector must measure against the
 * layout viewport (documentElement.clientWidth) and the page's width against the screen's.
 */
const PHONE_PAGE = (extra = "") => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body { margin: 0; font: 16px/1.5 sans-serif; }
  main { padding: 16px; }
  .chip { display: inline-flex; max-width: 100%; white-space: nowrap; font-size: 12px; padding: 2px 8px; border: 1px solid #c90; }
</style></head><body>
  <main><h1>Review items</h1><p>${words.repeat(2)}</p>${extra}<p>The last line of the page.</p></main>
</body></html>`;

test.describe("the layout detector sees sideways scroll on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a clean phone page does not scroll sideways", async ({ page }) => {
    await page.setContent(PHONE_PAGE(`<span class="chip">Short label</span>`));
    const m = await measureLayout(page);
    expect(m.sidewaysScroll).toBeLessThanOrEqual(1);
    expect(m.scrollWidth).toBeLessThanOrEqual(391);
  });

  test("a nowrap label wider than the screen is reported at 390 px", async ({ page }) => {
    await page.setContent(PHONE_PAGE(`<div><span class="chip">${"Acceptance claimed without an acceptance instrument on record ".repeat(2).trim()}</span></div>`));
    const m = await measureLayout(page);
    // What the old measure saw: the browser widened its window to fit, so innerWidth gave nothing.
    const innerWidthDifference = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(innerWidthDifference, "the browser widens innerWidth to fit the overflow").toBeLessThanOrEqual(1);
    expect(m.sidewaysScroll, "sideways scroll against the layout viewport").toBeGreaterThan(1);
    expect(m.scrollWidth, "page width against the 390 px screen").toBeGreaterThan(391);
  });
});
