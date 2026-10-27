import fs from 'node:fs';
import path from 'node:path';
import type { PlaywrightTestConfig, Project } from '@playwright/test';
import type * as PlaywrightTest from '@playwright/test';
import type * as PlaywrightBdd from 'playwright-bdd';
import { peer } from './peer';
import type { DocshotOptions, DocshotVariant } from './fixture';
import type { OverlayTheme } from './overlay';
import { extractAll } from './sources/extract';
import { checkSetup, formatWarnings } from './setup';
import { DEFAULT_VIDEO, FFMPEG_HINT, findFfmpeg, withFormat, type VideoOptions } from './video';
import { DEFAULT_IMAGE, withImageFormat, type ImageFormat } from './image';
import { hashFiles, sha, writeStateInput } from './update';
import fg from 'fast-glob';

const VIDEO_STEP = /\b(?:starte\b.*\b(?:Video|Aufnahme)|(?:Video|Aufnahme)\b.*\bstarte|start (?:a |the )?(?:video|recording))\b/i;
import type { DocshotLanguage } from './sources/rst';

export type ViewportSpec =
  | string // Playwright device name, e.g. "iPhone 13"
  | { width: number; height: number; deviceScaleFactor?: number; isMobile?: boolean; hasTouch?: boolean; userAgent?: string };

export interface LanguageSpec {
  /** Browser locale, default = language key */
  locale?: string;
  /** Extra HTTP headers, default { 'Accept-Language': <key> } */
  headers?: Record<string, string>;
}

export interface DocshotConfig {
  /** Your normal Playwright config – baseURL, timeouts, reporters, use … are reused. */
  base?: PlaywrightTestConfig;
  /** Project root; all paths are relative to it. Default: process.cwd() */
  rootDir?: string;
  /** Default language of embedded RST blocks (Gherkin keywords). Can be a function per file. */
  language?: DocshotLanguage | ((rstFile: string) => DocshotLanguage);
  sources: {
    /** RST files with embedded `.. docshot:` blocks */
    rst?: string[];
    /** Hand-written .feature files */
    features?: string[];
  };
  /** Your step files – must include the file that calls registerDocshotSteps(). */
  steps: string[];
  variants: {
    viewports: Record<string, ViewportSpec>;
    schemes?: ('light' | 'dark')[];
    languages?: Record<string, LanguageSpec | Record<string, string>>;
  };
  /** Output template: {id} {viewport} {scheme} {lang} {project}. Default below. The extension follows imageFormat. */
  output?: string;
  /** 'webp' (default), 'png' or 'jpeg'. WebP needs Chromium or Firefox. */
  imageFormat?: ImageFormat;
  /** 1–100 for webp and jpeg. Default 90; 100 = lossless WebP, but larger than PNG */
  imageQuality?: number;
  /** Also write *.clean.<ext> without overlays. Default false. `docshots test --no-clean` skips them for one run. */
  keepClean?: boolean;
  /** Freeze browser time (ISO), e.g. '2026-09-01T09:30:00+02:00' */
  clock?: string;
  /** Overlay colors, e.g. { color: '#d50c2f' } */
  theme?: Partial<OverlayTheme>;
  /**
   * Videos ("Dann starte ein Video" … "Dann beende das Video").
   * Default output: Documentation/Videos/{id}/{viewport}-{scheme}-{lang}.mp4
   */
  video?: Partial<VideoOptions>;
  /**
   * Remembers which recipes were rendered with which inputs (for "docshots update").
   * Commit it together with the images. Default: docshots.lock.json in the project root.
   */
  lockFile?: string;
  /** Fill colour for masked (hidden) areas. Default '#c9ced8' */
  maskColor?: string;
  /** Padding around element screenshots. Default 16 */
  padding?: number;
  /** Working directory for generated files. Default '.docshots' */
  workDir?: string;
  /**
   * Browser for all variants. Device presets bring their own (iPhone → WebKit);
   * by default everything runs in Chromium for consistent rendering.
   */
  browserName?: 'chromium' | 'firefox' | 'webkit' | 'device-default';
  /** Passed through to defineBddConfig() */
  bdd?: Record<string, unknown>;
}

export const DEFAULT_OUTPUT = 'Documentation/Images/Screenshots/{id}/{viewport}-{scheme}-{lang}.webp';

