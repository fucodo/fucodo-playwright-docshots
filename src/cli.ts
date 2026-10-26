#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { rewriteLocations } from './sources/extract';
import { VOCABULARY } from './steps/vocabulary';
import { fromImage } from './ai/command';
import { peerLocations } from './peer';
import { initProject } from './setup';
import { NO_CLEAN_ENV } from './config';
import { collectRecipes, compare, ONLY_ENV, readLock, readStateInput, RESULTS_DIR, statistics, updateLock, type RecipeStatus, type Statistics } from './update';
import type { DocshotLanguage } from './sources/rst';

const HELP = `docshots – Doku-Screenshots aus Gherkin-Schritten

  docshots test     [-c docshots.config.ts] [--changed] [--no-clean] [playwright args…]   extrahieren, generieren, Screenshots erstellen
  docshots update   [--no-clean] [playwright args…]               nur neue/geänderte Rezepte rendern (= test --changed)
  docshots status   [--check]                                     zeigen, welche Rezepte neu/geändert sind (kein Browser)
  docshots stats    [--json]                                      Statistik: gerendert, nie gerendert, geändert (kein Browser)
  docshots lint     [-c docshots.config.ts]                       nur prüfen: Syntax, IDs, unbekannte Schritte (kein Browser)
  docshots steps    [-c docshots.config.ts] [--out Datei.rst] [--lang de|en]   Schritt-Übersicht als RST schreiben
  docshots manifest [--work-dir .docshots]                        manifest.json aus dem letzten Lauf zusammenführen
  docshots init     [--dir Tests/Playwright] [--lang de|en] [--force]   Konfiguration, Schritt-Datei und Personas anlegen
  docshots from-image [Bild] [--url /pfad] [--persona name] [--insert]   Schritte aus einem alten Bild per KI erzeugen

Beispiele:
  npx docshots test --grep person-create
  npx docshots test --project "desktop-light-de"
  npx docshots from-image Documentation/Images/benutzer.png --url /administration/persons --insert
  npx docshots from-image --help
`;

function parseArgs(argv: string[]) {
  const rest: string[] = [];
  let config = 'docshots.config.ts';
  let out: string | undefined;
  let lang: DocshotLanguage = 'de';
  let workDir = '.docshots';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--config') config = argv[++i];
    else if (a === '--out') out = argv[++i];
    else if (a === '--lang') lang = argv[++i] as DocshotLanguage;
    else if (a === '--work-dir') workDir = argv[++i];
    else rest.push(a);
  }
  return { config, out, lang, workDir, rest };
}

function binOf(pkg: string, bin: string): string {
  const pkgJson = require.resolve(`${pkg}/package.json`, { paths: [process.cwd(), __dirname] });
  const manifest = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
  const rel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[bin];
  return path.join(path.dirname(pkgJson), rel);
}

/** Runs a node CLI, rewriting generated-feature locations to RST locations in its output. */
function run(script: string, args: string[], workDir: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
    const rootDir = process.cwd();
    const generatedDir = path.resolve(workDir, 'generated');
    let output = '';
    const forward = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
      const text = rewriteLocations(chunk.toString(), rootDir, generatedDir);
      output += text;
      stream.write(text);
    };
    child.stdout.on('data', forward(process.stdout));
    child.stderr.on('data', forward(process.stderr));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

const STAFF_HINT = `
──────────────────────────────────────────────────────────────────────
Hinweis für die Doku: Mindestens ein Schritt ist unbekannt (Datei:Zeile steht oben bei "From:").
Prüfen Sie die Schreibweise – alle verfügbaren Schritte stehen in der Schritt-Übersicht
("docshots steps"). Fehlt ein Schritt wirklich, bitte bei den Entwicklern anfragen.
──────────────────────────────────────────────────────────────────────
`;

async function hintIfMissingSteps(output: string, config: string) {
  if (!/Missing step definitions/i.test(output)) return;
  const registered = await exportProjectSteps(config, true);
  if (registered.length > 0) {
    process.stderr.write(STAFF_HINT);
    return;
  }
  // Not a typo: no step is registered at all → setup problem, explain it for devs.
  const problems: string[] = [];
  for (const pkg of ['playwright-bdd', '@playwright/test']) {
    const { project, own } = peerLocations(pkg);
    if (project && own && project !== own) {
      problems.push(`  • ${pkg} ist doppelt installiert:\n      Projekt: ${project}\n      Paket:   ${own}\n    → Paket als Tarball installieren (npm pack), nicht per Symlink; dann "npm ls ${pkg}" sollte nur eine Version zeigen.`);
    }
  }
  problems.push(
    `  • Der "steps"-Glob in ${config} passt auf keine Datei, oder die Datei mit registerDocshotSteps() ist nicht dabei.`,
    '    Pfade sind relativ zum Ordner, in dem der Befehl läuft (' + process.cwd() + ').',
    `    Prüfen: npx bddgen export -c ${config}   → sollte rund 60 Schritte auflisten.`,
  );
  process.stderr.write(`\n✘ Es sind überhaupt keine Schritt-Definitionen registriert. Mögliche Ursachen:\n${problems.join('\n')}\n\n`);
}

