import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { slug } from './util';

/**
 * Update mode: every scenario ("recipe") gets a fingerprint. docshots.lock.json remembers the
 * fingerprint and the produced files of the last successful run, so only new or changed
 * recipes (or ones with missing files) have to be rendered again.
 */

/** Written by defineDocshotConfig() while Playwright/bddgen loads the config, read by the CLI. */
export interface StateInput {
  rootDir: string;
  workDir: string;
  lockFile: string;
  /** absolute glob patterns of all feature files (hand-written + generated from RST) */
  features: string[];
  language: string;
  /** hash over everything that affects every recipe (config, package version, step files) */
  global: string;
}

export const STATE_INPUT_FILE = 'state-input.json';
export const ONLY_ENV = 'DOCSHOTS_ONLY';
export const RESULTS_DIR = 'results';

export interface Recipe {
  id: string;
  /** feature file, relative to rootDir */
  file: string;
  name: string;
  fingerprint: string;
}

export interface LockEntry {
  fingerprint: string;
  files: string[];
  source?: string;
  updated: string;
}

export interface LockFile {
  version: 1;
  recipes: Record<string, LockEntry>;
}

export interface RecipeStatus {
  recipe: Recipe;
  reason: 'neu' | 'geändert' | 'Dateien fehlen' | 'unverändert';
  missing?: string[];
}

export const sha = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 16);

export function writeStateInput(workDir: string, input: StateInput): void {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, STATE_INPUT_FILE), JSON.stringify(input, null, 2));
}

