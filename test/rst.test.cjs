const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseRst, toFeature, extractAll, rewriteLocations, DocshotSourceError } = require('../dist');

const RST = `
Personen anlegen
================

..  docshot: person-create
    @viewports:desktop,mobile
    # Kommentar wird ignoriert
    Angenommen ich bin angemeldet als "schooladmin"
    Wenn ich auf den Button "Neue Person" klicke

    Dann erstelle einen Screenshot

..  figure:: /Images/Screenshots/person-create/desktop-light-de.png

Text danach.
`;

test('parses blocks, tags and line numbers', () => {
  const parsed = parseRst('Doc/Persons.rst', RST);
  assert.equal(parsed.blocks.length, 1);
  const [b] = parsed.blocks;
  assert.equal(b.id, 'person-create');
  assert.equal(b.line, 5);
  assert.deepEqual(b.tags, ['@viewports:desktop,mobile']);
  assert.deepEqual(b.steps.map((s) => s.line), [8, 9, 11]);
});

test('generates a German feature with a line map', () => {
  const parsed = parseRst('Doc/Persons.rst', RST);
  const { content, lineMap } = toFeature(parsed, 'de', 'Doc/Persons.rst');
  assert.match(content, /^# language: de/);
  assert.match(content, /Szenario: person-create/);
  const genLines = content.split('\n');
  const stepLine = genLines.findIndex((l) => l.includes('Neue Person')) + 1;
  assert.equal(lineMap[stepLine], 9);
});

test('rejects steps without keyword with RST location', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-'));
  fs.writeFileSync(path.join(dir, 'a.rst'), '..  docshot: x\n    klicke auf den Button "A"\n');
  assert.throws(
    () => extractAll({ rootDir: dir, rstPatterns: ['*.rst'], featurePatterns: [], generatedDir: path.join(dir, 'gen'), language: 'de' }),
    (e) => e instanceof DocshotSourceError && /a\.rst:2/.test(e.message),
  );
});

test('detects duplicate ids across rst and feature files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-'));
  fs.writeFileSync(path.join(dir, 'a.rst'), '..  docshot: dup\n    Dann erstelle einen Screenshot\n');
  fs.writeFileSync(path.join(dir, 'b.feature'), '# language: de\nFunktionalität: X\n  Szenario: dup\n    Dann erstelle einen Screenshot\n');
  assert.throws(
    () => extractAll({ rootDir: dir, rstPatterns: ['*.rst'], featurePatterns: ['*.feature'], generatedDir: path.join(dir, 'gen'), language: 'de' }),
    /doppelt vergeben/,
  );
});

test('rewrites generated locations back to RST and removes stale files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-'));
  fs.writeFileSync(path.join(dir, 'a.rst'), RST);
  const gen = path.join(dir, 'gen');
  fs.mkdirSync(gen, { recursive: true });
  fs.writeFileSync(path.join(gen, 'old.feature'), 'stale');
  const res = extractAll({ rootDir: dir, rstPatterns: ['*.rst'], featurePatterns: [], generatedDir: gen, language: 'de' });
  assert.equal(res.generatedFiles.length, 1);
  assert.equal(fs.existsSync(path.join(gen, 'old.feature')), false);
  const content = fs.readFileSync(res.generatedFiles[0], 'utf8').split('\n');
  const line = content.findIndex((l) => l.includes('Neue Person')) + 1;
  const msg = `Error: Missing step at ${path.join(gen, 'a.feature')}:${line}:5`;
  assert.equal(rewriteLocations(msg, dir, gen), 'Error: Missing step at a.rst:9');
});
