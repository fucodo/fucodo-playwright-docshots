import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
// Extending playwright-bdd's test (not @playwright/test) makes mergeTests(appTest, docshotTest)
// a valid base for createBdd().
import { test as base } from 'playwright-bdd';
import {
  decoratedRect, documentSizeInPage, drawOverlaysInPage, measureInPage, OVERLAY_ATTR,
  removeOverlaysInPage, union, type MarkStyle, type MeasuredMark, type OverlayTheme, type Rect,
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
  id: string;
  project: string;
  variant: DocshotVariant;
  file: string;
  cleanFile?: string;
  marks: { label?: string; note?: string; style: MarkStyle; rect: Rect }[];
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

export class Docshot {
  private marks: PendingMark[] = [];
  private masks: Locator[] = [];

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

  async capture(options: CaptureOptions = {}): Promise<ManifestEntry> {
    const { page, opts, testInfo } = this;
    const id = options.name ? `${this.id}-${slug(options.name)}` : this.id;

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

    let clip: Rect | undefined;
    if (options.target) {
      const targetRect = await options.target.evaluate(measureInPage);
      const pad = opts.docshotPadding;
      const covered = union([
        { x: targetRect.x - pad, y: targetRect.y - pad, width: targetRect.width + pad * 2, height: targetRect.height + pad * 2 },
        ...measured.filter((m) => intersects(m.rect, targetRect)).map(decoratedRect),
      ]);
      const doc = await page.evaluate(documentSizeInPage);
      clip = clampRect(covered, doc);
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

    if (cleanFile) await shot(cleanFile);
    if (measured.length) {
      await page.evaluate(drawOverlaysInPage, { marks: measured, theme: opts.docshotTheme, attr: OVERLAY_ATTR });
    }
    try {
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
      source: readDocshotTags(testInfo.tags).source,
      test: testInfo.titlePath.join(' › '),
    };
    fs.mkdirSync(opts.docshotManifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(opts.docshotManifestDir, `${slug(id)}__${slug(testInfo.project.name)}.json`),
      JSON.stringify(entry, null, 2),
    );
    await testInfo.attach(`docshot ${id}`, { path: file, contentType: 'image/png' });

    this.marks = []; // highlights belong to one capture
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

  docshot: async ({ page, docshotOutput, docshotKeepClean, docshotVariant, docshotTheme, docshotClock, docshotPadding, docshotManifestDir, docshotMaskColor }, use, testInfo) => {
    await use(new Docshot(page, testInfo, {
      docshotOutput, docshotKeepClean, docshotVariant, docshotTheme, docshotClock, docshotPadding, docshotManifestDir, docshotMaskColor,
    }));
  },
});
