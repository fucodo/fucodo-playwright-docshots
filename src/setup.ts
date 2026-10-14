import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

// ── checks ─────────────────────────────────────────────────────────────────

export interface SetupWarning {
  message: string;
  hint?: string;
}

const REGISTER = /\bregisterDocshotSteps\s*\(/;
const relativeImports = (code: string) =>
  [...code.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.mts`, path.join(base, 'index.ts'), path.join(base, 'index.js')];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

/**
 * Checks the project side of the setup. Purely static (reads files, no imports),
 * so it can run while the config loads and in `docshots lint`.
 */
export function checkSetup(rootDir: string, stepPatterns: string[]): SetupWarning[] {
  const warnings: SetupWarning[] = [];
  const init = 'Anlegen mit: npx docshots init';
  const files = fg.sync(stepPatterns, { cwd: rootDir, absolute: true });

  if (files.length === 0) {
    warnings.push({
      message: `Keine Schritt-Dateien gefunden für "steps": ${stepPatterns.join(', ')} (relativ zu ${rootDir}).`,
      hint: init,
    });
    return warnings;
  }

  // broken relative imports in any step file (e.g. persons.steps.ts → './index' that was never created)
  for (const f of files) {
    for (const spec of relativeImports(fs.readFileSync(f, 'utf8'))) {
      if (!resolveImport(f, spec)) {
        warnings.push({
          message: `${path.relative(rootDir, f)} importiert "${spec}", die Datei fehlt.`,
          hint: /persona|index/i.test(spec) ? `${init}  (erzeugt Schritt-Datei und Personas)` : undefined,
        });
      }
    }
  }

  const registering = files.filter((f) => REGISTER.test(fs.readFileSync(f, 'utf8')));
  if (registering.length === 0) {
    warnings.push({
      message: 'Keine Schritt-Datei ruft registerDocshotSteps() auf – die eingebauten Schritte fehlen, jeder Schritt gilt als unbekannt.',
      hint: `${init}  (erzeugt z. B. Tests/Playwright/docshots/steps/index.ts)`,
    });
    return warnings;
  }
  if (registering.length > 1) {
    warnings.push({
      message: `registerDocshotSteps() wird in mehreren Dateien aufgerufen: ${registering.map((f) => path.relative(rootDir, f)).join(', ')} – Schritte wären doppelt definiert.`,
    });
  }

  const file = registering[0];
  const rel = path.relative(rootDir, file);
  const code = fs.readFileSync(file, 'utf8');

  if (!/\bdocshotTest\b/.test(code)) {
    warnings.push({ message: `${rel} verwendet docshotTest nicht – Screenshot- und Markierungs-Schritte haben kein docshot-Fixture.`, hint: 'export const test = mergeTests(appTest, docshotTest);' });
  }
  if (!/\blogin\s*[:(]/.test(code)) {
    warnings.push({ message: `${rel} definiert keinen login-Adapter – "ich bin angemeldet als …" schlägt fehl.` });
  }
  if (!/\b(personas|credentials)\b/.test(code)) {
    warnings.push({ message: `${rel} übergibt weder personas noch credentials – Anmelde-Schritte finden keine Zugangsdaten.` });
  }
  return warnings;
}

export function formatWarnings(warnings: SetupWarning[]): string {
  if (!warnings.length) return '';
  return (
    '\n⚠ docshots: Einrichtung unvollständig\n' +
    warnings.map((w) => `  • ${w.message}${w.hint ? `\n    → ${w.hint}` : ''}`).join('\n') +
    '\n\n'
  );
}

// ── init ───────────────────────────────────────────────────────────────────

export interface InitOptions {
  rootDir: string;
  /** Base folder for the Playwright tests, default: Tests/Playwright (or what exists) */
  dir?: string;
  force?: boolean;
  language?: 'de' | 'en';
}

export interface InitResult {
  created: string[];
  skipped: string[];
  detected: { baseConfig?: string; appTest?: string; loginPage?: string };
  gitignoreUpdated: boolean;
}

const posix = (p: string) => p.split(path.sep).join('/');
const importPath = (fromDir: string, file: string) => {
  let rel = posix(path.relative(fromDir, file)).replace(/\.(ts|js|mts)$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
};

function findFirst(rootDir: string, candidates: string[]): string | undefined {
  return candidates.map((c) => path.join(rootDir, c)).find((c) => fs.existsSync(c));
}

function exportsTest(file: string): boolean {
  const code = fs.readFileSync(file, 'utf8');
  return /export\s+const\s+test\b/.test(code) || /export\s*\{[^}]*\btest\b[^}]*\}/.test(code);
}

function findLoginPage(testsDir: string): { file: string; hasGoto: boolean } | undefined {
  for (const file of fg.sync(['**/*login*page*.ts', '**/*Login*Page*.ts'], { cwd: testsDir, absolute: true, ignore: ['**/node_modules/**'] })) {
    const code = fs.readFileSync(file, 'utf8');
    if (/export\s+class\s+LoginPage\b/.test(code) && /\bcompleteLogin\s*\(/.test(code)) {
      return { file, hasGoto: /\bgoto\s*\(/.test(code) };
    }
  }
  return undefined;
}

export function initProject(opts: InitOptions): InitResult {
  const { rootDir } = opts;
  const dir = opts.dir ?? (['Tests/Playwright', 'tests/playwright', 'tests', 'e2e'].find((d) => fs.existsSync(path.join(rootDir, d))) ?? 'Tests/Playwright');
  const testsDir = path.join(rootDir, dir);
  const docshotsDir = path.join(testsDir, 'docshots');
  const stepsDir = path.join(docshotsDir, 'steps');
  const lang = opts.language ?? 'de';

  const baseConfig = findFirst(rootDir, [`${dir}/playwright.config.ts`, 'playwright.config.ts', `${dir}/playwright.config.js`, 'playwright.config.js']);
  const appIndex = findFirst(rootDir, [`${dir}/index.ts`, `${dir}/fixtures/index.ts`, `${dir}/fixtures.ts`]);
  const appTest = appIndex && exportsTest(appIndex) ? appIndex : undefined;
  const loginPage = findLoginPage(testsDir);

  const configFile = path.join(rootDir, 'docshots.config.ts');
  const stepsFile = path.join(stepsDir, 'index.ts');
  const personasFile = path.join(docshotsDir, 'personas.ts');

  const files: Record<string, string> = {
    [configFile]: configTemplate(rootDir, dir, baseConfig, lang),
    [stepsFile]: stepsTemplate(stepsDir, personasFile, appTest, loginPage),
    [personasFile]: personasTemplate(),
  };

  const result: InitResult = {
    created: [],
    skipped: [],
    detected: {
      baseConfig: baseConfig && posix(path.relative(rootDir, baseConfig)),
      appTest: appTest && posix(path.relative(rootDir, appTest)),
      loginPage: loginPage && posix(path.relative(rootDir, loginPage.file)),
    },
    gitignoreUpdated: false,
  };

  for (const [file, content] of Object.entries(files)) {
    const rel = posix(path.relative(rootDir, file));
    if (fs.existsSync(file) && !opts.force) {
      result.skipped.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    result.created.push(rel);
  }

  const gitignore = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignore)) {
    const current = fs.readFileSync(gitignore, 'utf8');
    if (!/^\/?\.docshots\/?$/m.test(current)) {
      fs.appendFileSync(gitignore, `${current.endsWith('\n') || current === '' ? '' : '\n'}.docshots/\n`);
      result.gitignoreUpdated = true;
    }
  }
  return result;
}

function configTemplate(rootDir: string, dir: string, baseConfig: string | undefined, lang: 'de' | 'en'): string {
  const baseImport = baseConfig ? `import baseConfig from '${importPath(rootDir, baseConfig)}';\n` : '';
  const base = baseConfig
    ? '  base: baseConfig,                         // reuses baseURL, webServer, timeouts …\n'
    : "  // base: baseConfig,                      // import your playwright.config.ts to reuse baseURL, webServer …\n  base: { use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8080' } },\n";
  return `import { defineDocshotConfig } from '@fucodo/playwright-docshots';
${baseImport}
export default defineDocshotConfig({
${base}  language: '${lang}',

  sources: {
    rst: ['Documentation/**/*.rst'],
    features: ['Documentation/Screenshots/**/*.feature'],
  },
  steps: ['${posix(dir)}/docshots/steps/**/*.ts'],

  variants: {
    viewports: {
      desktop: { width: 1280, height: 800, deviceScaleFactor: 2 },
      mobile: 'iPhone 13',
    },
    schemes: ['light', 'dark'],
    languages: { ${lang}: {} },             // more languages: { de: {}, en: {} }
  },

  output: 'Documentation/Images/Screenshots/{id}/{viewport}-{scheme}-{lang}.png',
  keepClean: true,
  // clock: '2026-09-15T09:30:00+02:00',   // freeze time for stable dates
  // theme: { color: '#d50c2f' },
});
`;
}

function stepsTemplate(stepsDir: string, personasFile: string, appTest: string | undefined, loginPage: { file: string; hasGoto: boolean } | undefined): string {
  const imports = [
    "import { mergeTests } from '@playwright/test';",
    "import { docshotTest, registerDocshotSteps } from '@fucodo/playwright-docshots';",
    appTest ? `import { test as appTest } from '${importPath(stepsDir, appTest)}';` : undefined,
    loginPage ? `import { LoginPage } from '${importPath(stepsDir, loginPage.file)}';` : undefined,
    `import { personas } from '${importPath(stepsDir, personasFile)}';`,
  ].filter(Boolean);

  const testLine = appTest
    ? '/** One test object for built-in and project steps – your fixtures + the docshot fixture. */\nexport const test = mergeTests(appTest, docshotTest);'
    : '/** No merged app test found – add your fixtures here: mergeTests(appTest, docshotTest) */\nexport const test = mergeTests(docshotTest);';

  const login = loginPage
    ? `  // Reuses your LoginPage page object.
  login: async ({ page, credentials }) => {
    const loginPage = new LoginPage(page);
${loginPage.hasGoto ? '    await loginPage.goto();\n' : "    await page.goto('/login'); // TODO: login URL\n"}    await loginPage.completeLogin(credentials.username, credentials.password);
  },`
    : `  // TODO: adapt to your login form (or use your LoginPage page object).
  login: async ({ page, credentials }) => {
    await page.goto('/login');
    await page.getByLabel('Benutzername').fill(credentials.username);
    await page.getByLabel('Passwort').fill(credentials.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  },`;

  return `${imports.join('\n')}

${testLine}

export const { Given, When, Then } = registerDocshotSteps(test, {
  personas,

${login}

  // Named areas for things without a clean accessible name.
  // Key: the exact phrase support staff write (e.g. 'Formular "Person anlegen"'),
  // or a plain name, usable as: Bereich "Hauptmenü".
  areas: {
    // 'Formular "Person anlegen"': (page) => page.locator('dialog[open]'),
    // 'Hauptmenü': (page) => page.getByRole('navigation'),
  },
});
`;
}

function personasTemplate(): string {
  return `import type { PersonaRegistry } from '@fucodo/playwright-docshots';

// No real passwords in the repo – only where to find them (CI variables / local .env).
// Usage in steps: Angenommen ich bin angemeldet als "admin"
export const personas: PersonaRegistry = {
  admin: { username: 'doc-admin', passwordEnv: 'DOCSHOT_PW_ADMIN' },
};
`;
}
