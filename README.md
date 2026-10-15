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

**The same text twice on a page?** Narrow it down. This works in every step (click, fill, mark, arrow, scroll, screenshot, video):

```gherkin
Dann zeige mit einem Pfeil auf den Link "Impressum" in der Fußzeile mit "7"
Dann markiere den Button "Speichern" im Dialog "Person anlegen" mit "3"
Dann markiere den Link "Impressum" im Bereich "Rechtliches"        # named area from steps/index.ts
Wenn ich auf den zweiten Link "Impressum" klicke                    # ersten … fünften, letzten
Dann markiere den Link "Impressum" im Selektor "footer .legal"     # dev escape hatch
```

| Scope | Meaning |
|---|---|
| `in der Fußzeile` / `in the footer` | page footer (ARIA `contentinfo`, else the last `<footer>`) |
| `in der Kopfzeile`, `im Kopfbereich` / `in the header` | page header (`banner`, else `<header>`) |
| `in der Navigation` | first navigation |
| `in der Seitenleiste` / `in the sidebar` | `complementary` / `<aside>` |
| `im Hauptbereich`, `im Inhaltsbereich` | `main` |
| `im Dialog` | the open dialog |
| `im/in der <Art> "<Name>"` | inside any target or named area, e.g. `im Dialog "Person anlegen"` |

**Working in one area.** Set the area once instead of repeating the scope in every step:

```gherkin
Und ich arbeite in der Fußzeile                 # or: im Bereich "Hauptmenü", im Bereich "footer .feeds", im Dialog "Person anlegen"
Dann zeige mit einem Pfeil auf den Link "Impressum" mit "1"   # searched only inside the footer
Und markiere den Link "alle Updates" mit "2"
Und erstelle einen Screenshot                   # crops to the area
Und ich arbeite wieder auf der ganzen Seite
```

- Setting the area scrolls it into view.
- Targets of the following steps are searched inside it. A step with its own scope (`… in der Kopfzeile`) uses that instead.
- Screenshots and videos without their own target crop to the area, so arrows and notes are laid out around it. `Screenshot der ganzen Seite` stays a full-page shot.
- `ich öffne die Seite "…"` ends the area, and so does the end of the scenario.

**`Bereich "…"`** is looked up in this order:
1. a named area from `steps/index.ts`,
2. a page region (`Fußzeile`, `Kopfzeile`, …),
3. a CSS selector.

So `Screenshot vom Bereich "Hauptmenü"`, `vom Bereich "Fußzeile"` and `vom Bereich "footer .feeds"` all work. An invalid selector gives an error that lists the named areas.

If a target matches more than once, the error message says so and suggests these forms.
CSS selectors do not belong in the name: the name is always the visible text or label.

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

## Scrolling

```gherkin
Und ich scrolle zum Link "alle Updates"
Und scrolle den Link "alle Ereignisse" in den sichtbaren Bereich
Und ich scrolle ans Seitenende
Und ich scrolle nach oben
```

- The element is scrolled to the **center** of the viewport, not just to its edge, so arrows, numbers and notes have room. Scrollable containers are handled too.
- While a video records, scrolling is smooth so viewers can follow.
- **Safety net:** for viewport screenshots, markers outside the visible area are scrolled into view before the capture. If all of them fit, they end up centered together. An explicit scroll step is still clearer for readers of the steps.
- Elements at the very end of a page (footers) cannot be centered, so they stay at the bottom edge. Annotations then avoid the surrounding text as far as possible.
- `ich scrolle an den Anfang der Seite` / `ans Seitenende` scroll the window **and** inner scroll areas (app layouts often scroll a content `<div>`, not the window). They wait until the position is really reached, which matters with CSS `scroll-behavior: smooth` and lazy loading. If it isn't reached within 3 s, there is a warning.

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

Annotations are laid out together in the page, right before the capture. "Text" below means
the real text boxes on the page, measured per text node, so empty space inside wide table cells counts as free:

1. Outlines and their badges are fixed by the marked elements.
2. Each arrow tries 8 directions × 4 lengths, with its note beyond or beside the badge.
3. Every candidate is scored. Leaving the screenshot area (viewport, full page, or the crop of an element shot) costs the most. Next come crossing another arrow, another marked element, a badge or a note, and getting closer than 10 px to another badge or note. Covering page text costs least.
4. **Uniform first:** all arrows with the same direction and length, trying every combination. This is used if it works without any conflict and covers at most slightly more text than a free layout.
5. **Otherwise free:** arrows are placed in several orders (all orders for up to 4 arrows), each with two refinement passes, and the best total wins. Deviating from the other arrows' direction or length still costs a little, so only the arrows that have to deviate do.
6. Notes of outlines are placed before the arrows (so arrows avoid them) and once more afterwards.

For element shots the crop grows to include whatever was drawn for the marks inside it.
If a layout still has problems because there was no free space, the test gets a
`docshot-layout` annotation (visible in the HTML report) and a console warning, for example
`⚠ person-create [mobile-light-de]: Pfeile von Markierung 1 und Markierung 2 kreuzen sich`.
The final geometry is stored per image in `.docshots/manifest.json` (`layout`), and
`layoutProblems()` is exported for your own checks.

## Videos

The same steps that build screenshots can record videos. Start and stop anywhere in a scenario:

```gherkin
Szenario: person-create-video
  Angenommen ich bin angemeldet als "schooladmin"
  Und ich bin in der Personenverwaltung
  Dann starte ein Video                                   # whole viewport
  Und zeige den Titel "Person anlegen" mit der Beschreibung "In drei Schritten"
  Und zeige mit einem Pfeil auf den Button "Neue Person" und mit "1" und dem Hinweis "Hier starten"
  Wenn ich auf den Button "Neue Person" klicke
  Und blende die Markierungen aus
  Und ich fülle das Feld "Vorname" mit "Max" aus
  Und markiere das Feld "Vorname" mit "2"
  Und blende die Markierung "2" aus
  Und markiere den Button "Speichern" mit "3" und Hinweis "Zum Abschluss"
  Dann beende das Video
```

