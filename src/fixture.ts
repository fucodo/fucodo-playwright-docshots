import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
// Extending playwright-bdd's test (not @playwright/test) makes mergeTests(appTest, docshotTest)
// a valid base for createBdd().
import type * as PlaywrightBdd from 'playwright-bdd';
import { peer } from './peer';
const { test: base } = peer<typeof PlaywrightBdd>('playwright-bdd');
import {
  documentSizeInPage, drawOverlaysInPage, measureInPage, OVERLAY_ATTR,
  layoutProblems, removeOverlaysInPage, setOverlayVisibleInPage, union, type CaptureMode, type OverlayLayout, type MarkStyle, type MeasuredMark, type OverlayTheme, type Rect,
} from './overlay';

export interface DocshotVariant {
  viewport: string;
  scheme: 'light' | 'dark';
  lang: string;
}

export interface DocshotOptions {
  /** Absolute path template: {id} {viewport} {scheme} {lang} {project} */
  docshotOutput: string;
  /** Also write <name>.clean.png without overlays */
  docshotKeepClean: boolean;
  docshotVariant: DocshotVariant;
  docshotTheme: OverlayTheme;
  /** Freeze the browser clock at this ISO date/time (undefined = real time) */
  docshotClock: string | undefined;
  /** Padding around element screenshots in px */
  docshotPadding: number;
  /** Directory for per-capture manifest entries (absolute) */
  docshotManifestDir: string;
  /** Fill colour for masked areas */
  docshotMaskColor: string;
  /** Video recording settings (output template is absolute) */
  docshotVideo: VideoOptions;
}

export interface VideoStartOptions {
  /** Crop the video to this element (plus padding) */
  target?: Locator;
  /** Extra name, for more than one video per scenario: <id>-<name> */
  name?: string;
}

export interface CaptureOptions {
  /** Crop to this element (plus padding and the highlights around it) */
  target?: Locator;
  /** Capture the whole scrollable page instead of the viewport */
  fullPage?: boolean;
  /** Extra name, for more than one screenshot per scenario: <id>-<name> */
  name?: string;
}

export interface ManifestEntry {
  /** 'screenshot' (default) or 'video' */
  kind?: 'screenshot' | 'video';
  id: string;
  project: string;
  variant: DocshotVariant;
  file: string;
  cleanFile?: string;
  marks: { label?: string; note?: string; style: MarkStyle; rect: Rect }[];
  /** where arrows, badges and notes ended up (document coordinates) */
  layout?: OverlayLayout;
  /** videos: length in seconds and size in pixels */
  duration?: number;
  width?: number;
  height?: number;
  source?: string;
  test: string;
}

interface PendingMark {
  target: Locator;
  description: string;
  style: MarkStyle;
  label?: string;
  note?: string;
}

