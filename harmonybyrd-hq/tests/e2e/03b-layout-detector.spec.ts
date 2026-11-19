import type { Page } from "@playwright/test";
import { coveringsTopAndEnd, measureLayout, middlePositions, stickyPositions } from "./layout-measure";
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

/** Coverings at the top of the page, part-way down and scrolled to its end, as 03-layout measures every screen. */
async function coveringsAnywhere(page: Page, html: string): Promise<string[]> {
  await page.setContent(html);
  return (await coveringsTopAndEnd(page)).coverings;
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
 * Part-way down a long page, and elements the browser does not draw (round 3, G6). A page of 40
 * paragraphs is about six windows long at 1366 × 768; what covers text only in its middle is on screen
 * neither at the top nor at the end. And an element at opacity 0, or cut away entirely by a clip-path,
 * is hit by the browser's hit test but draws nothing: it hides nothing, so it is not a covering.
 */
const LONG_SHELL = (mid: string, paragraphs = 40) =>
  SHELL().replace(/<p>1\. [\s\S]*?(<table>)/, `${Array.from({ length: paragraphs }, (_, i) => `<p>${i + 1}. ${words.repeat(3)}</p>${i === Math.floor(paragraphs / 2) ? mid : ""}`).join("")}$1`);

/** Hidden paragraphs at the worst scroll position, and at the top and the end only. */
async function hiddenAlongThePage(page: Page): Promise<{ anywhere: number; atTheEnds: number }> {
  const positions = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return Array.from({ length: 41 }, (_, i) => Math.round((max * i) / 40));
  });
  let anywhere = 0;
  let atTheEnds = 0;
  for (const [i, y] of positions.entries()) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    const hidden = await hiddenParagraphs(page);
    anywhere = Math.max(anywhere, hidden);
    if (i === 0 || i === positions.length - 1) atTheEnds = Math.max(atTheEnds, hidden);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return { anywhere, atTheEnds };
}

/** Whether the browser's plain hit test answers an element matching `selector` somewhere over the text of main. */
async function hitTestFinds(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const target = document.querySelector(sel);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    for (let y = 0; y <= max + 1; y += 200) {
      window.scrollTo(0, y);
      for (let py = 10; py < window.innerHeight; py += 20) {
        for (let px = 260; px < window.innerWidth; px += 40) {
          const hit = document.elementFromPoint(px, py);
          if (target && hit && (hit === target || target.contains(hit))) return true;
        }
      }
    }
    return false;
  }, selector);
}

