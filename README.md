# playwright-docshots

Documentation screenshots from plain-language Gherkin steps, embedded in RST
(TYPO3 documentation style) or in separate `.feature` files. Runs on Playwright
and [playwright-bdd](https://github.com/vitalets/playwright-bdd) and reuses your
existing fixtures and page objects.

- **Support staff** write steps like `Wenn ich auf den Button "Neue Person" klicke`.
- **Devs** provide the login adapter, named areas and optional domain steps.
- **Every scenario** produces one screenshot set across viewport × light/dark × language.
- **Annotations** are outlines, numbered badges, notes, arrows and masks. They also work inside modal dialogs (top layer).

```
Documentation/**/*.rst ──extract──► .docshots/generated/*.feature ─┐
Documentation/Screenshots/**/*.feature ────────────────────────────┼─► bddgen ─► playwright test
                                                                   ┘
                     ► Documentation/Images/Screenshots/<id>/<viewport>-<scheme>-<lang>.png
```

## Install

```bash
npm i -D @fucodo/playwright-docshots @playwright/test playwright-bdd
```

`@playwright/test` and `playwright-bdd` are peer dependencies, so the project
decides their versions and only one Playwright copy is loaded.

## Setup (4 files)

The quick way: `npx docshots init` creates the first three files below. It detects your
`playwright.config.ts`, an `index.ts` exporting `test`, and a `LoginPage` with
`completeLogin()`, and uses them in the generated code. Existing files are not
overwritten (`--force` replaces them), and `.docshots/` is added to `.gitignore`.

```bash
npx docshots init                         # default folder: Tests/Playwright (or what exists)
npx docshots init --dir e2e --lang en
```

Every `lint` and `test` checks this setup and warns before anything else goes wrong:
- no step files match `steps`,
- no file calls `registerDocshotSteps()`,
- a relative import such as `../personas` points to a missing file,
- `docshotTest` is not merged in,
- the login adapter, or personas/credentials, are missing.

### 1. `docshots.config.ts`

```ts
import { defineDocshotConfig } from '@fucodo/playwright-docshots';
import baseConfig from './Tests/Playwright/playwright.config';   // reuse baseURL, webServer, timeouts …

export default defineDocshotConfig({
  base: baseConfig,
  language: 'de',                          // Gherkin language of RST blocks (or (file) => 'de' | 'en')
  sources: {
    rst: ['Documentation/**/*.rst'],
    features: ['Documentation/Screenshots/**/*.feature'],
  },
  steps: ['Tests/Playwright/docshots/steps/**/*.ts'],
  variants: {
    viewports: { desktop: { width: 1280, height: 800, deviceScaleFactor: 2 }, mobile: 'iPhone 13' },
    schemes: ['light', 'dark'],
    languages: { de: {}, en: {} },         // → Accept-Language header + locale; override: { headers: {...}, locale: 'en-GB' }
  },
  output: 'Documentation/Images/Screenshots/{id}/{viewport}-{scheme}-{lang}.png',
  keepClean: true,                         // also *.clean.png without annotations
  clock: '2026-09-15T09:30:00+02:00',      // frozen browser time
  theme: { color: '#d50c2f' },             // annotation colour
  maskColor: '#c9ced8',
});
```

All device presets run in Chromium by default, for consistent rendering
(`browserName: 'device-default'` keeps e.g. WebKit for iPhones).

### 2. Steps entry point: one shared `test`

```ts
// Tests/Playwright/docshots/steps/index.ts
import { mergeTests } from '@playwright/test';
import { docshotTest, registerDocshotSteps } from '@fucodo/playwright-docshots';
import { test as appTest } from '@playwright-common/index';
import { LoginPage } from '@playwright-common/pages/login-page';
import { personas } from '../personas';

export const test = mergeTests(appTest, docshotTest);

export const { Given, When, Then } = registerDocshotSteps(test, {
  personas,
  login: async ({ page, credentials }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.completeLogin(credentials.username, credentials.password);
  },
  areas: {
    'Formular "Person anlegen"': (page) => page.locator('dialog[open]'),
    'Hauptmenü': (page) => page.getByRole('navigation'),   // usable as: Bereich "Hauptmenü"
  },
});
```

`docshotTest` extends playwright-bdd's `test`, so the merged object is a valid
base for `createBdd()`. Your E2E tests stay untouched.

### 3. Personas, without passwords in the repo

```ts
// Tests/Playwright/docshots/personas.ts
export const personas: PersonaRegistry = {
  schooladmin: { username: 'doc-schooladmin', passwordEnv: 'DOCSHOT_PW_SCHOOLADMIN' },
};
```

Password lookup order:
1. the password given in the step (`… mit Passwort "…"`)
2. `password` in the registry
3. the variable named in `passwordEnv`
4. `DOCSHOT_PW_<PERSONA>`

For a vault or CLI lookup, pass `credentials: async (persona) => ({ persona, username, password })` instead.

### 4. Optional domain steps on top of your page objects

```ts
// Tests/Playwright/docshots/steps/persons.steps.ts
import { Given } from './index';

Given('ich bin in der Personenverwaltung', async ({ personsListPage }) => {
  await personsListPage.goto();
});
```

## Writing screenshots

### Embedded in RST

The block is an RST comment (no `::`), so the renderer ignores it.

```rst
..  docshot: person-create
    @viewports:desktop,mobile
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich bin in der Personenverwaltung
    Wenn ich auf den Button "Neue Person" klicke
    Und ich fülle das Feld "Vorname" mit "Max" aus
    Dann markiere das Feld "Vorname" mit "1"
    Und markiere das Feld "E-Mail" mit "2" und Hinweis "Pflichtfeld"
    Und erstelle einen Screenshot vom Formular "Person anlegen"

..  figure:: /Images/Screenshots/person-create/desktop-light-de.png
```

- The ID after `docshot:` names the set and must be unique across RST and `.feature` files. This is checked.
- A block runs only in the language of its document (an automatic `@lang:<language>` tag), because German steps only work against the German UI. To change this, set a different `@lang:` tag, or put `..  docshot-language: en` in the file.

### Separate `.feature` files

These are for long flows, `Grundlage:` (Background), outlines, or images without a single doc location.

```gherkin
# language: de
@lang:de
Funktionalität: Person anlegen – Ablauf
  Grundlage:
    Angenommen ich bin angemeldet als "schooladmin"
  Szenario: person-create-flow
    Wenn ich den Dialog zum Anlegen einer Person öffne
    Dann erstelle einen Screenshot "leer" vom Formular "Person anlegen"
```

Several screenshots in one scenario get a name, and are written to `<id>-<name>/…`.

### Tags

| Tag | Effect |
|---|---|
| `@viewports:desktop,mobile` | only these viewports |
| `@schemes:light` | only these colour schemes |
| `@lang:de` | only these languages (set automatically for RST blocks) |
| `@id:my-id` | screenshot ID other than the scenario name |

### Targets

Write a target as `<Art> "<Name>"`, with an optional article (`den`, `die`, `das`, `the` …):

| Art (de / en) | Locator |
|---|---|
| Button, Schaltfläche / button | `getByRole('button', { name, exact })` |
| Feld, Eingabefeld / field | `getByLabel(name, { exact })` |
| Link, Tab, Menüpunkt, Checkbox, Radio, Auswahl, Überschrift, Dialog | matching ARIA role |
| Zeile / row | row containing the text |
| Text | `getByText(name, { exact })` |
| Bereich "X" / area "X" | `areas['X']` |
| anything else, e.g. Formular "X" | `areas['Formular "X"']` |
| Selektor / selector | raw CSS (dev escape hatch) |

German steps accept both word orders: `ich klicke auf …` and `… wenn ich auf … klicke`.
`npx docshots steps --out Documentation/Screenshots/Schritte.rst` writes the full
step list, including your project steps, as an RST page.

## Converting old screenshots: `docshots from-image`

The command turns an existing, hand-made screenshot into a `docshot` block:

```bash
npx docshots from-image Documentation/Images/benutzer-anlegen.png --url /administration/persons --persona schooladmin --insert
npx docshots from-image Documentation/Images/benutzer-anlegen.png     # asks for URL and persona
```

1. It logs in through **your** login adapter and opens the URL. If `--url` or the image is missing, it asks for them.
2. It sends the old image, a screenshot of the live page, the ARIA snapshot, the allowed sentences and your named areas to a vision model.
3. It **dry-runs** the proposed steps against the live page. A wrong step (unknown sentence, element not found, ambiguous target) goes back to the model with a fresh snapshot, for up to `--attempts` rounds (default 3).
4. It prints the block, any notes (e.g. "the button is now called …"), the old image and a preview of the new one for comparison.
5. With `--insert`, it puts the block above the `figure`/`image` that uses the old image, and switches that path to the new screenshot.

The steps use the labels of the **current** UI; differences from the old image are listed as notes.
Project-specific steps are offered to the model, but cannot be dry-run (they are skipped there).

Configure it in `.env`; the variables are read from the environment, and `.env` is loaded without overriding existing values:

```dotenv
DOCSHOTS_AI_BASE_URL=https://api.openai.com/v1   # any OpenAI-compatible API: LiteLLM, Ollama, vLLM, LM Studio …
DOCSHOTS_AI_API_KEY=sk-…                         # falls back to OPENAI_API_KEY; may be empty for local servers
DOCSHOTS_AI_MODEL=gpt-4o                         # must accept images; falls back to OPENAI_MODEL
DOCSHOTS_AI_JSON_MODE=true                       # set false if the server rejects response_format
DOCSHOTS_AI_MAX_IMAGE_SIDE=2000                  # images are scaled down before sending
DOCSHOTS_AI_TIMEOUT_MS=180000
```

Images and the page's ARIA snapshot are sent to the configured API, so use a self-hosted
model when screenshots may contain personal data.

## Marking steps

Every marking step takes the same optional suffixes, in this order: a number, then a note.

```gherkin
Dann markiere den Button "Speichern"
Dann markiere das Feld "Vorname" mit "1"
Dann markiere das Feld "E-Mail" mit "2" und Hinweis "Pflichtfeld"
Dann zeige mit einem Pfeil auf den Link "Hilfe"
Dann zeige mit einem Pfeil auf den Link "Hilfe" und mit "2" und dem Hinweis "Pflichtfeld"
Und verdecke das Feld "E-Mail"
```

- The number can be written `mit "1"` or `und mit "1"`.
- The note can be written `und Hinweis "…"`, `und dem Hinweis "…"` or `mit dem Hinweis "…"`.
- English: `with "1"`, `and note "…"`, `and with "2" and the note "…"`.

Annotations are laid out together in the page, right before the capture:

1. Outlines and their badges are fixed by the marked elements.
2. Each arrow tries 8 directions × 4 lengths, with its note beyond or beside the badge.
3. Every candidate is scored. Leaving the screenshot area (viewport, full page, or the crop of an element shot) costs the most. Next come crossing another arrow, another marked element, a badge or a note, and getting closer than 10 px to another badge or note. Covering page text costs least.
4. Arrows are placed one after another, then each one is placed again with all others in place (two refinement passes).
5. Notes of outlines are placed last, avoiding everything above.

For element shots the crop grows to include whatever was drawn for the marks inside it.
If a layout still has problems because there was no free space, the test gets a
`docshot-layout` annotation (visible in the HTML report) and a console warning, for example
`⚠ person-create [mobile-light-de]: Pfeile von Markierung 1 und Markierung 2 kreuzen sich`.
The final geometry is stored per image in `.docshots/manifest.json` (`layout`), and
`layoutProblems()` is exported for your own checks.

## CLI

```bash
npx docshots init                  # create docshots.config.ts, steps/index.ts, personas.ts
npx docshots lint                  # no browser: syntax, duplicate IDs, unknown steps (errors point to file.rst:line)
npx docshots test                  # extract + bddgen + playwright test + manifest
npx docshots test --grep person-create --project desktop-light-de
npx docshots steps --out Documentation/Screenshots/Schritte.rst
npx docshots from-image <old.png> [--url /path] [--persona name] [--insert]
```

`.docshots/manifest.json` lists every image with its variant, annotation
rectangles and source. The Playwright HTML report is in `.docshots/report`.

## GitLab CI sketch

```yaml
docshots:lint:
  image: mcr.microsoft.com/playwright:v1.64.1-noble
  rules: [{ changes: ["Documentation/**/*"] }]
  script: [npm ci, npx docshots lint]

docshots:
  image: mcr.microsoft.com/playwright:v1.64.1-noble
  needs: [docshots:lint]
  variables: { BASE_URL: "$REVIEW_APP_URL" }       # seeded review environment
  script: [npm ci, npx docshots test]
  artifacts:
    paths: [Documentation/Images/Screenshots, .docshots/manifest.json, .docshots/report]
```

## Stability

Before every capture the fixture does the following:
- waits for network idle and fonts,
- disables animations and hides the caret,
- blurs the focused element,
- freezes the clock (if `clock` is set).

Annotations are measured right before capture, and drawn as one layer that is
promoted into the top layer, so they appear above modal `<dialog>`s and popovers.

## Programmatic API

`docshot.highlight(locator, { label, note })`, `docshot.pointAt(…)`, `docshot.mask(…)` and
`docshot.capture({ target, fullPage, name })` are available to your own steps
through the `docshot` fixture.
