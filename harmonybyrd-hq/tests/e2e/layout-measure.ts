import type { Page } from "@playwright/test";

/**
 * Layout measurements for acceptance check 11, made in the real browser (tests-7).
 *
 * "Nothing covers the content" is checked three ways, so that no kind of overlay slips through:
 *   1. every element positioned fixed, sticky or absolute (other than the side navigation itself,
 *      a navigation part that stays inside the navigation, a sticky table cell that stays inside its
 *      own table, and boxes too small to see such as .sr-only) is tested against every piece of text
 *      on the page: if it is drawn on top of any of it, that is a covering, whatever its size;
 *   2. any such element that overlaps more than 12% of the window over the content is a covering
 *      even where it hides no text;
 *   3. a grid of points over the visible part of <main>: each point must show <main> or something
 *      inside it, so an overlay anywhere else in the page (inside the navigation, in <body>) is found.
 * While measuring, pointer-events is forced on, so an overlay made "click-through" is still seen.
 */
export interface LayoutMeasure {
  sidewaysScroll: number;
  headingTop: number | null;
  headingUncovered: boolean;
  devOverlay: boolean;
  navRight: number;
  mainLeft: number;
  /** One line per covering found; empty when nothing covers the content. */
  coverings: string[];
}

export async function measureLayout(page: Page): Promise<LayoutMeasure> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    const force = document.createElement("style");
    force.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
    document.head.appendChild(force);
    try {
      type Box = { left: number; top: number; right: number; bottom: number };
      const visible = (b: Box): Box => ({ left: Math.max(b.left, 0), top: Math.max(b.top, 0), right: Math.min(b.right, vw), bottom: Math.min(b.bottom, vh) });
      const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
      const meet = (a: Box, b: Box): Box => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
      const inside = (a: Box, b: Box) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
      const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
      const shown = (el: Element) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
      };

      const nav = document.querySelector("aside.nav");
      const main = document.querySelector("main");
      const h1 = document.querySelector("main h1");
      const navBox = nav?.getBoundingClientRect() ?? null;
      const mainBox = main ? visible(main.getBoundingClientRect()) : null;

      let headingUncovered = false;
      const r = h1?.getBoundingClientRect();
      if (h1 && r) {
        const x = Math.min(r.left + 24, vw - 2);
        const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        headingUncovered = !!top && (top === h1 || h1.contains(top) || top.contains(h1));
      }

      // Every piece of visible text, as boxes, with the element that holds it.
      const texts: { box: Box; holder: Element }[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent || !n.textContent.trim() || !n.parentElement) continue;
        if (n.parentElement.closest("script, style, noscript")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rect of Array.from(range.getClientRects())) {
          const box = visible(rect);
          if (area(box) > 0) texts.push({ box, holder: n.parentElement });
        }
      }

      const coverings: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky" && cs.position !== "absolute") continue;
        if (!shown(el) || el === nav) continue;
        const own = el.getBoundingClientRect();
        const box = visible(own);
        if (own.width < 2 || own.height < 2 || area(box) < 16) continue; // e.g. .sr-only (1 × 1 px)
        if (nav && navBox && nav.contains(el) && inside(own, navBox)) continue; // part of the navigation, inside it
        const table = el.closest("table");
        if (cs.position === "sticky" && table && inside(own, table.getBoundingClientRect())) continue; // sticky cell in its table
        const what = `${describe(el)} (${cs.position}, ${Math.round(own.width)}×${Math.round(own.height)} at ${Math.round(own.left)},${Math.round(own.top)})`;

        // (1) Is it drawn over any text that is not its own?
        let hidden: string | null = null;
        for (const t of texts) {
          if (el.contains(t.holder) || t.holder.contains(el)) continue;
          const m = meet(t.box, box);
          if (area(m) <= 0) continue;
          const x = (m.left + m.right) / 2;
          const y = (m.top + m.bottom) / 2;
          const top = document.elementFromPoint(x, y);
          if (top && (top === el || el.contains(top)) && !t.holder.contains(top)) {
            hidden = `"${(t.holder.textContent ?? "").trim().slice(0, 40)}"`;
            break;
          }
        }
        if (hidden) {
          coverings.push(`${what} is drawn over the text ${hidden}`);
          continue;
        }
        // (2) A large box over the content counts even where there is no text under it.
        if (mainBox && !(main?.contains(el) && cs.position === "sticky")) {
          const share = area(meet(box, mainBox)) / (vw * vh);
          if (share >= 0.12 && !(main && el.contains(main))) coverings.push(`${what} covers ${Math.round(share * 100)}% of the window over the content`);
        }
      }

      // (3) Grid over the visible part of main.
      if (main && mainBox && area(mainBox) > 0) {
        const step = 80;
        let reported = 0;
        for (let y = mainBox.top + 4; y < mainBox.bottom - 2 && reported < 3; y += step) {
          for (let x = mainBox.left + 4; x < mainBox.right - 2 && reported < 3; x += step) {
            if (navBox && x >= navBox.left && x <= navBox.right && y >= navBox.top && y <= navBox.bottom) continue;
            const top = document.elementFromPoint(x, y);
            if (!top || main.contains(top) || top.contains(main)) continue;
            coverings.push(`${describe(top)} covers the content at ${Math.round(x)},${Math.round(y)}`);
            reported++;
          }
        }
        // Inside main: a point must not be taken by an element positioned over the flow.
        for (let y = mainBox.top + 4; y < mainBox.bottom - 2 && reported < 3; y += step) {
          for (let x = mainBox.left + 4; x < mainBox.right - 2 && reported < 3; x += step) {
            const top = document.elementFromPoint(x, y);
            if (!top || !main.contains(top) || top === main) continue;
            for (let a: Element | null = top; a && a !== main; a = a.parentElement) {
              const p = getComputedStyle(a).position;
              if (p !== "absolute" && p !== "fixed") continue;
              const ab = a.getBoundingClientRect();
              if (ab.width * ab.height >= 0.12 * vw * vh) {
                coverings.push(`${describe(a)} (${p}) lies over the content at ${Math.round(x)},${Math.round(y)}`);
                reported++;
              }
              break;
            }
          }
        }
      }

      return {
        sidewaysScroll: doc.scrollWidth - vw,
        headingTop: r ? r.top : null,
        headingUncovered,
        devOverlay: !!document.querySelector("nextjs-portal"),
        navRight: navBox ? navBox.right : 0,
        mainLeft: main ? main.getBoundingClientRect().left : 0,
        coverings: [...new Set(coverings)],
      };
    } finally {
      force.remove();
    }
  });
}

/** Measure at the top of the page, then again scrolled to the end; return both sets of coverings. */
export async function coveringsTopAndEnd(page: Page): Promise<{ top: LayoutMeasure; end: LayoutMeasure }> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const top = await measureLayout(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const end = await measureLayout(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  return { top, end };
}
