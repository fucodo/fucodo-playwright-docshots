const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkSetup, initProject } = require('../dist/setup');

const STEPS = ['Tests/Playwright/docshots/steps/**/*.ts'];

/** Project like Kay's: Tests/Playwright with index.ts, pages/login-page.ts, playwright.config.ts */
function fakeProject({ withIndex = true, withLoginPage = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-setup-'));
  const t = path.join(root, 'Tests', 'Playwright');
  fs.mkdirSync(path.join(t, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(t, 'playwright.config.ts'), 'export default {};\n');
  if (withIndex) fs.writeFileSync(path.join(t, 'index.ts'), 'export const test = mergeTests(a, b);\n');
  if (withLoginPage) {
    fs.writeFileSync(
      path.join(t, 'pages', 'login-page.ts'),
      'export class LoginPage {\n  async goto() {}\n  async completeLogin(u: string, p: string) {}\n}\n',
    );
  }
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  return root;
}

const messages = (w) => w.map((x) => x.message).join('\n');

test('warns when no step files exist', () => {
  const root = fakeProject();
  const w = checkSetup(root, STEPS);
  assert.equal(w.length, 1);
  assert.match(w[0].message, /Keine Schritt-Dateien gefunden/);
  assert.match(w[0].hint, /docshots init/);
});

test('warns when steps exist but none registers the built-in vocabulary', () => {
  const root = fakeProject();
  const dir = path.join(root, 'Tests/Playwright/docshots/steps');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'persons.steps.ts'), "import { Given } from './index';\n");
  const all = messages(checkSetup(root, STEPS));
  assert.match(all, /persons\.steps\.ts importiert "\.\/index", die Datei fehlt/);
  assert.match(all, /registerDocshotSteps\(\)/);
});

test('warns when the personas file imported by the steps entry is missing', () => {
  const root = fakeProject();
  initProject({ rootDir: root });
  fs.rmSync(path.join(root, 'Tests/Playwright/docshots/personas.ts'));
  const w = checkSetup(root, STEPS);
  assert.equal(w.length, 1);
  assert.match(w[0].message, /importiert "\.\.\/personas", die Datei fehlt/);
  assert.match(w[0].hint, /Personas/);
});

test('warns about missing login adapter, docshotTest and personas', () => {
  const root = fakeProject();
  const dir = path.join(root, 'Tests/Playwright/docshots/steps');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.ts'), 'registerDocshotSteps(test, {});\n');
  const all = messages(checkSetup(root, STEPS));
  assert.match(all, /docshotTest/);
  assert.match(all, /login-Adapter/);
  assert.match(all, /personas noch credentials/);
});

test('init creates the three files, detects the project and passes the check', () => {
  const root = fakeProject();
  const res = initProject({ rootDir: root });
  assert.deepEqual(res.created.sort(), [
    'Tests/Playwright/docshots/personas.ts',
    'Tests/Playwright/docshots/steps/index.ts',
    'docshots.config.ts',
  ]);
  assert.equal(res.detected.baseConfig, 'Tests/Playwright/playwright.config.ts');
  assert.equal(res.detected.appTest, 'Tests/Playwright/index.ts');
  assert.equal(res.detected.loginPage, 'Tests/Playwright/pages/login-page.ts');
  assert.equal(res.gitignoreUpdated, true);

  const steps = fs.readFileSync(path.join(root, 'Tests/Playwright/docshots/steps/index.ts'), 'utf8');
  assert.match(steps, /import \{ test as appTest \} from '\.\.\/\.\.\/index';/);
  assert.match(steps, /import \{ LoginPage \} from '\.\.\/\.\.\/pages\/login-page';/);
  assert.match(steps, /import \{ personas \} from '\.\.\/personas';/);
  assert.match(steps, /await loginPage\.goto\(\);/);
  const config = fs.readFileSync(path.join(root, 'docshots.config.ts'), 'utf8');
  assert.match(config, /import baseConfig from '\.\/Tests\/Playwright\/playwright\.config';/);
  assert.match(config, /steps: \['Tests\/Playwright\/docshots\/steps\/\*\*\/\*\.ts'\]/);

  assert.deepEqual(checkSetup(root, STEPS), []);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.docshots\/$/m);
});

test('init does not overwrite existing files unless --force', () => {
  const root = fakeProject();
  initProject({ rootDir: root });
  const personas = path.join(root, 'Tests/Playwright/docshots/personas.ts');
  fs.writeFileSync(personas, '// mine\n');
  const again = initProject({ rootDir: root });
  assert.equal(again.created.length, 0);
  assert.equal(again.skipped.length, 3);
  assert.equal(again.gitignoreUpdated, false);
  assert.equal(fs.readFileSync(personas, 'utf8'), '// mine\n');
  initProject({ rootDir: root, force: true });
  assert.notEqual(fs.readFileSync(personas, 'utf8'), '// mine\n');
});

test('init without index.ts and LoginPage falls back to a TODO login', () => {
  const root = fakeProject({ withIndex: false, withLoginPage: false });
  const res = initProject({ rootDir: root });
  assert.equal(res.detected.appTest, undefined);
  const steps = fs.readFileSync(path.join(root, 'Tests/Playwright/docshots/steps/index.ts'), 'utf8');
  assert.match(steps, /export const test = mergeTests\(docshotTest\);/);
  assert.match(steps, /TODO: adapt to your login form/);
  assert.deepEqual(checkSetup(root, STEPS), []);
});
