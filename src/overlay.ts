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

export type CaptureMode = 'viewport' | 'page' | 'crop';

export interface OverlayLayout {
  /** everything drawn per mark (outline, badge, arrow, note) – used to grow the crop */
  decorations: { mark: number; box: Rect }[];
  arrows: { mark: number; tail: { x: number; y: number }; tip: { x: number; y: number } }[];
  notes: { mark: number; box: Rect }[];
  badges: { mark: number; box: Rect }[];
  /** the area the screenshot will show */
  view: Rect;
}

/**
 * Runs in the browser (must be self-contained – it is serialized by Playwright).
 *
 * Lays out all annotations together:
 *  1. outlines and their badges are fixed by the marked elements,
 *  2. every arrow tries 8 directions × 3 lengths; each candidate (line + badge + note) is scored for
 *     leaving the screenshot area, crossing other arrows / marks / badges / notes, and covering text,
 *  3. arrows are placed greedily, then each one is re-placed once against all others,
 *  4. notes of outlines are placed last around their element.
 */
export function drawOverlaysInPage(args: {
  marks: MeasuredMark[];
  theme: OverlayTheme;
  attr: string;
  mode?: CaptureMode;
  bounds?: Rect;
  /** crop mode: may the crop grow around annotations? (screenshots yes, videos no – their frame is fixed) */
  growable?: boolean;
  /** drawn as solid boxes – for videos, where Playwright's screenshot masks do not apply */
  masks?: Rect[];
  maskColor?: string;
}): OverlayLayout {
  const { marks, theme, attr } = args;
  // replace an existing layer in the same task – no frame can show the page without markers
  document.querySelectorAll(`[${attr}]`).forEach((n) => n.remove());
  const mode = args.mode ?? (args.bounds ? 'crop' : 'viewport');
  // leaving the screenshot area: impossible for viewport shots and videos, cheap for growable element crops
  // arrows and numbers may stick out a little (the crop grows), notes should stay in the content
  const growable = mode === 'crop' && args.growable !== false;
  const OUTSIDE = growable ? 250 : 1e6;
  const OUTSIDE_NOTE = growable ? 900 : 1e6;
  type P = { x: number; y: number };
  type Box = { x: number; y: number; w: number; h: number };

  const NS = 'http://www.w3.org/2000/svg';
  const d = document.documentElement;
  const width = Math.max(d.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const height = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const PAD = 4;
  const R = 13; // badge radius

  const doc: Box = { x: 0, y: 0, w: width, h: height };
  const view: Box =
    mode === 'crop' && args.bounds
      ? { x: args.bounds.x, y: args.bounds.y, w: args.bounds.width, h: args.bounds.height }
      : mode === 'page'
        ? doc
        : { x: window.scrollX, y: window.scrollY, w: window.innerWidth, h: window.innerHeight };

  // ── geometry ──────────────────────────────────────────────────────────────
  const overlap = (a: Box, b: Box) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inside = (a: Box, b: Box, m = 2) => a.x >= b.x + m && a.y >= b.y + m && a.x + a.w <= b.x + b.w - m && a.y + a.h <= b.y + b.h - m;
  const ptIn = (p: P, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const segSeg = (a: P, b: P, c: P, e: P) => {
    const d1 = cross(c, e, a), d2 = cross(c, e, b), d3 = cross(a, b, c), d4 = cross(a, b, e);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  const segBox = (a: P, b: P, r: Box) => {
    if (ptIn(a, r) || ptIn(b, r)) return true;
    const c = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
    return segSeg(a, b, c[0], c[1]) || segSeg(a, b, c[1], c[2]) || segSeg(a, b, c[2], c[3]) || segSeg(a, b, c[3], c[0]);
  };
  const lineBox = (a: P, b: P, pad = 6): Box => ({
    x: Math.min(a.x, b.x) - pad, y: Math.min(a.y, b.y) - pad, w: Math.abs(a.x - b.x) + pad * 2, h: Math.abs(a.y - b.y) + pad * 2,
  });
  const grow = (b: Box, g: number): Box => ({ x: b.x - g, y: b.y - g, w: b.w + g * 2, h: b.h + g * 2 });
  const padded = (m: MeasuredMark, extra = 0): Box => ({
    x: m.rect.x - PAD - extra, y: m.rect.y - PAD - extra, w: m.rect.width + (PAD + extra) * 2, h: m.rect.height + (PAD + extra) * 2,
  });

  // ── obstacles: the actual text boxes on the page, plus controls and images ──
  // (per text node, so empty space inside wide cells or containers stays usable)
  const obstacles: Box[] = [];
  const reach: Box = { x: view.x - 300, y: view.y - 300, w: view.w + 600, h: view.h + 600 };
  const near = (b: Box) => b.x < reach.x + reach.w && b.x + b.w > reach.x && b.y < reach.y + reach.h && b.y + b.h > reach.y;
  const hiddenCache = new Map<Element, boolean>();
  const isHidden = (el: Element | null): boolean => {
    if (!el) return false;
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    const cs = getComputedStyle(el);
    const hidden = cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0;
    hiddenCache.set(el, hidden);
    return hidden;
  };
  const sx = window.scrollX, sy = window.scrollY;
  // with a modal dialog open, the page behind it is inert and dimmed – only the dialog's text counts
  let modal: Element | null = null;
  try {
    const open = Array.from(document.querySelectorAll('dialog:modal'));
    modal = open.length ? open[open.length - 1] : null;
  } catch {
    /* :modal not supported */
  }
  const textRoot: Node = modal ?? document.body ?? document.documentElement;
  const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  for (let node = walker.nextNode(); node && obstacles.length < 5000; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(`[${attr}]`) || parent.closest('script,style,noscript,template') || isHidden(parent)) continue;
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      const b = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
      if (near(b)) obstacles.push(b);
    }
  }
  (modal ?? document).querySelectorAll('input,select,textarea,button,img,svg,video,canvas,[role="button"],[role="checkbox"],[role="switch"]').forEach((node) => {
    if ((node as Element).closest(`[${attr}]`) || isHidden(node as Element)) return;
    const r = (node as Element).getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const b = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
    if (near(b)) obstacles.push(b);
  });

  // ── layer + note measuring ────────────────────────────────────────────────
  const layer = document.createElement('div');
  layer.setAttribute(attr, '');
  Object.assign(layer.style, {
    position: 'absolute', left: '0', top: '0', width: width + 'px', height: height + 'px',
    pointerEvents: 'none', zIndex: '2147483647', margin: '0', padding: '0', border: '0',
  });
  document.documentElement.appendChild(layer);

  const noteEls: (HTMLDivElement | undefined)[] = marks.map((m) => {
    if (!m.note) return undefined;
    const n = document.createElement('div');
    n.textContent = m.note;
    Object.assign(n.style, {
      position: 'absolute', left: '0px', top: '0px', visibility: 'hidden', maxWidth: '280px', width: 'max-content',
      background: theme.color, color: theme.textColor, font: `600 13px/1.35 ${theme.fontFamily}`,
      padding: '6px 10px', borderRadius: '6px', boxShadow: '0 0 0 2px #fff, 0 4px 12px rgba(0,0,0,.25)', whiteSpace: 'normal',
    });
    layer.appendChild(n);
    return n;
  });
  const noteSize = noteEls.map((n) => (n ? { w: n.offsetWidth, h: n.offsetHeight } : undefined));

  // ── placed things, shared by all scoring ─────────────────────────────────
  const placedBoxes: { mark: number; box: Box }[] = []; // badges and notes
  const placedLines: { mark: number; a: P; b: P }[] = [];
  const markBoxes = marks.map((m) => padded(m));
  const GAP = 10; // minimum distance between badges/notes of different marks

  // outline badges: several positions around their element; pick the one that is inside the view and
  // does not sit on other marked elements, other badges or text (left-center first for wide fields)
  const badgeOf: (Box | undefined)[] = marks.map(() => undefined);
  marks.forEach((m, i) => {
    if (m.style !== 'outline' || !m.label) return;
    const b = markBoxes[i];
    const S = (R + 2) * 2;
    const at = (cx: number, cy: number): Box => ({ x: cx - S / 2, y: cy - S / 2, w: S, h: S });
    const cands: Box[] = [
      ...(m.rect.width >= 240 ? [at(b.x - R - 6, b.y + b.h / 2)] : []), // left of wide fields
      at(b.x, b.y),                 // top-left corner
      at(b.x, b.y + b.h),           // bottom-left
      at(b.x + b.w, b.y),           // top-right
      at(b.x + b.w, b.y + b.h),     // bottom-right
      at(b.x - R - 6, b.y + b.h / 2), // left
      at(b.x + b.w + R + 6, b.y + b.h / 2), // right
    ];
    let best = cands[0];
    let bestScore = Infinity;
    cands.forEach((c, k) => {
      let score = k * 40;
      if (!inside(c, doc, 0)) score += 1e9;
      // element shots grow their crop around annotations – leaving it only costs a little there
      else if (!inside(c, view)) score += OUTSIDE;
      markBoxes.forEach((mb, j) => {
        if (j !== i) score += overlap(grow(c, 3), grow(mb, 3)) * 80;
      });
      for (const pb of placedBoxes) score += overlap(grow(c, GAP), pb.box) * 80;
      for (const o of obstacles) score += overlap(c, o) * 5; // a number over letters is hard to read
      if (score < bestScore) { bestScore = score; best = c; }
    });
    badgeOf[i] = best;
    placedBoxes.push({ mark: i, box: best });
  });

  // ── notes of outlines ────────────────────────────────────────────────────
  const outlineNote: (Box | undefined)[] = marks.map(() => undefined);
  const NOTE_TAG = -1000; // placedBoxes entries of outline notes use mark index - 1000 … see below
  const placeOutlineNotes = () => {
  // remove the previous round's outline notes
  for (let k = placedBoxes.length - 1; k >= 0; k--) if (placedBoxes[k].mark < 0) placedBoxes.splice(k, 1);
  marks.forEach((m, i) => {
    const ns = noteSize[i];
    if (m.style !== 'outline' || !ns) return;
    const b = markBoxes[i];
    const G = 10;
    const cands: Box[] = [
      { x: b.x + b.w - ns.w, y: b.y + b.h + G, w: ns.w, h: ns.h },
      { x: b.x + b.w + G, y: b.y + b.h / 2 - ns.h / 2, w: ns.w, h: ns.h },
      { x: b.x + b.w - ns.w, y: b.y - G - ns.h, w: ns.w, h: ns.h },
      { x: b.x, y: b.y + b.h + G, w: ns.w, h: ns.h },
      { x: b.x - G - ns.w, y: b.y + b.h / 2 - ns.h / 2, w: ns.w, h: ns.h },
    ];
    let best = cands[0];
    let bestScore = Infinity;
    cands.forEach((c, k) => {
      let score = k * 50;
      if (!inside(c, doc, 0)) score += 1e9;
      else if (!inside(c, view)) score += OUTSIDE_NOTE;
      for (const o of obstacles) score += overlap(c, o) * 1.5;
      // own element: avoid covering it; other marked elements (incl. their badges' ring): never
      markBoxes.forEach((mb, j) => (score += j === i ? overlap(c, mb) * 2 : overlap(c, grow(mb, 16)) * 40));
      for (const pb of placedBoxes) if (pb.mark !== i && pb.mark !== i + NOTE_TAG) score += overlap(grow(c, GAP), pb.box) * 60;
      for (const l of placedLines) if (segBox(l.a, l.b, grow(c, 4))) score += 3e4;
      if (score < bestScore) { bestScore = score; best = c; }
    });
    outlineNote[i] = best;
    placedBoxes.push({ mark: i + NOTE_TAG, box: best });
  });
  };


  placeOutlineNotes(); // first round: arrows will avoid them

  // ── arrows ────────────────────────────────────────────────────────────────
  // preferred directions first (upper left/right, sideways), then the finer ones
  const DIRS: P[] = [
    [-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6], [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -0.25], [1, -0.25], [-1, 0.25], [1, 0.25], [-0.45, -1], [0.45, -1], [-0.45, 1], [0.45, 1],
  ].map(([x, y]) => {
    const l = Math.hypot(x, y);
    return { x: x / l, y: y / l };
  });
  const LENGTHS = [80, 115, 155, 200];

  type ArrowPlan = { tail: P; tip: P; dir: P; badge?: Box; note?: Box; score: number };
  const arrowPlan: (ArrowPlan | undefined)[] = marks.map(() => undefined);

  const planArrow = (i: number): ArrowPlan => {
    const m = marks[i];
    const box = markBoxes[i];
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    let best: ArrowPlan | undefined;
    // only text near this arrow matters – keeps 16 directions × anchors × lengths fast
    // reach: longest arrow + badge + widest note (notes are at most 280 px wide)
    const reachBox = grow(box, LENGTHS[LENGTHS.length - 1] + (R + 2) * 2 + 300 + 20);
    const local = obstacles.filter((o) => overlap(o, reachBox) > 0);
    // anchors: the ray from the center, plus the corners of wide/flat elements (arrows can then
    // come in from the side of a long link instead of through the line above it)
    const corners: P[] = [
      { x: box.x - 4, y: box.y - 4 }, { x: box.x + box.w + 4, y: box.y - 4 },
      { x: box.x - 4, y: box.y + box.h + 4 }, { x: box.x + box.w + 4, y: box.y + box.h + 4 },
    ];
    const anchors = (dir: P): P[] => {
      const t = Math.min(dir.x ? box.w / 2 / Math.abs(dir.x) : Infinity, dir.y ? box.h / 2 / Math.abs(dir.y) : Infinity);
      const center = { x: c.x + dir.x * (t + 4), y: c.y + dir.y * (t + 4) };
      if (!dir.x || !dir.y) return [center];
      // the corner that faces the direction
      const corner = corners[(dir.x > 0 ? 1 : 0) + (dir.y > 0 ? 2 : 0)];
      return [center, corner];
    };
    DIRS.forEach((dir, di) => anchors(dir).forEach((tip, ai) => {
      LENGTHS.forEach((len, li) => {
        const tail = { x: tip.x + dir.x * len, y: tip.y + dir.y * len };
        const badgeC = { x: tail.x + dir.x * (R + 2), y: tail.y + dir.y * (R + 2) };
        const badge = m.label ? { x: badgeC.x - R - 2, y: badgeC.y - R - 2, w: (R + 2) * 2, h: (R + 2) * 2 } : undefined;
        // note candidates: beyond the badge, or beside it (left / right)
        const ns = noteSize[i];
        const noteCands: (Box | undefined)[] = [undefined];
        if (ns) {
          noteCands.length = 0;
          const anchor = m.label ? { x: badgeC.x + dir.x * (R + 6), y: badgeC.y + dir.y * (R + 6) } : { x: tail.x + dir.x * 8, y: tail.y + dir.y * 8 };
          const nx = dir.x < -0.3 ? anchor.x - ns.w : dir.x > 0.3 ? anchor.x : anchor.x - ns.w / 2;
          const ny = dir.y < -0.3 ? anchor.y - ns.h : dir.y > 0.3 ? anchor.y : anchor.y - ns.h / 2;
          const side = m.label ? R + 8 : 8;
          const ref = m.label ? badgeC : tail;
          noteCands.push(
            { x: nx, y: ny, w: ns.w, h: ns.h },
            { x: ref.x - side - ns.w, y: ref.y - ns.h / 2, w: ns.w, h: ns.h },
            { x: ref.x + side, y: ref.y - ns.h / 2, w: ns.w, h: ns.h },
          );
        }

        noteCands.forEach((note, ni) => {
        let score = (di < 8 ? di * 30 : 240 + (di - 8) * 15) + li * 25 + ni * 20 + ai * 40; // prefer upper-left, short, centered
        const parts: [Box, number][] = [[lineBox(tail, tip, 2), OUTSIDE], ...(badge ? [[badge, OUTSIDE] as [Box, number]] : []), ...(note ? [[note, OUTSIDE_NOTE] as [Box, number]] : [])];
        for (const [p, cost] of parts) {
          if (!inside(p, doc, 0)) score += 1e9;  // cannot be shown at all
          else if (!inside(p, view)) score += cost; // outside the screenshot area
        }
        // collisions with other marks (the own element is avoided by construction)
        markBoxes.forEach((mb, j) => {
          if (j === i) return;
          const grown = { x: mb.x - 3, y: mb.y - 3, w: mb.w + 6, h: mb.h + 6 };
          if (segBox(tail, tip, grown)) score += 5e4;
          if (badge) score += overlap(grow(badge, GAP), grown) * 40;
          if (note) score += overlap(grow(note, GAP), grown) * 40;
        });
        if (note) score += overlap(note, box) * 40;
        if (badge) score += overlap(badge, box) * 40;
        // the own note must not sit on the own arrow
        if (note && segBox(tail, tip, note)) score += 3e4;
        // collisions with other arrows, badges and notes
        for (const l of placedLines) {
          if (l.mark === i) continue;
          if (segSeg(tail, tip, l.a, l.b)) score += 5e4;
          for (const p of [badge, note]) if (p && segBox(l.a, l.b, grow(p, 4))) score += 3e4;
        }
        for (const pb of placedBoxes) {
          if (pb.mark === i) continue;
          if (segBox(tail, tip, grow(pb.box, 4))) score += 5e4;
          if (badge) score += overlap(grow(badge, GAP), pb.box) * 60;
          if (note) score += overlap(grow(note, GAP), pb.box) * 60;
        }
        // covering page text: sample the line, area for badge/note
        for (let s = 1; s < 12; s++) {
          const p = { x: tail.x + ((tip.x - tail.x) * s) / 12, y: tail.y + ((tip.y - tail.y) * s) / 12 };
          if (local.some((o) => ptIn(p, o))) score += 400; // a line through text hides letters
        }
        for (const o of local) {
          if (badge) score += overlap(badge, o) * 5;
          if (note) score += overlap(note, o) * 1.5;
        }
        if (!best || score < best.score) best = { tail, tip, dir, badge, note, score };
        });
      });
    }));
    return best!;
  };

  const register = (i: number, plan: ArrowPlan) => {
    placedLines.push({ mark: i, a: plan.tail, b: plan.tip });
    if (plan.badge) placedBoxes.push({ mark: i, box: plan.badge });
    if (plan.note) placedBoxes.push({ mark: i, box: plan.note });
  };
  const unregister = (i: number) => {
    for (let k = placedLines.length - 1; k >= 0; k--) if (placedLines[k].mark === i) placedLines.splice(k, 1);
    for (let k = placedBoxes.length - 1; k >= 0; k--) if (placedBoxes[k].mark === i && !(marks[i].style === 'outline')) placedBoxes.splice(k, 1);
  };

  const arrowIdx = marks.map((m, i) => (m.style === 'arrow' ? i : -1)).filter((i) => i >= 0);

  // Greedy placement depends on the order: two arrows can block each other (e.g. cross like an X)
  // although swapping sides would be free. Try several orders and keep the best total.
  const solve = (order: number[]): number => {
    for (const i of arrowIdx) unregister(i);
    for (const i of order) register(i, (arrowPlan[i] = planArrow(i)));
    // refinement: each arrow again, with all the others in place
    for (let pass = 0; pass < 2; pass++) {
      for (const i of order) {
        unregister(i);
        arrowPlan[i] = planArrow(i);
        register(i, arrowPlan[i]!);
      }
    }
    return order.reduce((sum, i) => sum + arrowPlan[i]!.score, 0);
  };
  const permutations = (xs: number[]): number[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, k) => permutations([...xs.slice(0, k), ...xs.slice(k + 1)]).map((p) => [x, ...p]));
  const orders =
    arrowIdx.length <= 4
      ? permutations(arrowIdx)
      : [arrowIdx, [...arrowIdx].reverse(), ...arrowIdx.map((_, k) => [...arrowIdx.slice(k), ...arrowIdx.slice(0, k)])];
  let bestTotal = Infinity;
  let bestPlans: (ArrowPlan | undefined)[] = [];
  for (const order of orders) {
    const total = solve(order);
    if (total < bestTotal) {
      bestTotal = total;
      bestPlans = [...arrowPlan];
    }
    if (bestTotal < 1e4) break; // no collisions left – good enough
  }
  for (const i of arrowIdx) unregister(i);
  for (const i of arrowIdx) register(i, (arrowPlan[i] = bestPlans[i]!));

  placeOutlineNotes(); // second round: now that the arrows are fixed

  // ── draw ─────────────────────────────────────────────────────────────────
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');
  const el = (name: string, attrs: Record<string, string | number>) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.appendChild(node);
    return node;
  };
  const drawBadge = (box: Box, label: string) => {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    el('circle', { cx, cy, r: R + 2, fill: '#fff' });
    el('circle', { cx, cy, r: R, fill: theme.color });
    const t = el('text', {
      x: cx, y: cy + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-family': theme.fontFamily, 'font-size': 14, 'font-weight': 700, fill: theme.textColor,
    });
    t.textContent = label;
  };

  const decorations: { mark: number; box: Rect }[] = [];
  const toRect = (b: Box): Rect => ({ x: b.x, y: b.y, width: b.w, height: b.h });

  for (const m of args.masks ?? []) {
    el('rect', { x: m.x, y: m.y, width: m.width, height: m.height, fill: args.maskColor ?? '#c9ced8' });
  }

  marks.forEach((m, i) => {
    const b = markBoxes[i];
    if (m.style === 'outline') {
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, fill: 'none', stroke: '#fff', 'stroke-width': 7, 'stroke-opacity': 0.9 });
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, fill: 'none', stroke: theme.color, 'stroke-width': 3 });
      decorations.push({ mark: i, box: toRect({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }) });
      if (badgeOf[i]) {
        drawBadge(badgeOf[i]!, m.label!);
        decorations.push({ mark: i, box: toRect(badgeOf[i]!) });
      }
    } else {
      const plan = arrowPlan[i]!;
      // shaft + head as separate shapes, both with the same white outline (a SVG marker cannot get one)
      const dx = plan.tip.x - plan.tail.x, dy = plan.tip.y - plan.tail.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;   // along the arrow
      const nx = -uy, ny = ux;              // across
      const HL = 18, HW = 10;               // head length, half width
      const base = { x: plan.tip.x - ux * HL, y: plan.tip.y - uy * HL };
      const head = [
        `${plan.tip.x},${plan.tip.y}`,
        `${base.x + nx * HW},${base.y + ny * HW}`,
        `${base.x - nx * HW},${base.y - ny * HW}`,
      ].join(' ');
      // the shaft stops inside the head, so its round cap never shows past the tip
      const shaftEnd = { x: base.x + ux * 4, y: base.y + uy * 4 };
      const shaft = { x1: plan.tail.x, y1: plan.tail.y, x2: shaftEnd.x, y2: shaftEnd.y, 'stroke-linecap': 'round' };
      const HALO = 2.5; // outline width, same as around the shaft ((9 - 4) / 2)
      el('line', { ...shaft, stroke: '#fff', 'stroke-width': 4 + HALO * 2, 'stroke-opacity': 0.9 });
      el('polygon', { points: head, fill: '#fff', stroke: '#fff', 'stroke-width': HALO * 2, 'stroke-linejoin': 'round', 'fill-opacity': 0.9, 'stroke-opacity': 0.9 });
      el('line', { ...shaft, stroke: theme.color, 'stroke-width': 4 });
      el('polygon', { points: head, fill: theme.color, stroke: theme.color, 'stroke-width': 1, 'stroke-linejoin': 'round' });
      decorations.push({ mark: i, box: toRect(lineBox(plan.tail, plan.tip, 8)) });
      if (plan.badge) {
        drawBadge(plan.badge, m.label!);
        decorations.push({ mark: i, box: toRect(plan.badge) });
      }
    }
  });
  layer.insertBefore(svg, layer.firstChild);

  const notes: { mark: number; box: Rect }[] = [];
  marks.forEach((m, i) => {
    const n = noteEls[i];
    const box = m.style === 'arrow' ? arrowPlan[i]?.note : outlineNote[i];
    if (!n || !box) return;
    const x = Math.min(Math.max(4, box.x), width - box.w - 4);
    const y = Math.min(Math.max(4, box.y), height - box.h - 4);
    Object.assign(n.style, { left: x + 'px', top: y + 'px', visibility: '' }); // inherit from the layer
    const r = toRect({ x: x - 4, y: y - 4, w: box.w + 8, h: box.h + 8 });
    notes.push({ mark: i, box: r });
    decorations.push({ mark: i, box: r });
  });

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

  return {
    decorations,
    arrows: arrowIdx.map((i) => ({ mark: i, tail: arrowPlan[i]!.tail, tip: arrowPlan[i]!.tip })),
    notes,
    badges: [
      ...marks.map((_, i) => (badgeOf[i] ? { mark: i, box: toRect(badgeOf[i]!) } : undefined)),
      ...arrowIdx.map((i) => (arrowPlan[i]!.badge ? { mark: i, box: toRect(arrowPlan[i]!.badge!) } : undefined)),
    ].filter((x): x is { mark: number; box: Rect } => Boolean(x)),
    view: toRect(view),
  };
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