const DEFAULT_THEME: OverlayTheme = {
  color: '#d50c2f',
  textColor: '#ffffff',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

import { slug } from './util';
export { slug };
import { DEFAULT_VIDEO, encodeVideo, withFormat, type Frame, type Region, type VideoOptions } from './video';

/** Reads @id:, @viewports:, @schemes:, @lang:/@languages: tags of the current test. */
export function readDocshotTags(tags: string[]) {
  const list = (prefixes: string[]) => {
    for (const t of tags) {
      for (const p of prefixes) {
        if (t.toLowerCase().startsWith(`@${p}:`)) return t.slice(p.length + 2).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return undefined;
  };
  return {
    id: list(['id'])?.[0],
    viewports: list(['viewports', 'viewport']),
    schemes: list(['schemes', 'scheme']),
    languages: list(['languages', 'lang', 'language']),
    source: list(['source'])?.[0],
  };
}

interface Recording {
  id: string;
  file: string;
  frames: Frame[];
  /** time ranges (ms, frame clock) to cut out – screenshots taken during the recording */
  freezes: [number, number][];
  /** crop in CSS pixels of the viewport (element videos) */
  region?: Region;
  actions?: { [Symbol.dispose]?: () => void; dispose?: () => Promise<void> | void };
}

type ScreencastApi = {
  start(o: { onFrame: (f: Frame) => void; quality?: number; size?: { width: number; height: number } }): Promise<unknown>;
  stop(): Promise<void>;
  showActions?(o: Record<string, unknown>): Promise<unknown>;
  showChapter?(title: string, o?: { description?: string; duration?: number }): Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Docshot {
  private marks: PendingMark[] = [];
  private masks: Locator[] = [];
  private recording: Recording | undefined;
  /** Layout of the annotations of the last capture (for tests and debugging). */
  lastLayout: OverlayLayout | undefined;

  constructor(
    private readonly page: Page,
    readonly testInfo: TestInfo,
    private readonly opts: DocshotOptions,
  ) {}

  /** Same page and settings, different output (used for previews, e.g. by from-image). */
  withOutput(outputTemplate: string, manifestDir: string): Docshot {
    return new Docshot(this.page, this.testInfo, { ...this.opts, docshotOutput: outputTemplate, docshotManifestDir: manifestDir });
  }

  /** Where a capture with this ID would be written in the current variant. */
  plannedFile(id: string): string {
    return fillTemplate(this.opts.docshotOutput, { id, ...this.opts.docshotVariant, project: this.testInfo.project.name });
  }

  /** Forget highlights and masks (used when a dry run is retried). */
  reset(): void {
    this.marks = [];
    this.masks = [];
  }

  /** Screenshot ID: @id: tag, otherwise the scenario/test title. */
  get id(): string {
    return slug(readDocshotTags(this.testInfo.tags).id ?? this.testInfo.title);
  }

  /** Outline an element, optionally with a numbered badge and a note. */
  highlight(target: Locator, options: { label?: string; note?: string; description?: string } = {}): this {
    this.marks.push({ target, style: 'outline', label: options.label, note: options.note, description: options.description ?? String(target) });
    return this;
  }

  /** Point at an element with an arrow. */
  pointAt(target: Locator, options: { label?: string; note?: string; description?: string } = {}): this {
    this.marks.push({ target, style: 'arrow', label: options.label, note: options.note, description: options.description ?? String(target) });
    return this;
  }

  /** Hide personal or volatile data (applies to all following captures). */
  mask(target: Locator): this {
    this.masks.push(target);
    return this;
  }

  // ── markers ───────────────────────────────────────────────────────────────

  /**
   * Removes markers: all of them, the ones with a badge label ("1"),
   * or the ones on a target (description as written in the step, e.g. 'Feld "Vorname"').
   * While a video is recording, they disappear from the video right away.
   */
  async hideMarks(filter: { label?: string; description?: string } = {}): Promise<number> {
    const before = this.marks.length;
    const norm = (v: string) => v.replace(/^(den|die|das|dem|der|the) /i, '').toLowerCase();
    this.marks = this.marks.filter((m) => {
      if (filter.label !== undefined) return m.label !== filter.label;
      if (filter.description !== undefined) return norm(m.description) !== norm(filter.description);
      return false;
    });
    const removed = before - this.marks.length;
    if (removed === 0 && (filter.label !== undefined || filter.description !== undefined)) {
      const what = filter.label !== undefined ? `mit der Nummer "${filter.label}"` : `auf ${filter.description}`;
      const known = this.marks.map((m) => (m.label ? `"${m.label}" (${m.description})` : m.description)).join(', ') || 'keine';
      throw new Error(`Keine Markierung ${what} vorhanden. Aktuelle Markierungen: ${known}`);
    }
    if (this.recording) await this.refreshLive();
    return removed;
  }

  // ── video ─────────────────────────────────────────────────────────────────

  get isRecording(): boolean {
    return Boolean(this.recording);
  }

  private screencast(): ScreencastApi {
    const sc = (this.page as Page & { screencast?: ScreencastApi }).screencast;
    if (!sc || typeof sc.start !== 'function') {
      throw new Error('Videos brauchen page.screencast – bitte @playwright/test auf Version 1.59 oder neuer aktualisieren.');
    }
    return sc;
  }

  async startVideo(options: VideoStartOptions = {}): Promise<void> {
    if (this.recording) throw new Error(`Es läuft bereits ein Video ("${this.recording.id}") – erst beenden, dann ein neues starten.`);
    const { page, opts, testInfo } = this;
    const video = opts.docshotVideo;
    const id = options.name ? `${this.id}-${slug(options.name)}` : this.id;
    const sc = this.screencast();

    let region: Region | undefined;
    if (options.target) {
      await options.target.scrollIntoViewIfNeeded();
      await this.settle();
      const box = await options.target.boundingBox();
      if (!box) throw new Error('Das Element für das Video ist nicht sichtbar.');
      const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
      const p = video.padding;
      const x = Math.max(0, box.x - p);
      const y = Math.max(0, box.y - p);
      region = { x, y, width: Math.min(vp.width, box.x + box.width + p) - x, height: Math.min(vp.height, box.y + box.height + p) - y };
    } else {
      await this.settle();
    }

    const file = withFormat(fillTemplate(video.output, { id, ...opts.docshotVariant, project: testInfo.project.name }), video.format);
    const rec: Recording = { id, file, frames: [], freezes: [], region };
    // without a size Playwright scales frames down to fit 800 px
    const vpSize = page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
    await sc.start({
      size: { width: vpSize.width, height: vpSize.height },
      quality: video.quality,
      onFrame: (f) => rec.frames.push({ data: f.data, timestamp: f.timestamp, viewportWidth: f.viewportWidth, viewportHeight: f.viewportHeight }),
    });
    this.recording = rec;
    if (video.cursor && typeof sc.showActions === 'function') {
      rec.actions = (await sc.showActions({
        cursor: 'pointer',
        duration: Math.max(400, Math.min(1200, video.stepDelay)),
        style: {
          point: `width: 34px; height: 34px; border-radius: 50%; border: 3px solid ${opts.docshotTheme.color}; background: ${opts.docshotTheme.color}33`,
          title: 'display: none',
        },
      })) as Recording['actions'];
    }
    await this.refreshLive();
  }

  async stopVideo(): Promise<ManifestEntry> {
    const rec = this.recording;
    if (!rec) throw new Error('Es läuft kein Video, das beendet werden könnte.');
    const { page, opts, testInfo } = this;
    const sc = this.screencast();
    await sleep(Math.min(400, opts.docshotVideo.stepDelay)); // let the last change reach a frame
    const endTimestamp = Date.now();
    try {
      await sc.stop();
    } finally {
      this.recording = undefined;
      try {
        if (rec.actions?.dispose) await rec.actions.dispose();
        else rec.actions?.[Symbol.dispose]?.();
      } catch {
        /* already gone */
      }
      await page.evaluate(removeOverlaysInPage, OVERLAY_ATTR).catch(() => undefined);
    }

    const kept = rec.frames.filter((f) => !rec.freezes.some(([a, b]) => f.timestamp >= a && f.timestamp <= b));
    const out = encodeVideo({ frames: kept, endTimestamp, file: rec.file, options: opts.docshotVideo, region: rec.region });
    const entry: ManifestEntry = {
      kind: 'video',
      id: rec.id,
      project: testInfo.project.name,
      variant: opts.docshotVariant,
      file: out.file,
      marks: [],
      duration: Math.round(out.duration * 10) / 10,
      width: out.width,
      height: out.height,
      source: readDocshotTags(testInfo.tags).source,
      test: testInfo.titlePath.join(' › '),
    };
    fs.mkdirSync(opts.docshotManifestDir, { recursive: true });
    fs.writeFileSync(path.join(opts.docshotManifestDir, `video__${slug(rec.id)}__${slug(testInfo.project.name)}.json`), JSON.stringify(entry, null, 2));
    await testInfo.attach(`docshot video ${rec.id}`, { path: out.file, contentType: opts.docshotVideo.format === 'webm' ? 'video/webm' : 'video/mp4' });
    this.marks = []; // markers belong to the video
    return entry;
  }

  /** Title card in the video (only while recording). */
  async showTitle(title: string, description?: string): Promise<void> {
    if (!this.recording) return;
    const sc = this.screencast();
    const duration = Math.max(1500, this.opts.docshotVideo.markDelay * 2);
    if (typeof sc.showChapter === 'function') {
      await sc.showChapter(title, { description, duration });
      await sleep(duration + 200);
    }
  }

  /** Called by the steps after each step: keeps live markers on their elements and paces the video. */
  async afterStep(kind: 'action' | 'mark' | 'wait' | 'other'): Promise<void> {
    if (!this.recording) return;
    await this.refreshLive();
    const v = this.opts.docshotVideo;
    if (kind === 'mark') await sleep(v.markDelay);
    else if (kind === 'action') await sleep(v.stepDelay);
  }

  /** Redraws markers and masks while recording (elements may have moved after clicks). */
  private async refreshLive(): Promise<void> {
    const rec = this.recording;
    if (!rec) return;
    const { page, opts } = this;
    if (!this.marks.length && !this.masks.length) {
      await page.evaluate(removeOverlaysInPage, OVERLAY_ATTR).catch(() => undefined);
      return;
    }
    // measure first, then swap the layer in one go (drawOverlaysInPage replaces the old one)

    const measured: MeasuredMark[] = [];
    for (const mark of this.marks) {
      // elements may be gone after a click (dialog closed) – keep the marker for later, draw what is there
      const count = await mark.target.count().catch(() => 0);
      if (count === 0) continue;
      const rect = await mark.target.first().evaluate(measureInPage).catch(() => undefined);
      if (rect) measured.push({ rect, style: mark.style, label: mark.label, note: mark.note });
    }
    const masks: Rect[] = [];
    for (const m of this.masks) {
      const rects = await m
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
          }),
        )
        .catch(() => [] as Rect[]);
      masks.push(...rects);
    }
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const bounds = rec.region ? { x: rec.region.x + scroll.x, y: rec.region.y + scroll.y, width: rec.region.width, height: rec.region.height } : undefined;
    await page
      .evaluate(drawOverlaysInPage, {
        marks: measured, theme: opts.docshotTheme, attr: OVERLAY_ATTR,
        mode: (bounds ? 'crop' : 'viewport') as CaptureMode, bounds, masks, maskColor: opts.docshotMaskColor,
      })
      .catch(() => undefined);
  }

  async capture(options: CaptureOptions = {}): Promise<ManifestEntry> {
    const { page, opts, testInfo } = this;
    const id = options.name ? `${this.id}-${slug(options.name)}` : this.id;

    // a screenshot during a video: the video keeps showing the last frame meanwhile
    // (frames are delivered late, so the cut is done by frame timestamp when encoding)
    const rec = this.recording;
    const freezeStart = Date.now();
    if (rec) await page.evaluate(removeOverlaysInPage, OVERLAY_ATTR).catch(() => undefined);
    try {
      return await this.captureInner(options, id);
    } finally {
      if (rec) {
        await this.refreshLive();
        // frame timestamps can trail the paint a little – cut generously, then repaint after the cut
        const FRAME_LAG = 250;
        rec.freezes.push([freezeStart, Date.now() + FRAME_LAG]);
        await sleep(FRAME_LAG + 50);
        // screencast only sends frames on change – force one of the restored state
        await page
          .evaluate((attr) => {
            const el = document.querySelector(`[${attr}]`) as HTMLElement | null;
            const target = el ?? document.body;
            target.style.opacity = target.style.opacity === '0.999' ? '1' : '0.999';
          }, OVERLAY_ATTR)
          .catch(() => undefined);
      }
    }
  }

  private async captureInner(options: CaptureOptions, id: string): Promise<ManifestEntry> {
    const { page, opts, testInfo } = this;
    if (options.target) await options.target.scrollIntoViewIfNeeded();
    await this.settle();

    const measured: MeasuredMark[] = [];
    for (const mark of this.marks) {
      const count = await mark.target.count();
      if (count === 0) throw new Error(`Markiertes Element nicht gefunden: ${mark.description}`);
      if (count > 1) throw new Error(`Markierung ist nicht eindeutig (${count} Treffer): ${mark.description}`);
      const rect = await mark.target.evaluate(measureInPage);
      measured.push({ rect, style: mark.style, label: mark.label, note: mark.note });
    }

    // draw first: notes find their place in the page, the crop then follows the real positions
    let targetBounds: Rect | undefined;
    let targetRect: Rect | undefined;
    if (options.target) {
      targetRect = await options.target.evaluate(measureInPage);
      const pad = opts.docshotPadding;
      targetBounds = { x: targetRect.x - pad, y: targetRect.y - pad, width: targetRect.width + pad * 2, height: targetRect.height + pad * 2 };
    }
    const mode: CaptureMode = targetBounds ? 'crop' : options.fullPage ? 'page' : 'viewport';
    const layout: OverlayLayout | undefined = measured.length
      ? await page.evaluate(drawOverlaysInPage, { marks: measured, theme: opts.docshotTheme, attr: OVERLAY_ATTR, mode, bounds: targetBounds })
      : undefined;
    this.lastLayout = layout;

    let clip: Rect | undefined;
    if (targetRect && targetBounds) {
      // grow the crop by everything drawn for marks inside the target (arrows, badges, notes)
      const inTarget = new Set(measured.map((m, i) => (intersects(m.rect, targetRect!) ? i : -1)).filter((i) => i >= 0));
      const covered = union([targetBounds, ...(layout?.decorations ?? []).filter((d) => inTarget.has(d.mark)).map((d) => d.box)]);
      const doc = await page.evaluate(documentSizeInPage);
      clip = clampRect(covered, doc);
    }

    if (layout) {
      // element shots: the crop grew around the annotations – check against what is really shown
      if (clip) layout.view = clip;
      // unavoidable collisions (no free space left) are reported instead of silently drawn
      for (const problem of layoutProblems(layout, measured)) {
        testInfo.annotations.push({ type: 'docshot-layout', description: `${id}: ${problem}` });
        console.warn(`⚠ ${id} [${testInfo.project.name}]: ${problem}`);
      }
    }

    const variant = opts.docshotVariant;
    const file = fillTemplate(opts.docshotOutput, { id, ...variant, project: testInfo.project.name });
    const cleanFile = opts.docshotKeepClean ? file.replace(/(\.[a-z]+)$/i, '.clean$1') : undefined;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const shot = (p: string) =>
      page.screenshot({
        path: p,
        clip,
        fullPage: Boolean(clip) || Boolean(options.fullPage),
        animations: 'disabled',
        caret: 'hide',
        mask: this.masks,
        maskColor: opts.docshotMaskColor,
      });

    try {
      if (cleanFile) {
        if (measured.length) await page.evaluate(setOverlayVisibleInPage, { attr: OVERLAY_ATTR, visible: false });
        await shot(cleanFile);
        if (measured.length) await page.evaluate(setOverlayVisibleInPage, { attr: OVERLAY_ATTR, visible: true });
      }
      await shot(file);
    } finally {
      if (measured.length) await page.evaluate(removeOverlaysInPage, OVERLAY_ATTR);
    }

    const entry: ManifestEntry = {
      id,
      project: testInfo.project.name,
      variant,
      file,
      cleanFile,
      marks: measured.map((m) => ({ label: m.label, note: m.note, style: m.style, rect: m.rect })),
      layout,
      source: readDocshotTags(testInfo.tags).source,
      test: testInfo.titlePath.join(' › '),
    };
    fs.mkdirSync(opts.docshotManifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(opts.docshotManifestDir, `${slug(id)}__${slug(testInfo.project.name)}.json`),
      JSON.stringify(entry, null, 2),
    );
    await testInfo.attach(`docshot ${id}`, { path: file, contentType: 'image/png' });

    // highlights belong to one capture – except while a video runs, where they stay visible
    if (!this.recording) this.marks = [];
    return entry;
  }

  /** Let the page come to rest: network, fonts, pending animations. */
  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await this.page.evaluate(async () => {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
      // no focus rings / blinking text fields left over from typing
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function clampRect(r: Rect, doc: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const right = Math.min(doc.width, Math.ceil(r.x + r.width));
  const bottom = Math.min(doc.height, Math.ceil(r.y + r.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? slug(values[key]) : m));
}

export type DocshotFixtures = {
  docshot: Docshot;
  _docshotVariantFilter: void;
  _docshotClock: void;
};

/**
 * Merge this into your own test: `mergeTests(appTest, docshotTest)`.
 * Options are filled per project by defineDocshotConfig().
 */
export const docshotTest = base.extend<DocshotOptions & DocshotFixtures>({
  docshotOutput: [path.resolve('docshots/{id}/{project}.png'), { option: true }],
  docshotKeepClean: [false, { option: true }],
  docshotVariant: [{ viewport: 'default', scheme: 'light', lang: 'en' }, { option: true }],
  docshotTheme: [DEFAULT_THEME, { option: true }],
  docshotClock: [undefined, { option: true }],
  docshotPadding: [16, { option: true }],
  docshotManifestDir: [path.resolve('.docshots/manifest'), { option: true }],
  docshotMaskColor: ['#c9ced8', { option: true }],
  docshotVideo: [{ ...DEFAULT_VIDEO, output: path.resolve(DEFAULT_VIDEO.output) }, { option: true }],

  // Skip variants a scenario opted out of via @viewports: / @schemes: / @lang: tags.
  _docshotVariantFilter: [
    async ({ docshotVariant }, use, testInfo) => {
      const tags = readDocshotTags(testInfo.tags);
      const skip =
        (tags.viewports && !tags.viewports.includes(docshotVariant.viewport)) ||
        (tags.schemes && !tags.schemes.includes(docshotVariant.scheme)) ||
        (tags.languages && !tags.languages.includes(docshotVariant.lang));
      testInfo.skip(Boolean(skip), `Variante ${docshotVariant.viewport}/${docshotVariant.scheme}/${docshotVariant.lang} nicht angefordert`);
      await use();
    },
    { auto: true },
  ],

  // Freeze time before the first navigation, so "vor 3 Minuten" stays stable.
  _docshotClock: [
    async ({ page, docshotClock }, use) => {
      if (docshotClock) await page.clock.install({ time: new Date(docshotClock) });
      await use();
    },
    { auto: true },
  ],

  docshot: async ({ page, docshotOutput, docshotKeepClean, docshotVariant, docshotTheme, docshotClock, docshotPadding, docshotManifestDir, docshotMaskColor, docshotVideo }, use, testInfo) => {
    const docshot = new Docshot(page, testInfo, {
      docshotOutput, docshotKeepClean, docshotVariant, docshotTheme, docshotClock, docshotPadding, docshotManifestDir, docshotMaskColor, docshotVideo,
    });
    await use(docshot);
    // a forgotten "beende das Video" must not lose the recording
    if (docshot.isRecording) {
      const msg = 'Video wurde am Ende des Szenarios automatisch beendet – Schritt "Dann beende das Video" fehlt.';
      testInfo.annotations.push({ type: 'docshot-video', description: msg });
      console.warn(`⚠ ${docshot.id} [${testInfo.project.name}]: ${msg}`);
      await docshot.stopVideo().catch((e) => console.warn(`⚠ Video konnte nicht gespeichert werden: ${e instanceof Error ? e.message : e}`));
    }
  },
});