function printStatus(statuses: RecipeStatus[], removed: string[], rootDir: string, all = false) {
  const icon: Record<RecipeStatus['reason'], string> = { neu: '+', geändert: '~', 'Dateien fehlen': '!', unverändert: '=' };
  for (const st of statuses) {
    if (st.reason === 'unverändert' && !all) continue;
    const missing = st.missing ? ` (${st.missing.length} fehlen, z. B. ${st.missing[0]})` : '';
    console.log(`  ${icon[st.reason]} ${st.recipe.id.padEnd(32)} ${st.reason}${missing}  ← ${st.recipe.file}`);
  }
  for (const id of removed) console.log(`  - ${id.padEnd(32)} entfernt (Bilder ggf. von Hand löschen)`);
  void rootDir;
}

function printStatistics(s: Statistics) {
  const r = s.recipes;
  const w = String(r.total).length;
  const row = (n: number, label: string) => console.log(`  ${String(n).padStart(w)}  ${label}`);
  console.log(`Rezepte: ${r.total}`);
  row(r.rendered, 'gerendert und aktuell');
  row(r.unrendered, 'noch nie gerendert (neu)');
  row(r.changed, 'geändert seit dem letzten Rendern');
  row(r.missingFiles, 'gerendert, aber Dateien fehlen');
  console.log(`  ${'─'.repeat(w)}`);
  row(r.toRender, 'zu rendern (npx docshots update)');
  if (r.removed) row(r.removed, 'entfernt (nur noch im Lock-File)');
  const f = s.files;
  console.log(`\nDateien laut Lock-File: ${f.screenshots} Screenshots, ${f.clean} ohne Markierungen (.clean), ${f.videos} Videos${f.missing ? `, ${f.missing} fehlen` : ''}`);
  if (s.bySource.length) {
    const width = Math.max(...s.bySource.map((x) => x.source.length), 'Quelle'.length);
    console.log(`\n  ${'Quelle'.padEnd(width)}  gesamt  aktuell  zu rendern`);
    for (const x of s.bySource) {
      console.log(`  ${x.source.padEnd(width)}  ${String(x.total).padStart(6)}  ${String(x.rendered).padStart(7)}  ${String(x.toRender).padStart(10)}`);
    }
  }
}

/** Removes per-capture manifest entries of the recipes that are about to run (all, if ids is undefined). */
function clearManifestEntries(workDir: string, ids?: Set<string>) {
  const dir = path.resolve(workDir, 'manifest');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const file = path.join(dir, f);
    if (!ids) { fs.rmSync(file); continue; }
    try {
      const e = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (ids.has(e.recipe ?? e.id)) fs.rmSync(file);
    } catch {
      fs.rmSync(file);
    }
  }
}

function mergeManifest(workDir: string): string | undefined {
  const dir = path.resolve(workDir, 'manifest');
  if (!fs.existsSync(dir)) return undefined;
  const byId: Record<string, unknown[]> = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    entry.file = path.relative(process.cwd(), entry.file).split(path.sep).join('/');
    if (entry.cleanFile) entry.cleanFile = path.relative(process.cwd(), entry.cleanFile).split(path.sep).join('/');
    (byId[entry.id] ??= []).push(entry);
  }
  const target = path.resolve(workDir, 'manifest.json');
  fs.writeFileSync(target, JSON.stringify(byId, null, 2));
  return target;
}