const EXTRACTED_ENV = 'DOCSHOTS_EXTRACTED';
/** Set by `docshots test --no-clean`: skip *.clean.<ext> for this run, whatever keepClean says. */
export const NO_CLEAN_ENV = 'DOCSHOTS_NO_CLEAN';

function viewportUse(spec: ViewportSpec, browserName: DocshotConfig['browserName']) {
  const { devices } = peer<typeof PlaywrightTest>('@playwright/test');
  if (typeof spec === 'string') {
    const device = devices[spec];
    if (!device) throw new Error(`Unbekanntes Playwright-Gerät "${spec}"`);
    const { defaultBrowserType, ...rest } = device;
    return { ...rest, browserName: browserName === 'device-default' ? defaultBrowserType : (browserName ?? 'chromium') };
  }
  const { width, height, ...rest } = spec;
  return {
    viewport: { width, height },
    ...rest,
    browserName: browserName === 'device-default' || !browserName ? 'chromium' : browserName,
  } as const;
}

function languageUse(key: string, spec: LanguageSpec | Record<string, string> | undefined) {
  const isSpec = spec && ('locale' in spec || 'headers' in spec);
  const headers = isSpec ? (spec as LanguageSpec).headers : (spec as Record<string, string> | undefined);
  return {
    locale: (isSpec && (spec as LanguageSpec).locale) || key,
    extraHTTPHeaders: headers && Object.keys(headers).length ? headers : { 'Accept-Language': key },
  };
}

