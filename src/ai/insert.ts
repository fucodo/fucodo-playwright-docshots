import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export interface ImageReference {
  file: string;        // absolute RST path
  line: number;        // 0-based
  indent: string;
  pathText: string;    // path as written in the directive
}

const DIRECTIVE = /^(\s*)\.\.\s+(?:figure|image|thumbnail)::\s*(\S+)\s*$/;

/** TYPO3 docs: absolute image paths ("/Images/…") are relative to the Documentation folder. */
function docRootOf(rstFile: string, rootDir: string): string {
  let dir = path.dirname(rstFile);
  while (dir.startsWith(rootDir)) {
    if (path.basename(dir) === 'Documentation') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(rootDir, 'Documentation');
}

function resolveDirectivePath(rstFile: string, pathText: string, rootDir: string): string {
  return pathText.startsWith('/')
    ? path.join(docRootOf(rstFile, rootDir), pathText)
    : path.resolve(path.dirname(rstFile), pathText);
}

export function findImageReferences(rootDir: string, patterns: string[], imageAbs: string): ImageReference[] {
  const refs: ImageReference[] = [];
  for (const file of fg.sync(patterns, { cwd: rootDir, absolute: true }).sort()) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((text, line) => {
      const m = DIRECTIVE.exec(text);
      if (m && path.resolve(resolveDirectivePath(file, m[2], rootDir)) === path.resolve(imageAbs)) {
        refs.push({ file, line, indent: m[1], pathText: m[2] });
      }
    });
  }
  return refs;
}

/** Path to newImage written in the same style (absolute "/…" or relative) as the old reference. */
function samePathStyle(ref: ImageReference, newImageAbs: string, rootDir: string): string {
  const base = ref.pathText.startsWith('/') ? docRootOf(ref.file, rootDir) : path.dirname(ref.file);
  const rel = path.relative(base, newImageAbs).split(path.sep).join('/');
  return ref.pathText.startsWith('/') ? `/${rel}` : rel;
}

/**
 * Inserts the docshot block above the first reference in that file and points all
 * references to the old image in that file to the new screenshot.
 */
export function insertBlock(ref: ImageReference, id: string, steps: string[], newImageAbs: string, rootDir: string): string {
  const lines = fs.readFileSync(ref.file, 'utf8').split(/\r?\n/);
  const newPath = samePathStyle(ref, newImageAbs, rootDir);

  for (let i = 0; i < lines.length; i++) {
    const m = DIRECTIVE.exec(lines[i]);
    if (m && m[2] === ref.pathText) lines[i] = lines[i].replace(ref.pathText, newPath);
  }
  const block = [`${ref.indent}..  docshot: ${id}`, ...steps.map((s) => `${ref.indent}    ${s}`), ''];
  lines.splice(ref.line, 0, ...block);
  fs.writeFileSync(ref.file, lines.join('\n'));
  return newPath;
}

export function idExists(rootDir: string, patterns: string[], id: string): string | undefined {
  const re = new RegExp(`(?:\\.\\.\\s+docshot:\\s*|(?:Scenario|Szenario):\\s*)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  for (const file of fg.sync(patterns, { cwd: rootDir, absolute: true })) {
    if (re.test(fs.readFileSync(file, 'utf8'))) return path.relative(rootDir, file);
  }
  return undefined;
}