test.describe("the layout detector looks part-way down a long page and ignores what is not drawn (G6)", () => {
  test("the scroll positions: one every 0.8 window heights, at most ten, evenly spread on a longer page", () => {
    expect(middlePositions(0, 768)).toEqual([]);
    expect(middlePositions(600, 768), "a page shorter than one step needs none").toEqual([]);
    expect(middlePositions(2000, 768)).toEqual([614, 1228, 1842]);
    const long = middlePositions(100_000, 768);
    expect(long).toHaveLength(10);
    expect(long[0]).toBeGreaterThan(0);
    expect(long[9]).toBeLessThan(100_000);
    const gaps = long.slice(1).map((y, i) => y - long[i]);
    expect(Math.max(...gaps) - Math.min(...gaps), "evenly spread").toBeLessThanOrEqual(1);
  });

  test("a sticky block in a section in the middle of a 40-paragraph page is reported, and says where", async ({ page }) => {
    const html = LONG_SHELL(
      `<section><div class="sticky-mid" style="position:sticky; top:300px; height:150px; background:#fff; z-index:5">Sticky mid</div>${Array.from({ length: 8 }, () => `<p>${words.repeat(3)}</p>`).join("")}</section>`,
    );
    await page.setContent(html);
    const hidden = await hiddenAlongThePage(page);
    expect(hidden.anywhere, "part-way down, it hides paragraphs").toBeGreaterThan(0);
    expect(hidden.atTheEnds, "at the top and at the end it hides nothing").toBe(0);
    const { top, end, coverings } = await coveringsTopAndEnd(page);
    expect([...top.coverings, ...end.coverings], "the two ends alone show nothing").toEqual([]);
    expect(coverings.join("\n")).toMatch(/^middle at \d+ px: div\.sticky-mid \(sticky, \d+×150 at \d+,300\) is drawn over the text/m);
  });

  test("a position: relative block shifted over text in the middle of a 40-paragraph page is reported", async ({ page }) => {
    const html = LONG_SHELL(`<div class="shifted-mid" style="position:relative; top:-300px; z-index:5; height:250px; background:#fff">Shifted mid</div>`);
    await page.setContent(html);
    const hidden = await hiddenAlongThePage(page);
    expect(hidden.anywhere, "part-way down, it hides paragraphs").toBeGreaterThan(0);
    expect(hidden.atTheEnds, "at the top and at the end it hides nothing").toBe(0);
    expect((await coveringsAnywhere(page, html)).join("\n")).toMatch(/^middle at \d+ px: div\.shifted-mid \(relative\) is drawn over the text/m);
  });

  test("a shifted overlay at opacity 0 hides nothing and is not reported", async ({ page }) => {
    const html = SHELL(`<div class="ghost" style="position:relative; top:-500px; z-index:5; height:400px; background:#fff; opacity:0">X</div>`);
    await page.setContent(html);
    expect(await hitTestFinds(page, "div.ghost"), "the browser's hit test does answer it").toBe(true);
    expect(await coveringsAnywhere(page, html)).toEqual([]);
  });

  test("a fixed overlay inside a wrapper at opacity 0 is not reported either", async ({ page }) => {
    const html = SHELL("", "", `<div style="opacity:0"><div class="ghost" style="position:fixed; left:300px; top:100px; width:900px; height:500px; background:#fff; z-index:99">X</div></div>`);
    await page.setContent(html);
    expect(await hitTestFinds(page, "div.ghost"), "the browser's hit test does answer it").toBe(true);
    expect(await coveringsAnywhere(page, html)).toEqual([]);
  });

  test("a shifted overlay at opacity 0.01 is drawn and is reported", async ({ page }) => {
    const html = SHELL(`<div class="faint" style="position:relative; top:-500px; z-index:5; height:400px; background:#fff; opacity:0.01">X</div>`);
    expect((await coveringsAnywhere(page, html)).join("\n")).toMatch(/div\.faint \(relative\) is drawn over the text/);
  });

  test("an opacity 0 layer does not hide a visible overlay under it", async ({ page }) => {
    const html = SHELL(
      `<div class="visible-cover" style="position:relative; top:-500px; z-index:5; height:400px; background:#fff">Cover</div>
       <div class="ghost" style="position:relative; top:-900px; z-index:6; height:400px; background:#fff; opacity:0">X</div>`,
    );
    const found = (await coveringsAnywhere(page, html)).join("\n");
    expect(found).toMatch(/div\.visible-cover \(relative\) is drawn over the text/);
    expect(found).not.toMatch(/div\.ghost/);
  });

  test("a shifted block cut away entirely by clip-path: inset(50%) is not reported, nor is the text under it", async ({ page }) => {
    const html = SHELL(`<div class="cut" style="position:relative; top:-500px; z-index:5; clip-path:inset(50%); background:#fff">${words.repeat(10)}</div>`);
    await page.setContent(html);
    expect(await hiddenParagraphs(page), "nothing is hidden").toBe(0);
    expect(await coveringsAnywhere(page, html)).toEqual([]);
  });

  test("text that a clip-path leaves visible is still checked: a block shifted over it is reported", async ({ page }) => {
    // The top half of .half is drawn (inset(0 0 50% 0) cuts away the bottom half); .over is moved up onto it.
    const html = SHELL(
      `<div class="half" style="clip-path:inset(0 0 50% 0); height:200px">${words.repeat(4)}</div>
       <div class="over" style="position:relative; top:-200px; z-index:5; height:60px; background:#fff">Over</div>`,
    );
    expect((await coveringsAnywhere(page, html)).join("\n")).toMatch(/div\.over \(relative\) is drawn over the text "The founder/);
  });

  test("a clean 40-paragraph page reports nothing anywhere along it", async ({ page }) => {
    const html = LONG_SHELL(`<section><h2 style="position:sticky; top:0; background:#fff; margin:0">A heading that stays</h2></section>`);
    await page.setContent(html);
    const { middle, coverings } = await coveringsTopAndEnd(page);
    expect(middle.length, "it was measured part-way down").toBeGreaterThanOrEqual(3);
    expect(coverings).toEqual([]);
  });
});

/**
 * ROUND4 H10 (X6, X7, Y19, Y20): a box cut away entirely by a clip-path or the legacy clip covers
 * nothing, whatever its size, and is not reported by check 2 or check 1; a sticky element that is stuck
 * only over a short scroll range, between two of the regular middle positions, is measured where it is stuck.
 */
test.describe("the layout detector: clipped boxes, and sticky elements stuck over a short range (ROUND4 H10)", () => {
  const clipped: [string, string][] = [
    ["a fixed box 900×500 with clip-path: inset(50%)", `<div class="cut" style="position:fixed; left:300px; top:100px; width:900px; height:500px; background:#fff; z-index:9; clip-path:inset(50%)"></div>`],
    ["a fixed box 900×500 with clip: rect(0 0 0 0)", `<div class="cut" style="position:fixed; left:300px; top:100px; width:900px; height:500px; background:#fff; z-index:9; clip:rect(0 0 0 0)"></div>`],
    ["an absolute box shifted over the text, with clip-path: inset(50%)", `<div style="position:absolute; left:300px; top:200px; width:900px; height:500px; background:#fff; z-index:5; clip-path:inset(50%)">clipped away</div>`],
    ["an absolute box shifted over the text, with clip: rect(0 0 0 0)", `<div style="position:absolute; left:300px; top:200px; width:900px; height:500px; background:#fff; z-index:5; clip:rect(0 0 0 0)">clipped away</div>`],
    ["a fixed box inside a wrapper whose clip-path cuts it away", `<div style="clip-path:inset(50%)"><div style="position:fixed; left:300px; top:100px; width:900px; height:500px; background:#fff; z-index:9"></div></div>`],
  ];
  for (const [name, html] of clipped) {
    test(`${name} hides nothing and is not reported`, async ({ page }) => {
      const doc = SHELL("", "", html);
      await page.setContent(doc);
      expect(await hiddenParagraphs(page), "nothing is hidden").toBe(0);
      expect(await coveringsAnywhere(page, doc)).toEqual([]);
    });
  }

  test("controls: a box that a clip-path cuts only in part, over the text, is still reported, and so is one with no clip", async ({ page }) => {
    const half = SHELL("", "", `<div class="half-cut" style="position:fixed; left:300px; top:100px; width:900px; height:500px; background:#fff; z-index:9; clip-path:inset(0 0 50% 0)"></div>`);
    expect((await coveringsAnywhere(page, half)).join("\n")).toMatch(/div\.half-cut \(fixed, 900×500 at 300,100\)/);
    const plain = SHELL("", "", `<div class="whole" style="position:fixed; left:300px; top:100px; width:900px; height:500px; background:transparent; z-index:9"></div>`);
    expect((await coveringsAnywhere(page, plain)).join("\n")).toMatch(/div\.whole \(fixed, 900×500 at 300,100\)/);
  });

  // The verifier's case: a three-window page whose middle positions are 614 and 1228 px, with a sticky
  // top:0 block in a short section that hides text only between about 750 and 850 px of scroll.
  const SHORT_STICKY = SHELL().replace(
    /<p>1\. [\s\S]*?(<table>)/,
    `${Array.from({ length: 9 }, (_, i) => `<p>${i + 1}. ${words.repeat(3)}</p>`).join("")}<section><div class="stuck-briefly" style="position:sticky; top:0; height:120px; background:#fff; z-index:5">Sticky short</div>${Array.from({ length: 2 }, (_, i) => `<p>${900 + i}. ${words.repeat(3)}</p>`).join("")}</section>${Array.from({ length: 20 }, (_, i) => `<p>${20 + i}. ${words.repeat(3)}</p>`).join("")}$1`,
  );

  test("a sticky block stuck only between two regular middle positions is measured where it is stuck, and reported", async ({ page }) => {
    await page.setContent(SHORT_STICKY);
    // It really hides text, but only over a short range, and not at the regular positions.
    const hiddenAt = async (y: number) => {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      return hiddenParagraphs(page);
    };
    const { maxScroll, vh } = await page.evaluate(() => ({ maxScroll: document.documentElement.scrollHeight - window.innerHeight, vh: window.innerHeight }));
    const regular = middlePositions(maxScroll, vh);
    expect(regular.length, "two or three regular middle positions").toBeGreaterThanOrEqual(2);
    let hiddenSomewhere = 0;
    for (let y = 0; y <= maxScroll; y += 25) hiddenSomewhere = Math.max(hiddenSomewhere, await hiddenAt(y));
    expect(hiddenSomewhere, "somewhere along the page it hides text").toBeGreaterThan(0);
    for (const y of [0, ...regular, maxScroll]) expect(await hiddenAt(y), `at the regular position ${y} it hides nothing`).toBe(0);

    const stuck = await stickyPositions(page);
    expect(stuck.length).toBeGreaterThan(0);
    const { middle, coverings } = await coveringsTopAndEnd(page);
    expect(middle.some((m) => m.where.startsWith("where a sticky element is stuck")), "measured where it is stuck").toBe(true);
    expect(coverings.join("\n")).toMatch(/where a sticky element is stuck, at \d+ px: div\.stuck-briefly \(sticky/);
  });

  test("control: the same page with the block not sticky reports nothing, at no more positions than needed", async ({ page }) => {
    const html = SHORT_STICKY.replace("position:sticky; top:0; height:120px", "height:120px");
    await page.setContent(html);
    const { coverings } = await coveringsTopAndEnd(page);
    expect(coverings).toEqual([]);
    // Only the side navigation is sticky here, stuck for the whole page.
    expect((await stickyPositions(page)).length).toBeLessThanOrEqual(3);
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
