import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { DocshotLanguage, DocshotSourceError, KEYWORDS, parseRst, toFeature, validateSteps } from './rst';

export interface ExtractOptions {
  rootDir: string;
  rstPatterns: string[];
  featurePatterns: string[];
  /** Directory (absolute) that receives the generated .feature files */
  generatedDir: string;
  language: DocshotLanguage | ((rstFile: string) => DocshotLanguage);
}

export interface ExtractResult {
  generatedFiles: string[];
  /** screenshot id → "file:line" */
  ids: Map<string, string>;
}

export const SOURCEMAP_FILE = 'sourcemap.json';

/** generated feature path (relative to rootDir) → { source, lines } */
export type SourceMap = Record<string, { source: string; lines: Record<number, number> }>;

const toPosix = (p: string) => p.split(path.sep).join('/');

function scenarioNames(file: string, content: string): { name: string; line: number }[] {
  const allKeywords = [
    ...Object.values(KEYWORDS).map((k) => k.scenario),
    'Scenario Outline', 'Scenario Template', 'Example', 'Szenariogrundriss', 'Szenarien', 'Beispiel',
  ];
  const re = new RegExp(`^\\s*(?:${allKeywords.map((k) => k.replace(/ /g, '\\s+')).join('|')}):\\s*(.+?)\\s*$`);
  const names: { name: string; line: number }[] = [];
  content.split(/\r?\n/).forEach((line, idx) => {
    const m = re.exec(line);
    if (m) names.push({ name: m[1], line: idx + 1 });
  });
  return names;
}

function writeIfChanged(file: string, content: string) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Extracts all RST blocks into .feature files and checks screenshot IDs for
 * uniqueness across RST blocks and hand-written .feature files.
 * Synchronous on purpose: it runs while Playwright loads the config.
 */
export function extractAll(opts: ExtractOptions): ExtractResult {
  const { rootDir, generatedDir } = opts;
  const ids = new Map<string, string>();
  const register = (id: string, location: string) => {
    const existing = ids.get(id);
    if (existing) {
      const [file, line] = location.split(/:(?=\d+$)/);
      throw new DocshotSourceError(file, Number(line), `Screenshot-ID "${id}" ist doppelt vergeben (auch in ${existing}).`);
    }
    ids.set(id, location);
  };

  // 1. hand-written .feature files (only for the ID check, bddgen reads them itself)
  const featureFiles = fg.sync(opts.featurePatterns, { cwd: rootDir, absolute: true, ignore: [toPosix(path.relative(rootDir, generatedDir)) + '/**'] });
  for (const file of featureFiles) {
    const rel = toPosix(path.relative(rootDir, file));
    for (const s of scenarioNames(rel, fs.readFileSync(file, 'utf8'))) {
      // Outline example names repeat on purpose – only literal scenario names count.
      register(s.name, `${rel}:${s.line}`);
    }
  }

  // 2. RST files → generated .feature files
  const rstFiles = fg.sync(opts.rstPatterns, { cwd: rootDir, absolute: true }).sort();
  const generatedFiles: string[] = [];
  const sourceMap: SourceMap = {};
  const expected = new Set<string>();

  for (const file of rstFiles) {
    const rel = toPosix(path.relative(rootDir, file));
    const parsed = parseRst(rel, fs.readFileSync(file, 'utf8'));
    if (parsed.blocks.length === 0) continue;

    const language = parsed.language ?? (typeof opts.language === 'function' ? opts.language(rel) : opts.language);
    validateSteps(parsed, language);
    for (const block of parsed.blocks) register(block.id, `${rel}:${block.line}`);

    const { content, lineMap } = toFeature(parsed, language, rel);
    const target = path.join(generatedDir, rel.replace(/\.rst$/i, '.feature'));
    writeIfChanged(target, content);
    generatedFiles.push(target);
    expected.add(path.resolve(target));
    sourceMap[toPosix(path.relative(rootDir, target))] = { source: rel, lines: lineMap };
  }

  // 3. remove stale generated files (RST block deleted or moved)
  if (fs.existsSync(generatedDir)) {
    for (const stale of fg.sync('**/*.feature', { cwd: generatedDir, absolute: true })) {
      if (!expected.has(path.resolve(stale))) fs.rmSync(stale);
    }
  }
  writeIfChanged(path.join(generatedDir, SOURCEMAP_FILE), JSON.stringify(sourceMap, null, 2));

  return { generatedFiles, ids };
}

/**
 * Rewrites "<generated>.feature:<line>" references in tool output back to
 * "<file>.rst:<line>", so support staff see where to fix things.
 */
export function rewriteLocations(text: string, rootDir: string, generatedDir: string): string {
  const mapFile = path.join(generatedDir, SOURCEMAP_FILE);
  if (!fs.existsSync(mapFile)) return text;
  const map: SourceMap = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  let result = text;
  for (const [generated, { source, lines }] of Object.entries(map)) {
    // longest first, so an absolute path is not half-replaced by its relative suffix
    const variants = [...new Set([path.join(rootDir, generated), toPosix(path.join(rootDir, generated)), generated])]
      .sort((a, b) => b.length - a.length);
    for (const v of variants) {
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`${escaped}(?::(\\d+)(?::\\d+)?)?`, 'g'), (_m, line?: string) => {
        if (!line) return source;
        const mapped = nearestMapped(lines, Number(line));
        return mapped ? `${source}:${mapped}` : source;
      });
    }
  }
  return result;
}

function nearestMapped(lines: Record<number, number>, line: number): number | undefined {
  for (let l = line; l > 0; l--) if (lines[l]) return lines[l];
  return undefined;
}
