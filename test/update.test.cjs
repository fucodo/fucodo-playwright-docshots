const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectRecipes, compare, readLock, updateLock, writeLock } = require('../dist/update');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-upd-'));
  const work = path.join(root, '.docshots');
  fs.mkdirSync(path.join(root, 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features', 'a.feature'), [
    '# language: de',
    'Funktionalität: A',
    '  Grundlage:',
    '    Angenommen ich öffne die Seite "/x"',
    '  Szenario: shot-one',
    '    Dann erstelle einen Screenshot',
    '  @id:custom-id',
    '  Szenario: Zweites Bild',
    '    Dann markiere den Button "OK" mit "1"',
    '    Und erstelle einen Screenshot',
  ].join('\n'));
  const input = { rootDir: root, workDir: work, lockFile: path.join(root, 'docshots.lock.json'), features: [path.join(root, 'features/**/*.feature')], language: 'de', global: 'g1' };
  return { root, work, input };
}

function fakeRun(work, root, results, manifest) {
  fs.mkdirSync(path.join(work, 'results'), { recursive: true });
  fs.mkdirSync(path.join(work, 'manifest'), { recursive: true });
  results.forEach((r, i) => fs.writeFileSync(path.join(work, 'results', `r${i}.json`), JSON.stringify(r)));
  manifest.forEach((m, i) => {
    const file = path.join(root, m.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'png');
    fs.writeFileSync(path.join(work, 'manifest', `m${i}.json`), JSON.stringify({ ...m, file }));
  });
}

test('recipes: ids from title or @id, background included in the fingerprint', () => {
  const { root, input } = project();
  const r1 = collectRecipes(input);
  assert.deepEqual(r1.map((r) => r.id).sort(), ['custom-id', 'shot-one']);
  // background change → every recipe of the file changes
  const f = path.join(root, 'features', 'a.feature');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"/x"', '"/y"'));
  const r2 = collectRecipes(input);
  for (const r of r2) assert.notEqual(r.fingerprint, r1.find((x) => x.id === r.id).fingerprint);
  // global change (config/steps/version) → every recipe changes
  const r3 = collectRecipes({ ...input, global: 'g2' });
  assert.notEqual(r3[0].fingerprint, r2[0].fingerprint);
});

test('lock: new → updated after a passing run → unchanged → changed / missing files', () => {
  const { root, work, input } = project();
  let recipes = collectRecipes(input);
  assert.ok(compare(recipes, readLock(input.lockFile), root).statuses.every((s) => s.reason === 'neu'));

  fakeRun(work, root,
    [{ titles: ['a', 'shot-one'], project: 'desktop', status: 'passed' }, { titles: ['custom-id', 'zweites-bild'], project: 'desktop', status: 'passed' }],
    [{ id: 'shot-one', recipe: 'shot-one', file: 'img/shot-one/desktop.png' }, { id: 'custom-id', recipe: 'custom-id', file: 'img/custom-id/desktop.png' }]);
  const res = updateLock(input, recipes, undefined);
  assert.deepEqual(res.updated.sort(), ['custom-id', 'shot-one']);
  assert.deepEqual(readLock(input.lockFile).recipes['shot-one'].files, ['img/shot-one/desktop.png']);
  assert.ok(compare(recipes, readLock(input.lockFile), root).statuses.every((s) => s.reason === 'unverändert'));

  // change one step → only that recipe
  const f = path.join(root, 'features', 'a.feature');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('mit "1"', 'mit "2"'));
  recipes = collectRecipes(input);
  const st = Object.fromEntries(compare(recipes, readLock(input.lockFile), root).statuses.map((s) => [s.recipe.id, s.reason]));
  assert.deepEqual(st, { 'shot-one': 'unverändert', 'custom-id': 'geändert' });

  // deleted image → "Dateien fehlen"
  fs.rmSync(path.join(root, 'img/shot-one/desktop.png'));
  const st2 = Object.fromEntries(compare(recipes, readLock(input.lockFile), root).statuses.map((s) => [s.recipe.id, s.reason]));
  assert.equal(st2['shot-one'], 'Dateien fehlen');
});

test('lock: failed recipes are not recorded, removed recipes are forgotten', () => {
  const { root, work, input } = project();
  const recipes = collectRecipes(input);
  writeLock(input.lockFile, { version: 1, recipes: { gone: { fingerprint: 'x', files: [], updated: 'then' } } });
  fakeRun(work, root,
    [{ titles: ['shot-one'], project: 'desktop', status: 'passed' }, { titles: ['shot-one'], project: 'mobile', status: 'failed' }, { titles: ['custom-id'], project: 'desktop', status: 'passed' }],
    [{ id: 'custom-id', recipe: 'custom-id', file: 'img/c.png' }]);
  const res = updateLock(input, recipes, undefined);
  assert.deepEqual(res.failed, ['shot-one']);
  assert.deepEqual(res.updated, ['custom-id']);
  const lock = readLock(input.lockFile);
  assert.equal(lock.recipes.gone, undefined);
  assert.equal(lock.recipes['shot-one'], undefined);
});

test('statistics: rendered, unrendered, changed and files per kind', () => {
  const { statistics } = require('../dist/update');
  const st = (id, reason, file, missing) => ({ recipe: { id, file, name: id, fingerprint: 'f' }, reason, missing });
  const statuses = [
    st('a', 'unverändert', 'Documentation/A.rst:3'),
    st('b', 'neu', 'Documentation/A.rst:12'),
    st('c', 'geändert', 'features/c.feature:5'),
    st('d', 'Dateien fehlen', 'features/c.feature:9', ['img/d/desktop.png']),
  ];
  const lock = { version: 1, recipes: {
    a: { fingerprint: 'f', files: ['img/a/desktop.png', 'img/a/desktop.clean.png', 'vid/a/desktop.mp4'], updated: '' },
    c: { fingerprint: 'old', files: ['img/c/desktop.png'], updated: '' },
    d: { fingerprint: 'f', files: ['img/d/desktop.png'], updated: '' },
    gone: { fingerprint: 'f', files: [], updated: '' },
  } };
  const s = statistics(statuses, ['gone'], lock);
  assert.deepEqual(s.recipes, { total: 4, rendered: 1, unrendered: 1, changed: 1, missingFiles: 1, toRender: 3, removed: 1 });
  assert.deepEqual(s.files, { screenshots: 3, clean: 1, videos: 1, missing: 1 });
  assert.deepEqual(s.bySource, [
    { source: 'Documentation/A.rst', total: 2, rendered: 1, toRender: 1 },
    { source: 'features/c.feature', total: 2, rendered: 0, toRender: 2 },
  ]);
});
