export type MarkStyle = 'outline' | 'arrow';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeasuredMark {
  rect: Rect;
  style: MarkStyle;
  label?: string;
  note?: string;
}

export interface OverlayTheme {
  color: string;
  textColor: string;
  fontFamily: string;
}

export const OVERLAY_ATTR = 'data-docshot-overlay';

/** Runs in the browser: returns the element's rect in document coordinates. */
export function measureInPage(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
}

/** Runs in the browser: document size, used to clamp clip rects. */
export function documentSizeInPage(): { width: number; height: number } {
  const d = document.documentElement;
  return {
    width: Math.max(d.scrollWidth, document.body ? document.body.scrollWidth : 0, d.clientWidth),
    height: Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0, d.clientHeight),
  };
}

/**
 * Runs in the browser (must be self-contained – it is serialized by Playwright).
 * Draws all marks into one absolutely positioned layer in document coordinates.
 */
export function drawOverlaysInPage(args: { marks: MeasuredMark[]; theme: OverlayTheme; attr: string; bounds?: Rect }): Rect[] {
  const { marks, theme, attr, bounds } = args;
  const NS = 'http://www.w3.org/2000/svg';
  const d = document.documentElement;
  const width = Math.max(d.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const height = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0);

  const layer = document.createElement('div');
  layer.setAttribute(attr, '');
  Object.assign(layer.style, {
    position: 'absolute', left: '0', top: '0', width: width + 'px', height: height + 'px',
    pointerEvents: 'none', zIndex: '2147483647', margin: '0', padding: '0', border: '0',
  });

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');

  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML =
    `<marker id="docshot-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${theme.color}"/></marker>`;
  svg.appendChild(defs);

  const el = (name: string, attrs: Record<string, string | number>) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.appendChild(node);
    return node;
  };

  const PAD = 4;
  for (const mark of marks) {
    const x = mark.rect.x - PAD;
    const y = mark.rect.y - PAD;
    const w = mark.rect.width + PAD * 2;
    const h = mark.rect.height + PAD * 2;

    if (mark.style === 'outline') {
      // white halo first, so the outline stays visible on dark and on red UIs
      el('rect', { x, y, width: w, height: h, rx: 6, fill: 'none', stroke: '#fff', 'stroke-width': 7, 'stroke-opacity': 0.9 });
      el('rect', { x, y, width: w, height: h, rx: 6, fill: 'none', stroke: theme.color, 'stroke-width': 3 });
    } else {
      // arrow from the left (or from the right if there is no room), pointing at the vertical center
      const cy = mark.rect.y + mark.rect.height / 2;
      const fromLeft = mark.rect.x > 110;
      const tipX = fromLeft ? x - 4 : x + w + 4;
      const startX = fromLeft ? tipX - 80 : tipX + 80;
      const startY = cy - 48;
      const line = { x1: startX, y1: startY, x2: tipX, y2: cy, 'stroke-linecap': 'round' };
      el('line', { ...line, stroke: '#fff', 'stroke-width': 9, 'stroke-opacity': 0.9 });
      el('line', { ...line, stroke: theme.color, 'stroke-width': 4, 'marker-end': 'url(#docshot-arrowhead)' });
    }

    if (mark.label) {
      const r = 13;
      // outline: badge left of the outline, vertically centered (labels usually sit top-left);
      // no room on the left → top-left corner. arrow: badge at the arrow's tail.
      // small inline elements (buttons, links) have horizontal neighbours → corner badge
      const roomLeft = mark.rect.width >= 240 && x - (r + 6) * 2 > 0;
      const cx = mark.style === 'outline' ? (roomLeft ? x - r - 6 : x) : mark.rect.x > 110 ? x - 84 : x + w + 84;
      // corner badge: top-left, or bottom-left when the element touches the top of the page
      const cornerY = y - (r + 4) < 0 ? y + h : y;
      const cy = mark.style === 'outline' ? (roomLeft ? y + h / 2 : cornerY) : mark.rect.y + mark.rect.height / 2 - 48;
      el('circle', { cx, cy, r: r + 2, fill: '#fff' });
      el('circle', { cx, cy, r, fill: theme.color });
      const t = el('text', {
        x: cx, y: cy + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': theme.fontFamily, 'font-size': 14, 'font-weight': 700, fill: theme.textColor,
      });
      t.textContent = mark.label;
    }
  }
  layer.appendChild(svg);
  document.documentElement.appendChild(layer);

  // ── notes: measured, then placed where they cover the least ───────────────
  type Box = { x: number; y: number; w: number; h: number };
  const area = (a: Box, b: Box) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  // things a note should not cover: visible text and controls (no big containers), plus all marks
  const viewportArea = window.innerWidth * window.innerHeight;
  const obstacles: Box[] = [];
  document.querySelectorAll('h1,h2,h3,h4,h5,h6,label,button,a,input,select,textarea,th,td,p,li,img,svg,[role="button"],[role="link"],[role="tab"]').forEach((node) => {
    const r = (node as Element).getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.width * r.height > viewportArea * 0.25) return;
    const cs = getComputedStyle(node as Element);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return;
    obstacles.push({ x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height });
  });
  // marked elements and their outlines (badges sit 16px outside) – the note's own element only exactly
  const markBox = (m: MeasuredMark, extra: number): Box => ({ x: m.rect.x - PAD - extra, y: m.rect.y - PAD - extra, w: m.rect.width + (PAD + extra) * 2, h: m.rect.height + (PAD + extra) * 2 });
  const placedNotes: Box[] = [];

  for (const mark of marks) {
    if (!mark.note) continue;
    const note = document.createElement('div');
    note.textContent = mark.note;
    Object.assign(note.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      visibility: 'hidden',
      maxWidth: '280px',
      width: 'max-content',
      background: theme.color,
      color: theme.textColor,
      font: `600 13px/1.35 ${theme.fontFamily}`,
      padding: '6px 10px',
      borderRadius: '6px',
      boxShadow: '0 0 0 2px #fff, 0 4px 12px rgba(0,0,0,.25)',
      whiteSpace: 'normal',
    });
    layer.appendChild(note);
    const nw = note.offsetWidth;
    const nh = note.offsetHeight;

    const r = mark.rect;
    const ex = r.x - PAD, ey = r.y - PAD, ew = r.width + PAD * 2, eh = r.height + PAD * 2;
    const G = 10;
    const candidates: Box[] = [];
    if (mark.style === 'arrow') {
      const fromLeft = r.x > 110;
      const tailX = fromLeft ? ex - 84 : ex + ew + 84;
      const tailY = r.y + r.height / 2 - 48;
      const gap = mark.label ? 24 : G;
      candidates.push(
        fromLeft ? { x: tailX - gap - nw, y: tailY - nh / 2, w: nw, h: nh } : { x: tailX + gap, y: tailY - nh / 2, w: nw, h: nh }, // beside the tail
        { x: tailX - nw / 2, y: tailY - gap - nh, w: nw, h: nh },                 // above the tail
        { x: ex + ew - nw, y: ey + eh + G, w: nw, h: nh },                        // below the element, right-aligned
        { x: ex, y: ey + eh + G, w: nw, h: nh },                                  // below the element, left-aligned
        { x: ex + ew - nw, y: ey - G - nh, w: nw, h: nh },                        // above the element
      );
    } else {
      candidates.push(
        { x: ex + ew - nw, y: ey + eh + G, w: nw, h: nh },                        // below, right-aligned
        { x: ex + ew + G, y: ey + eh / 2 - nh / 2, w: nw, h: nh },               // right
        { x: ex + ew - nw, y: ey - G - nh, w: nw, h: nh },                        // above, right-aligned
        { x: ex, y: ey + eh + G, w: nw, h: nh },                                  // below, left-aligned
        { x: ex - G - nw, y: ey + eh / 2 - nh / 2, w: nw, h: nh },               // left
      );
    }

    let best = candidates[0];
    let bestScore = Infinity;
    candidates.forEach((c, i) => {
      let score = i * 50; // keep the natural order when everything is free
      if (c.x < 4 || c.y < 4 || c.x + c.w > width - 4 || c.y + c.h > height - 4) score += 1e9; // outside the page
      // stay inside the crop of an element screenshot if at all possible
      if (bounds && (c.x < bounds.x || c.y < bounds.y || c.x + c.w > bounds.x + bounds.width || c.y + c.h > bounds.y + bounds.height)) score += 1e6;
      for (const o of obstacles) score += area(c, o);
      for (const m of marks) score += area(c, markBox(m, m === mark ? 0 : 16)) * 2;
      for (const p of placedNotes) score += area(c, p) * 10;
      if (score < bestScore) { bestScore = score; best = c; }
    });
    // nothing fits inside the page → clamp the natural position
    const x = Math.min(Math.max(4, best.x), width - nw - 4);
    const y = Math.min(Math.max(4, best.y), height - nh - 4);
    Object.assign(note.style, { left: x + 'px', top: y + 'px', visibility: '' }); // inherit from the layer
    placedNotes.push({ x, y, w: nw, h: nh });
  }


  // Modal <dialog>s and popovers live in the browser's top layer, above any z-index.
  // Promoting the overlay to a popover puts it into the top layer as well – shown last, so on top.
  // position:absolute in the top layer is relative to the initial containing block = document coords.
  // (inline on purpose: page.evaluate only serializes this one function)
  const promotable = layer as HTMLElement & { showPopover?: () => void };
  if (typeof promotable.showPopover === 'function') {
    layer.setAttribute('popover', 'manual');
    Object.assign(layer.style, { inset: '0 auto auto 0', overflow: 'visible', background: 'transparent', color: 'inherit' });
    try {
      promotable.showPopover();
    } catch {
      /* not supported – keep the normal layer */
    }
  }
  return placedNotes.map((b) => ({ x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8 }));
}

/** Runs in the browser: hide/show the overlay layer (for the clean shot with the same crop). */
export function setOverlayVisibleInPage(args: { attr: string; visible: boolean }): void {
  document.querySelectorAll(`[${args.attr}]`).forEach((n) => ((n as HTMLElement).style.visibility = args.visible ? 'visible' : 'hidden'));
}

/** Runs in the browser. */
export function removeOverlaysInPage(attr: string): void {
  document.querySelectorAll(`[${attr}]`).forEach((n) => n.remove());
}

/** Rect that covers the marks as drawn, including badges, arrows and notes (approximate). */
export function decoratedRect(mark: MeasuredMark): Rect {
  const { x, y, width, height } = mark.rect;
  let left = x - 44;
  let top = y - 20;
  let right = x + width + 20;
  let bottom = y + height + 20;
  if (mark.style === 'arrow') {
    if (x > 110) left = x - 110;
    else right = x + width + 110;
    top = Math.min(top, y + height / 2 - 66);
  }
  if (mark.note && mark.style === 'arrow') {
    if (x > 110) left = Math.min(left, x - 110 - 300);
    else right = Math.max(right, x + width + 110 + 300);
  } else if (mark.note) bottom = Math.max(bottom, y + height + 70);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function union(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