- `Dann starte ein Video vom Formular "Person anlegen"` crops the video to an element, like element screenshots. The crop is fixed when recording starts, so the element should not move.
- `Wenn ich ein Video "teil-2" … starte` names it; a scenario can record several videos one after another (`<id>-<name>`).
- While recording, markers and masks appear immediately and follow their elements after clicks.
- Markers are removed with `blende die Markierungen aus` (all), `blende die Markierung "2" aus` (by number) or `entferne die Markierung vom Feld "Vorname"` (by target). These steps also work before screenshots.
- `zeige den Titel "…"` shows a title card. It only appears while a video is recording; in screenshots it does nothing.
- An animated mouse pointer shows clicks. After each action the video pauses (`stepDelay`), and after markers change it pauses longer (`markDelay`), so viewers can follow.
- Screenshots in the middle of a video work. The video simply doesn't show the moment of the screenshot.
- A missing `Dann beende das Video` doesn't lose the recording: it is saved at the end of the scenario, with a warning.

Videos are rendered per variant (viewport × theme × language), like screenshots, and listed in
`.docshots/manifest.json` with `"kind": "video"`, duration and size.

```ts
// docshots.config.ts
video: {
  output: 'Documentation/Videos/{id}/{viewport}-{scheme}-{lang}.mp4',
  format: 'mp4',        // 'mp4' (H.264, plays everywhere) or 'webm' (VP9)
  fps: 25,
  cursor: true,         // animated pointer and click marks
  stepDelay: 700,       // pause after each action (ms)
  markDelay: 1200,      // pause after markers change (ms)
  hold: 800,            // still frames at start and end (ms)
  padding: 48,          // around element videos (px)
  // ffmpeg: '/usr/bin/ffmpeg',
},
```

**Requirements**
- **Playwright 1.59 or newer** for `page.screencast`.
- **ffmpeg.** The system ffmpeg is used (`apt install ffmpeg`, or in the official Playwright Docker image install it with apt). Alternatives are `npm i -D ffmpeg-static`, or `DOCSHOTS_FFMPEG=/path/to/ffmpeg`. Playwright's own bundled ffmpeg is not needed. `docshots lint` warns when scenarios record videos and no ffmpeg is found.

Videos are recorded at CSS pixel size (1×), so a 1280×800 desktop viewport gives a 1280×800 video
even with `deviceScaleFactor: 2`.

To embed a video in RST, use whatever your renderer supports. With raw HTML enabled, for example:

```rst
..  raw:: html

    <video controls muted src="../Videos/person-create-video/desktop-light-de.mp4"></video>
```

## Update mode: render only what changed

```bash
npx docshots status            # what is new / changed / missing – no browser
npx docshots update            # render only those recipes (= docshots test --changed)
npx docshots status --check    # exit code 1 if images are outdated (CI)
```

Every scenario ("recipe") gets a fingerprint made of:
- its steps, including the `Grundlage`/Background, tags and language,
- the config parts that change every image: variants, output paths, theme, padding, mask colour, video, clock,
- the package version,
- the content of your step files (the `steps` globs).

`docshots.lock.json` (configurable with `lockFile`) stores the fingerprint and the produced files
of the last successful run. Commit it together with the images. A recipe is rendered again when:

| Status | Meaning |
|---|---|
| `+ neu` | not in the lock file yet |
| `~ geändert` | steps, tags, Background, config or step files changed |
| `! Dateien fehlen` | an image or video listed in the lock file is missing |
| `- entfernt` | the recipe is gone (images are not deleted automatically) |

How it behaves:
- The lock file is updated after **every** run (`test` and `update`), for recipes that passed in all variants that ran. Failed recipes stay outdated, so the next `update` tries them again.
- Partial runs (`--grep`, `--project`) only record what actually ran.
- Changes to the **application itself** (new layout, renamed buttons) cannot be seen from the steps. Run a full `docshots test` for that, e.g. nightly or before a release. Changes in page objects or fixtures outside the `steps` globs also need a full run.

## CLI

```bash
npx docshots init                  # create docshots.config.ts, steps/index.ts, personas.ts
npx docshots lint                  # no browser: syntax, duplicate IDs, unknown steps (errors point to file.rst:line)
npx docshots test                  # extract + bddgen + playwright test + manifest + lock file
npx docshots update                # only new/changed recipes (see "Update mode")
npx docshots status [--check]      # what would be rendered
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

docshots:                                             # merge requests: only what changed
  image: mcr.microsoft.com/playwright:v1.64.1-noble
  needs: [docshots:lint]
  variables: { BASE_URL: "$REVIEW_APP_URL" }       # seeded review environment
  before_script: [apt-get update -qq && apt-get install -y -qq ffmpeg]   # only needed for videos
  script: [npm ci, npx docshots update]               # nightly / release: npx docshots test
  artifacts:
    paths: [Documentation/Images/Screenshots, Documentation/Videos, docshots.lock.json, .docshots/manifest.json, .docshots/report]
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

Your own steps can use these through the `docshot` fixture:
- `docshot.highlight(locator, { label, note })`, `docshot.pointAt(…)` and `docshot.mask(…)`,
- `docshot.hideMarks({ label } | { description })`,
- `docshot.capture({ target, fullPage, name })`,
- `docshot.startVideo({ target, name })`, `docshot.showTitle(title, description)` and `docshot.stopVideo()`.
