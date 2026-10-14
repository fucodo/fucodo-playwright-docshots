import fs from 'node:fs';
import path from 'node:path';
import type { PlaywrightTestConfig, Project } from '@playwright/test';
import type * as PlaywrightTest from '@playwright/test';
import type * as PlaywrightBdd from 'playwright-bdd';
import { peer } from './peer';
import type { DocshotOptions, DocshotVariant } from './fixture';
import type { OverlayTheme } from './overlay';
import { extractAll } from './sources/extract';
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
  /** Output template: {id} {viewport} {scheme} {lang} {project}. Default below. */
  output?: string;
  /** Also write *.clean.png without overlays. Default false */
  keepClean?: boolean;
  /** Freeze browser time (ISO), e.g. '2026-09-01T09:30:00+02:00' */
  clock?: string;
  /** Overlay colors, e.g. { color: '#d50c2f' } */
  theme?: Partial<OverlayTheme>;
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

export const DEFAULT_OUTPUT = 'Documentation/Images/Screenshots/{id}/{viewport}-{scheme}-{lang}.png';

const EXTRACTED_ENV = 'DOCSHOTS_EXTRACTED';

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
    extractAll({
      rootDir,
      rstPatterns: cfg.sources.rst ?? [],
      featurePatterns: cfg.sources.features ?? [],
      generatedDir,
      language: cfg.language ?? 'de',
    });
    process.env[EXTRACTED_ENV] = '1';
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

  const projects: Project[] = [];
  for (const [vpName, vpSpec] of Object.entries(viewports)) {
    for (const scheme of schemes) {
      for (const [lang, langSpec] of Object.entries(languages)) {
        const variant: DocshotVariant = { viewport: vpName, scheme, lang };
        const docshotUse: Partial<DocshotOptions> = {
          docshotVariant: variant,
          docshotOutput: path.resolve(rootDir, cfg.output ?? DEFAULT_OUTPUT),
          docshotKeepClean: cfg.keepClean ?? false,
          docshotTheme: theme,
          docshotClock: cfg.clock,
          docshotPadding: cfg.padding ?? 16,
          docshotManifestDir: path.join(workDir, 'manifest'),
          docshotMaskColor: cfg.maskColor ?? '#c9ced8',
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
    metadata: { ...base.metadata, docshots: { rootDir, workDir, generatedDir, output: cfg.output ?? DEFAULT_OUTPUT } },
  };
}