function cheatSheet(lang: DocshotLanguage, projectSteps: string[]): string {
  const title = lang === 'de' ? 'Verfügbare Screenshot-Schritte' : 'Available screenshot steps';
  const lines: string[] = [
    '..  This file is generated by "docshots steps" – do not edit.',
    '',
    '='.repeat(title.length),
    title,
    '='.repeat(title.length),
    '',
    lang === 'de'
      ? 'Ziele werden als ``Art "Name"`` angegeben, z. B. ``den Button "Speichern"``, ``das Feld "Vorname"``, ``den Link "Hilfe"``, ``den Tab "…"``, ``die Checkbox "…"``, ``die Auswahl "…"``, ``die Überschrift "…"``, ``den Dialog "…"``, ``die Zeile "…"``, ``den Text "…"`` – oder ein von den Entwicklern benannter Bereich. Gibt es den Text mehrfach, eingrenzen: ``den Link "Impressum" in der Fußzeile``, ``den Button "Speichern" im Dialog "Person anlegen"``, ``den zweiten Link "Impressum"`` (auch Kopfzeile, Navigation, Seitenleiste, Hauptbereich, Dialog). Oder einmal festlegen: ``Und ich arbeite in der Fußzeile`` – dann gilt der Bereich für alle folgenden Schritte und der Screenshot wird darauf zugeschnitten. ``Bereich "…"`` kann ein benannter Bereich, ein Seitenbereich oder ein CSS-Selektor sein.'
      : 'Targets are written as ``kind "name"``, e.g. ``the button "Save"``, ``the field "First name"``, ``the link "Help"`` – or a named area defined by the developers.',
    '',
  ];
  const groups = [...new Set(VOCABULARY.map((v) => v.group))];
  for (const g of groups) {
    lines.push(g, '-'.repeat(g.length), '', '..  code-block:: gherkin', '');
    for (const v of VOCABULARY.filter((x) => x.group === g)) for (const ex of v.examples[lang]) lines.push(`    ${ex}`);
    lines.push('');
  }
  if (projectSteps.length) {
    const h = lang === 'de' ? 'Projektspezifische Schritte' : 'Project steps';
    lines.push(h, '-'.repeat(h.length), '', '..  code-block:: text', '');
    for (const s of projectSteps) lines.push(`    ${s}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Project steps (cucumber expressions) via `bddgen export`, without built-in and internal steps. */
async function exportProjectSteps(config: string, includeBuiltins = false): Promise<string[]> {
  const exported = await new Promise<string>((resolve) => {
    const child = spawn(process.execPath, [binOf('playwright-bdd', 'bddgen'), 'export', '-c', config], { stdio: ['inherit', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (c: Buffer) => (buf += c.toString()));
    child.on('close', () => resolve(buf));
  });
  const builtinSources = VOCABULARY.flatMap((v) => [...v.patterns.de, ...v.patterns.en].map((p) => p.source));
  return exported
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\*\s/.test(l) || /^(Given|When|Then|Step)\b/.test(l))
    .map((l) => l.replace(/^\*\s*/, ''))
    .filter((l) => !l.includes('docshots-analyze'))
    .filter((l) => includeBuiltins || !builtinSources.some((src) => l.includes(src)));
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { config, out, lang, workDir, rest } = parseArgs(argv);

  switch (command) {
    case 'lint': {
      const r = await run(binOf('playwright-bdd', 'bddgen'), ['-c', config], workDir);
      if (r.code === 0) console.log('✔ Alle Screenshot-Schritte sind gültig.');
      else await hintIfMissingSteps(r.output, config);
      process.exit(r.code);
    }
    // falls through
    case 'update':
    case 'test': {
      // update mode: only new/changed recipes and recipes with missing files
      const changedOnly = command === 'update' || rest.includes('--changed');
      // --no-clean: no *.clean.png in this run, even with keepClean: true
      if (rest.includes('--no-clean')) process.env[NO_CLEAN_ENV] = '1';
      const pwArgs = rest.filter((a) => a !== '--changed' && a !== '--no-clean');
      const gen = await run(binOf('playwright-bdd', 'bddgen'), ['-c', config], workDir);
      if (gen.code !== 0) {
        await hintIfMissingSteps(gen.output, config);
        process.exit(gen.code);
      }
      const input = readStateInput(path.resolve(workDir));
      const recipes = collectRecipes(input);

      let run_ids: Set<string> | undefined;
      if (changedOnly) {
        const { statuses, removed } = compare(recipes, readLock(input.lockFile), input.rootDir);
        const todo = statuses.filter((st) => st.reason !== 'unverändert');
        printStatus(statuses, removed, input.rootDir);
        if (!todo.length) {
          console.log('\n✔ Alles aktuell – nichts zu rendern.');
          process.exit(0);
        }
        run_ids = new Set(todo.map((t) => t.recipe.id));
        process.env[ONLY_ENV] = JSON.stringify([...run_ids]);
        console.log(`\n→ Rendere ${run_ids.size} von ${recipes.length} Rezepten …\n`);
      }

      // fresh results; manifest entries of the recipes that run now are replaced
      fs.rmSync(path.resolve(workDir, RESULTS_DIR), { recursive: true, force: true });
      clearManifestEntries(workDir, run_ids);

      const pw = await run(binOf('@playwright/test', 'playwright'), ['test', '-c', config, ...pwArgs], workDir);
      const { updated, failed } = updateLock(input, recipes, run_ids);
      const rel = path.relative(process.cwd(), input.lockFile) || input.lockFile;
      if (updated.length) console.log(`\n${rel}: ${updated.length} Rezept(e) aktualisiert.`);
      if (failed.length) console.log(`Nicht aktualisiert (fehlgeschlagen): ${failed.join(', ')}`);
      const manifest = mergeManifest(workDir);
      if (manifest) console.log(`Manifest: ${path.relative(process.cwd(), manifest)}`);
      process.exit(pw.code);
    }
    // falls through
    case 'status': {
      const gen = await run(binOf('playwright-bdd', 'bddgen'), ['-c', config], workDir);
      if (gen.code !== 0) process.exit(gen.code);
      const input = readStateInput(path.resolve(workDir));
      const { statuses, removed } = compare(collectRecipes(input), readLock(input.lockFile), input.rootDir);
      printStatus(statuses, removed, input.rootDir, true);
      const todo = statuses.filter((st) => st.reason !== 'unverändert').length;
      console.log(todo ? `\n${todo} Rezept(e) zu rendern: npx docshots update` : '\n✔ Alles aktuell.');
      // --check: fail in CI when images are outdated
      process.exit(rest.includes('--check') && (todo || removed.length) ? 1 : 0);
    }
    // falls through
    case 'stats':
    case 'statistics': {
      const gen = await run(binOf('playwright-bdd', 'bddgen'), ['-c', config], workDir);
      if (gen.code !== 0) process.exit(gen.code);
      const input = readStateInput(path.resolve(workDir));
      const lock = readLock(input.lockFile);
      const { statuses, removed } = compare(collectRecipes(input), lock, input.rootDir);
      const stats = statistics(statuses, removed, lock);
      if (rest.includes('--json')) process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
      else printStatistics(stats);
      return;
    }
    case 'steps': {
      const projectSteps = await exportProjectSteps(config);
      const rst = cheatSheet(lang, projectSteps);
      if (out) {
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        fs.writeFileSync(out, rst);
        console.log(`Geschrieben: ${out}`);
      } else {
        process.stdout.write(rst);
      }
      return;
    }
    case 'from-image': {
      // the command parses its own options; only -c / --work-dir are shared
      const own: string[] = [];
      const raw = process.argv.slice(3);
      for (let i = 0; i < raw.length; i++) {
        if (['-c', '--config', '--work-dir'].includes(raw[i])) i++;
        else own.push(raw[i]);
      }
      process.exit(await fromImage(own, config, workDir, { binOf, run, projectSteps: exportProjectSteps }));
    }
    // falls through
    case 'init': {
      const raw = process.argv.slice(3);
      const opt = (name: string) => { const i = raw.indexOf(name); return i >= 0 ? raw[i + 1] : undefined; };
      const res = initProject({
        rootDir: process.cwd(),
        dir: opt('--dir'),
        force: raw.includes('--force'),
        language: (opt('--lang') as 'de' | 'en' | undefined) ?? 'de',
      });
      const d = res.detected;
      console.log('Erkannt:');
      console.log(`  Playwright-Konfiguration: ${d.baseConfig ?? '– (keine gefunden, baseURL in docshots.config.ts setzen)'}`);
      console.log(`  App-Fixtures (test):      ${d.appTest ?? '– (keine index.ts mit export test gefunden)'}`);
      console.log(`  LoginPage:                ${d.loginPage ?? '– (Login-Adapter mit TODO angelegt)'}`);
      console.log('');
      for (const f of res.created) console.log(`  + ${f}`);
      for (const f of res.skipped) console.log(`  = ${f} (existiert, nicht überschrieben – --force zum Ersetzen)`);
      if (res.gitignoreUpdated) console.log('  + .docshots/ in .gitignore');
      console.log(`
Nächste Schritte:
  1. Personas in der personas.ts anpassen und Passwörter als DOCSHOT_PW_<PERSONA> setzen (CI-Variable oder .env)
  2. npx docshots lint
  3. Einen ersten Block in eine RST-Datei schreiben (..  docshot: mein-erster-screenshot) und npx docshots test`);
      return;
    }
    case 'manifest': {
      const m = mergeManifest(workDir);
      console.log(m ? `Manifest: ${m}` : 'Kein Manifest gefunden – zuerst "docshots test" ausführen.');
      return;
    }
    default:
      process.stdout.write(HELP);
      process.exit(command && command !== 'help' && command !== '--help' ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
