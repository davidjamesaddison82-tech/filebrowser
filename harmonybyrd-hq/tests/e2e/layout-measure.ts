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
 *      inside it, so an overlay anywhere else in the page (inside the navigation, in <body>) is found;
 *   4. a finer grid over <main>: where a point lies on a line of text, the element shown there must be
 *      that text's own element (or one inside it, or one around it whose pseudo-element does not cover
 *      the point), so a block shifted over earlier text (relative offset, transform) and a fixed
 *      pseudo-element (body::before, main::after) are found too (F11).
 * While measuring, pointer-events is forced on, so an overlay made "click-through" is still seen.
 */
export interface LayoutMeasure {
  /**
   * How far the page scrolls sideways: the document's scroll width minus the width of the layout
   * viewport (documentElement.clientWidth). Not window.innerWidth: a mobile browser widens innerWidth
   * to fit content that overflows, so measured against it the overflow is always 0 (F10).
   */
  sidewaysScroll: number;
  /** document.documentElement.scrollWidth, to be compared with the configured window width. */
  scrollWidth: number;
  /** document.documentElement.clientWidth. */
  clientWidth: number;
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
      // (4) Text that is under a point but is not what is shown there (F11). Checks (1)–(3) look at
      // positioned boxes and at what lies over <main>; this finds what they cannot: a block shifted
      // over earlier text (position: relative with top: -500px, or a transform), and a pseudo-element
      // drawn over the content (body::before, main::after), for which elementFromPoint answers body
      // or main. On a finer grid of points over <main>, take the text whose line box holds the point,
      // and report when the element shown there is unrelated to it (neither its own element nor an
      // ancestor or descendant), or is an ancestor whose own pseudo-element covers the point.
      const clippedAt = (el: Element, x: number, y: number) => {
        // Text cut off by an ancestor's overflow (a scrolled table, .sr-only) is not under the point.
        for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX === "visible" && cs.overflowY === "visible" && cs.clipPath === "none" && cs.clip === "auto") continue;
          const b = a.getBoundingClientRect();
          if (x < b.left || x > b.right || y < b.top || y > b.bottom) return true;
        }
        return false;
      };
      const pseudoOver = (el: Element, x: number, y: number): string | null => {
        for (const which of ["::before", "::after"] as const) {
          const ps = getComputedStyle(el, which);
          if (ps.content === "none" || ps.content === "normal" || ps.display === "none" || ps.visibility === "hidden" || Number(ps.opacity) === 0) continue;
          if (ps.position !== "fixed" && ps.position !== "absolute") {
            // In the flow a pseudo-element's box cannot be read; the hit test already says it is on top.
            return `${describe(el)}${which} (${ps.position})`;
          }
          // A fixed pseudo-element is placed against the window; an absolute one against the nearest
          // positioned element, its own element or one above it.
          let origin = { left: 0, top: 0 };
          if (ps.position === "absolute") {
            let cb: Element | null = el;
            while (cb && cb !== document.documentElement && getComputedStyle(cb).position === "static") cb = cb.parentElement;
            origin = cb && cb !== document.documentElement ? cb.getBoundingClientRect() : { left: -window.scrollX, top: -window.scrollY };
          }
          const w = parseFloat(ps.width);
          const h = parseFloat(ps.height);
          const left = origin.left + (parseFloat(ps.left) || 0);
          const top = origin.top + (parseFloat(ps.top) || 0);
          if (w > 0 && h > 0 && x >= left && x <= left + w && y >= top && y <= top + h) {
            return `${describe(el)}${which} (${ps.position}, ${Math.round(w)}×${Math.round(h)} at ${Math.round(left)},${Math.round(top)})`;
          }
        }
        return null;
      };
      if (main && mainBox && area(mainBox) > 0) {
        // Only text the browser renders: the content of a closed <details> still has line boxes
        // (content-visibility: hidden keeps its layout) but is not drawn, so nothing covers it.
        const rendered = new Map<Element, boolean>();
        const isRendered = (el: Element) => {
          if (!rendered.has(el)) rendered.set(el, el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }));
          return rendered.get(el)!;
        };
        const inMain = texts.filter((t) => main.contains(t.holder) && !t.holder.closest("select, option, textarea") && isRendered(t.holder));
        const step = 40;
        let reported = 0;
        for (let y = mainBox.top + 2; y < mainBox.bottom - 1 && reported < 3; y += step) {
          for (let x = mainBox.left + 2; x < mainBox.right - 1 && reported < 3; x += step) {
            if (navBox && x >= navBox.left && x <= navBox.right && y >= navBox.top && y <= navBox.bottom) continue;
            // Well inside the line box: at its very edge the browser's hit test, which rounds, can
            // answer the neighbouring element that starts there.
            const e = 1.5;
            const under = inMain.find((t) => x >= t.box.left + e && x <= t.box.right - e && y >= t.box.top + e && y <= t.box.bottom - e && !clippedAt(t.holder, x, y));
            if (!under) continue;
            const top = document.elementFromPoint(x, y);
            const holder = under.holder;
            if (!top || top === holder || holder.contains(top)) continue;
            const text = `"${(holder.textContent ?? "").trim().slice(0, 40)}"`;
            if (top.contains(holder)) {
              const pseudo = pseudoOver(top, x, y);
              if (!pseudo) continue;
              coverings.push(`${pseudo} is drawn over the text ${text} at ${Math.round(x)},${Math.round(y)}`);
              reported++;
              continue;
            }
            // A sticky cell over the cells of its own table that scroll under it is the table working.
            const cell = top.closest("th, td");
            if (cell && getComputedStyle(cell).position === "sticky" && cell.closest("table") === holder.closest("table")) continue;
            const cs = getComputedStyle(top);
            coverings.push(`${describe(top)} (${cs.position}${cs.transform !== "none" ? ", transformed" : ""}) is drawn over the text ${text} at ${Math.round(x)},${Math.round(y)}`);
            reported++;
          }
        }
      }

      return {
        sidewaysScroll: doc.scrollWidth - doc.clientWidth,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
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