/**
 * Checks a finished layout (Node side): annotations outside the screenshot, crossing arrows,
 * arrows through other marks, overlapping badges/notes. Returns human-readable problems.
 */
export function layoutProblems(layout: OverlayLayout, marks: { rect: Rect }[]): string[] {
  const ov = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const inside = (a: Rect, v: Rect) => a.x >= v.x - 1 && a.y >= v.y - 1 && a.x + a.width <= v.x + v.width + 1 && a.y + a.height <= v.y + v.height + 1;
  type P = { x: number; y: number };
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const segSeg = (a: P, b: P, c: P, d: P) => cross(c, d, a) * cross(c, d, b) < 0 && cross(a, b, c) * cross(a, b, d) < 0;
  const segBox = (a: P, b: P, r: Rect) => {
    const p = [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
    const inBox = (q: P) => q.x > r.x && q.x < r.x + r.width && q.y > r.y && q.y < r.y + r.height;
    return inBox(a) || inBox(b) || [0, 1, 2, 3].some((i) => segSeg(a, b, p[i], p[(i + 1) % 4]));
  };
  const n = (i: number) => `Markierung ${i + 1}`;
  const out = new Set<string>();
  const boxes = [...layout.badges, ...layout.notes];
  for (const b of boxes) if (!inside(b.box, layout.view)) out.add(`${n(b.mark)}: Nummer/Hinweis liegt außerhalb des Screenshots`);
  for (const a of layout.arrows) {
    for (const p of [a.tail, a.tip]) if (!inside({ x: p.x, y: p.y, width: 0, height: 0 }, layout.view)) out.add(`${n(a.mark)}: Pfeil ragt aus dem Screenshot`);
    for (const b of layout.arrows) if (b.mark > a.mark && segSeg(a.tail, a.tip, b.tail, b.tip)) out.add(`Pfeile von ${n(a.mark)} und ${n(b.mark)} kreuzen sich`);
    for (const b of boxes) if (b.mark !== a.mark && segBox(a.tail, a.tip, b.box)) out.add(`Pfeil von ${n(a.mark)} läuft durch Nummer/Hinweis von ${n(b.mark)}`);
    marks.forEach((m, j) => {
      if (j !== a.mark && segBox(a.tail, a.tip, m.rect)) out.add(`Pfeil von ${n(a.mark)} läuft über das markierte Element ${n(j)}`);
    });
  }
  for (const b of boxes)
    marks.forEach((m, j) => {
      if (j !== b.mark && ov(b.box, m.rect)) out.add(`Nummer/Hinweis von ${n(b.mark)} liegt auf dem markierten Element ${n(j)}`);
    });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (boxes[i].mark !== boxes[j].mark && ov(boxes[i].box, boxes[j].box)) out.add(`Nummern/Hinweise von ${n(boxes[i].mark)} und ${n(boxes[j].mark)} überlappen`);
  return [...out];
}