export function defineDocshotConfig(cfg: DocshotConfig): PlaywrightTestConfig {
  const rootDir = path.resolve(cfg.rootDir ?? process.cwd());
  const workDir = path.resolve(rootDir, cfg.workDir ?? '.docshots');
  const generatedDir = path.join(workDir, 'generated');

  // Extract once in the main process; workers inherit the env flag.
  if (!process.env[EXTRACTED_ENV]) {
    const extracted = extractAll({
      rootDir,
      rstPatterns: cfg.sources.rst ?? [],
      featurePatterns: cfg.sources.features ?? [],
      generatedDir,
      language: cfg.language ?? 'de',
    });
    process.env[EXTRACTED_ENV] = '1';
    // missing steps entry / personas file etc. → loud warning instead of "no step definitions"
    const warnings = checkSetup(rootDir, cfg.steps);
    const scenarioFiles = [...extracted.generatedFiles, ...fg.sync(cfg.sources.features ?? [], { cwd: rootDir, absolute: true })];
    const usesVideo = scenarioFiles.some((f) => VIDEO_STEP.test(fs.readFileSync(f, 'utf8')));
    if (usesVideo && !findFfmpeg(cfg.video?.ffmpeg)) warnings.push({ message: 'Szenarien nehmen Videos auf, aber ffmpeg wurde nicht gefunden.', hint: FFMPEG_HINT });
    if (warnings.length) process.stderr.write(formatWarnings(warnings));
    if (process.env.DOCSHOTS_ANALYZE !== '1') {
      // leftovers of an interrupted `docshots from-image`
      fs.rmSync(path.join(workDir, 'bdd-gen', path.relative(rootDir, path.join(workDir, 'analyze'))), { recursive: true, force: true });
    }
  }

  const features = [
    ...(cfg.sources.features ?? []).map((p) => path.resolve(rootDir, p)),
    path.join(generatedDir, '**/*.feature'),
    // only while `docshots from-image` runs
    ...(process.env.DOCSHOTS_ANALYZE === '1' ? [path.join(workDir, 'analyze', '**/*.feature')] : []),
  ].map((p) => p.split(path.sep).join('/'));

  const { defineBddConfig } = peer<typeof PlaywrightBdd>('playwright-bdd');
  // inputs for the update mode: everything that changes the look of every recipe
  if (process.env.DOCSHOTS_ANALYZE !== '1') {
    let version = '0';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      version = require('../package.json').version;
    } catch {
      /* not packaged */
    }
    writeStateInput(workDir, {
      rootDir,
      workDir,
      lockFile: path.resolve(rootDir, cfg.lockFile ?? 'docshots.lock.json'),
      features: features.filter((f) => !f.includes('/analyze/')),
      language: typeof cfg.language === 'string' ? cfg.language : 'de',
      global: sha({
        version,
        variants: cfg.variants, output: cfg.output, keepClean: cfg.keepClean,
        // the effective format: a new default changes every file
        imageFormat: cfg.imageFormat ?? DEFAULT_IMAGE.format, imageQuality: cfg.imageQuality ?? DEFAULT_IMAGE.quality, clock: cfg.clock, theme: cfg.theme,
        padding: cfg.padding, maskColor: cfg.maskColor, video: cfg.video, browserName: cfg.browserName,
        steps: hashFiles(rootDir, cfg.steps),
      }),
      // which files every recipe should have, so "docshots update" also finds files missing from the lock file
      expected: {
        image: path.resolve(rootDir, withImageFormat(cfg.output ?? DEFAULT_OUTPUT, cfg.imageFormat ?? DEFAULT_IMAGE.format)),
        video: path.resolve(rootDir, withFormat(cfg.video?.output ?? DEFAULT_VIDEO.output, cfg.video?.format ?? DEFAULT_VIDEO.format)),
        // --no-clean: missing clean images don't count as missing in this run
        keepClean: (cfg.keepClean ?? false) && process.env[NO_CLEAN_ENV] !== '1',
        variants: Object.keys(cfg.variants.viewports).flatMap((viewport) =>
          (cfg.variants.schemes ?? ['light']).flatMap((scheme) =>
            Object.keys(cfg.variants.languages ?? { de: {} }).map((lang) => ({ project: `${viewport}-${scheme}-${lang}`, viewport, scheme, lang })),
          ),
        ),
      },
    });
  }

  const testDir = defineBddConfig({
    features,
    steps: cfg.steps.map((p) => path.resolve(rootDir, p).split(path.sep).join('/')),
    featuresRoot: rootDir,
    outputDir: path.join(workDir, 'bdd-gen'),
    language: typeof cfg.language === 'string' ? cfg.language : 'de',
    missingSteps: 'fail-on-gen',
    ...cfg.bdd,
  });

  const viewports = cfg.variants.viewports;
  const schemes = cfg.variants.schemes ?? ['light'];
  const languages = cfg.variants.languages ?? { de: {} };
  const theme: OverlayTheme = {
    color: '#d50c2f',
    textColor: '#ffffff',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    ...cfg.theme,
  };

  const image = { format: cfg.imageFormat ?? DEFAULT_IMAGE.format, quality: cfg.imageQuality ?? DEFAULT_IMAGE.quality };
  const output = withImageFormat(cfg.output ?? DEFAULT_OUTPUT, image.format);

  const projects: Project[] = [];
  for (const [vpName, vpSpec] of Object.entries(viewports)) {
    for (const scheme of schemes) {
      for (const [lang, langSpec] of Object.entries(languages)) {
        const variant: DocshotVariant = { viewport: vpName, scheme, lang };
        const docshotUse: Partial<DocshotOptions> = {
          docshotVariant: variant,
          docshotOutput: path.resolve(rootDir, output),
          docshotImage: image,
          // the override is not part of the fingerprint: a run without clean images doesn't outdate recipes
          docshotKeepClean: (cfg.keepClean ?? false) && process.env[NO_CLEAN_ENV] !== '1',
          docshotTheme: theme,
          docshotClock: cfg.clock,
          docshotPadding: cfg.padding ?? 16,
          docshotManifestDir: path.join(workDir, 'manifest'),
          docshotMaskColor: cfg.maskColor ?? '#c9ced8',
          docshotVideo: {
            ...DEFAULT_VIDEO,
            ...cfg.video,
            output: path.resolve(rootDir, cfg.video?.output ?? DEFAULT_VIDEO.output),
          },
        };
        projects.push({
          name: `${vpName}-${scheme}-${lang}`,
          metadata: { docshot: variant },
          use: {
            ...cfg.base?.use,
            ...viewportUse(vpSpec, cfg.browserName),
            colorScheme: scheme,
            ...languageUse(lang, langSpec),
            ...docshotUse,
          } as Project['use'],
        });
      }
    }
  }

  const { projects: _ignored, testDir: _td, testMatch: _tm, ...base } = cfg.base ?? {};
  void _ignored; void _td; void _tm;

  return {
    ...base,
    testDir,
    outputDir: path.join(workDir, 'test-results'),
    fullyParallel: base.fullyParallel ?? true,
    reporter: base.reporter ?? [['list'], ['html', { open: 'never', outputFolder: path.join(workDir, 'report') }]],
    projects,
    metadata: { ...base.metadata, docshots: { rootDir, workDir, generatedDir, output } },
  };
}