export function readStateInput(workDir: string): StateInput {
  const file = path.join(workDir, STATE_INPUT_FILE);
  if (!fs.existsSync(file)) throw new Error(`${file} fehlt – die Konfiguration wurde noch nicht geladen (erst "docshots lint" oder "docshots test").`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Hash of files matching globs (path + content), e.g. the project's step definitions. */
export function hashFiles(rootDir: string, patterns: string[]): string {
  const files = fg.sync(patterns, { cwd: rootDir, absolute: true }).sort();
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(path.relative(rootDir, f)).update('\0').update(fs.readFileSync(f)).update('\0');
  return h.digest('hex').slice(0, 16);
}

// ── Gherkin ────────────────────────────────────────────────────────────────

interface Pickle {
  name: string;
  tags: { name: string }[];
  steps: { text: string; argument?: unknown }[];
}

/** The Gherkin parser that ships with playwright-bdd – the same one that generates the tests. */
function gherkin() {
  const base = path.dirname(require.resolve('playwright-bdd/package.json', { paths: [process.cwd(), __dirname] }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const g = require(require.resolve('@cucumber/gherkin', { paths: [base] }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require(require.resolve('@cucumber/messages', { paths: [base] }));
  return { g, m };
}

export function collectRecipes(input: StateInput): Recipe[] {
  const { g, m } = gherkin();
  const files = fg.sync(input.features, { absolute: true }).sort();
  const byId = new Map<string, { file: string; name: string; parts: unknown[] }>();
  // generated from RST: show the RST file and line instead of the generated feature
  const sourceMap = readSourceMap(input.workDir);

  for (const file of files) {
    const rel = path.relative(input.rootDir, file).split(path.sep).join('/');
    const newId = m.IdGenerator.incrementing();
    const parser = new g.Parser(new g.AstBuilder(newId), new g.GherkinClassicTokenMatcher(input.language));
    const doc = parser.parse(fs.readFileSync(file, 'utf8'));
    const pickles: (Pickle & { astNodeIds?: string[] })[] = g.compile(doc, rel, newId);
    // scenario ast node id → line in the feature file
    const lines = new Map<string, number>();
    const walk = (children: { scenario?: { id: string; location: { line: number } }; rule?: { children: unknown[] } }[] = []) => {
      for (const c of children) {
        if (c.scenario) lines.set(c.scenario.id, c.scenario.location.line);
        if (c.rule) walk(c.rule.children as never);
      }
    };
    walk(doc.feature?.children);
    for (const p of pickles) {
      const tags = p.tags.map((t) => t.name).sort();
      if (tags.includes('@docshot-analyze')) continue; // temporary, from "docshots from-image"
      const idTag = tags.find((t) => /^@id:/i.test(t));
      const id = slug(idTag ? idTag.slice(4) : p.name);
      const line = (p.astNodeIds ?? []).map((n) => lines.get(n)).find((l) => l !== undefined);
      const mapped = sourceMap[rel];
      let where = line ? `${rel}:${line}` : rel;
      if (mapped) {
        let src: number | undefined;
        for (let l = line ?? 0; l > 0 && src === undefined; l--) src = mapped.lines[l];
        where = src ? `${mapped.source}:${src}` : mapped.source;
      }
      // scenario outlines: all examples belong to one recipe
      const entry = byId.get(id) ?? { file: where, name: p.name, parts: [] };
      entry.parts.push({ tags, steps: p.steps.map((s) => ({ text: s.text, argument: s.argument ?? null })) });
      byId.set(id, entry);
    }
  }

  return [...byId.entries()].map(([id, e]) => ({
    id,
    file: e.file,
    name: e.name,
    fingerprint: sha({ id, parts: e.parts, global: input.global }),
  }));
}

function readSourceMap(workDir: string): Record<string, { source: string; lines: Record<number, number> }> {
  const file = path.join(workDir, 'generated', 'sourcemap.json');
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // keys in the source map are relative to rootDir and point into the generated folder
  return raw;
}

// ── lock file ──────────────────────────────────────────────────────────────

export function readLock(file: string): LockFile {
  if (!fs.existsSync(file)) return { version: 1, recipes: {} };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { version: 1, recipes: data.recipes ?? {} };
}

export function writeLock(file: string, lock: LockFile): void {
  // stable order → small diffs in merge requests
  const recipes = Object.fromEntries(Object.entries(lock.recipes).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify({ version: 1, recipes }, null, 2) + '\n');
}

export function compare(recipes: Recipe[], lock: LockFile, rootDir: string): { statuses: RecipeStatus[]; removed: string[] } {
  const statuses = recipes.map((recipe): RecipeStatus => {
    const entry = lock.recipes[recipe.id];
    if (!entry) return { recipe, reason: 'neu' };
    if (entry.fingerprint !== recipe.fingerprint) return { recipe, reason: 'geändert' };
    const missing = entry.files.filter((f) => !fs.existsSync(path.resolve(rootDir, f)));
    if (missing.length) return { recipe, reason: 'Dateien fehlen', missing };
    return { recipe, reason: 'unverändert' };
  });
  const current = new Set(recipes.map((r) => r.id));
  const removed = Object.keys(lock.recipes).filter((id) => !current.has(id));
  return { statuses, removed };
}

// ── statistics ─────────────────────────────────────────────────────────────

export interface FileCounts {
  screenshots: number;
  clean: number;
  videos: number;
}

export interface SourceStatistics {
  /** RST or feature file, without line */
  source: string;
  total: number;
  rendered: number;
  toRender: number;
}

export interface Statistics {
  recipes: {
    total: number;
    /** up to date */
    rendered: number;
    /** never rendered (not in the lock file) */
    unrendered: number;
    /** steps, tags, config or step files changed */
    changed: number;
    /** rendered, but files listed in the lock file are gone */
    missingFiles: number;
    /** unrendered + changed + missingFiles */
    toRender: number;
    /** in the lock file, but no longer in the sources */
    removed: number;
  };
  /** files recorded in the lock file for current recipes */
  files: FileCounts & { missing: number };
  bySource: SourceStatistics[];
}

const VIDEO_EXT = /\.(mp4|webm)$/i;

export function statistics(statuses: RecipeStatus[], removed: string[], lock: LockFile): Statistics {
  const count = (reason: RecipeStatus['reason']) => statuses.filter((s) => s.reason === reason).length;
  const files = { screenshots: 0, clean: 0, videos: 0, missing: 0 };
  const bySource = new Map<string, SourceStatistics>();
  for (const st of statuses) {
    for (const f of lock.recipes[st.recipe.id]?.files ?? []) {
      if (VIDEO_EXT.test(f)) files.videos++;
      else if (/\.clean\.[a-z]+$/i.test(f)) files.clean++;
      else files.screenshots++;
    }
    files.missing += st.missing?.length ?? 0;
    const source = st.recipe.file.replace(/:\d+$/, '');
    const s = bySource.get(source) ?? { source, total: 0, rendered: 0, toRender: 0 };
    s.total++;
    if (st.reason === 'unverändert') s.rendered++;
    else s.toRender++;
    bySource.set(source, s);
  }
  const rendered = count('unverändert');
  return {
    recipes: {
      total: statuses.length,
      rendered,
      unrendered: count('neu'),
      changed: count('geändert'),
      missingFiles: count('Dateien fehlen'),
      toRender: statuses.length - rendered,
      removed: removed.length,
    },
    files,
    bySource: [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source)),
  };
}

// ── results of a run ───────────────────────────────────────────────────────

export interface TestResult {
  /** slugs of the test's title path (outline name and example title included) */
  titles: string[];
  project: string;
  status: string;
}

export function readResults(workDir: string): TestResult[] {
  const dir = path.join(workDir, RESULTS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/** Files produced per recipe in this run, from the per-capture manifest entries. */
export function filesByRecipe(workDir: string, rootDir: string): Map<string, string[]> {
  const dir = path.join(workDir, 'manifest');
  const map = new Map<string, string[]>();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const recipe = e.recipe ?? e.id;
    const list = map.get(recipe) ?? [];
    for (const file of [e.file, e.cleanFile].filter(Boolean)) list.push(path.relative(rootDir, file).split(path.sep).join('/'));
    map.set(recipe, list);
  }
  return map;
}

/**
 * Records recipes that ran in this run: passed in at least one variant and failed in none.
 * Returns the ids that were updated and the ids that failed.
 */
export function updateLock(input: StateInput, recipes: Recipe[], ran: Set<string> | undefined): { updated: string[]; failed: string[] } {
  const lock = readLock(input.lockFile);
  const results = readResults(input.workDir);
  const files = filesByRecipe(input.workDir, input.rootDir);
  const updated: string[] = [];
  const failed: string[] = [];
  const now = new Date().toISOString();

  for (const recipe of recipes) {
    if (ran && !ran.has(recipe.id)) continue;
    const mine = results.filter((r) => r.titles.includes(recipe.id));
    if (!mine.length) continue; // not executed (filtered by --grep / --project, or skipped everywhere)
    if (mine.some((r) => r.status !== 'passed' && r.status !== 'skipped')) {
      failed.push(recipe.id);
      continue;
    }
    if (!mine.some((r) => r.status === 'passed')) continue;
    lock.recipes[recipe.id] = { fingerprint: recipe.fingerprint, files: [...new Set(files.get(recipe.id) ?? [])].sort(), source: recipe.file, updated: now };
    updated.push(recipe.id);
  }
  // forget recipes that no longer exist
  const current = new Set(recipes.map((r) => r.id));
  for (const id of Object.keys(lock.recipes)) if (!current.has(id)) delete lock.recipes[id];
  writeLock(input.lockFile, lock);
  return { updated, failed };
}
