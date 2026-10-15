import type { Locator, Page } from '@playwright/test';
import type { Docshot } from '../fixture';
import type { DocshotLanguage } from '../sources/rst';
import { describeTarget, LANDMARK_WORDS_DE, LANDMARK_WORDS_EN, ORDINAL_WORDS, type TargetRefinement } from './targets';

/**
 * The built-in step vocabulary.
 *
 * Every pattern only uses *named* groups, so the same handler works with
 * different word orders ("ich klicke auf …" / "… auf … klicke").
 * Keep patterns ASCII-safe (no /u flag) – cucumber-expressions re-parses them.
 */

export interface VocabContext {
  page: Page;
  docshot: Docshot;
  target(kind: string, name: string, refine?: TargetRefinement): Locator;
  login(persona: string, password?: string): Promise<void>;
  /** scroll an element to the center of the viewport (smooth while a video records) */
  scrollTo(target: Locator): Promise<void>;
  scrollPage(where: 'top' | 'bottom'): Promise<void>;
  /** set (or with undefined: clear) the active area */
  setArea(spec: { kind?: string; name?: string; landmark?: string } | undefined): Promise<void>;
}

export type VocabArgs = Record<string, string | undefined>;

export interface VocabEntry {
  key: string;
  keyword: 'Given' | 'When' | 'Then';
  group: 'Anmeldung' | 'Navigation' | 'Eingaben' | 'Warten' | 'Markieren' | 'Screenshot' | 'Video';
  patterns: Record<DocshotLanguage, RegExp[]>;
  examples: Record<DocshotLanguage, string[]>;
  run(ctx: VocabContext, args: VocabArgs): Promise<void>;
}

const LETTERS = 'A-Za-zÄÖÜäöüß';
const ART = '(?:(?:den|die|das|dem|der|einen|eine|ein|the|a|an) )?';
// Target: [article] [ordinal] <Kind> "<name>" [in <scope>]
//   den Link "Impressum"
//   den zweiten Link "Impressum"            → n-th match (ersten … fünften, letzten / first … last)
//   den Link "Impressum" in der Fußzeile    → inside a page region (landmark)
//   den Button "Speichern" im Dialog "X"    → inside another target or named area
const ORDINAL = `(?:(?<nth>${[...ORDINAL_WORDS].sort((a, b) => b.length - a.length).join('|')}) )?`;
const LANDMARK = [...LANDMARK_WORDS_DE, ...LANDMARK_WORDS_EN].sort((a, b) => b.length - a.length).join('|');
const SCOPE =
  `(?: (?:in|im|innerhalb|inside|within)(?: (?:von|of))?(?: (?:der|dem|des|den|die|das|the))? ` +
  `(?:(?<landmark>${LANDMARK})(?! ")|(?<scopeKind>[${LETTERS}]+) "(?<scopeName>[^"]*)"))?`;
const T = `${ART}${ORDINAL}(?<kind>[${LETTERS}]+) "(?<name>[^"]*)"${SCOPE}`;
const Q = (name: string) => `"(?<${name}>[^"]*)"`;
// One shared suffix for every marking step (markiere / zeige mit einem Pfeil / …):
//   … mit "1"   … und mit "1"   … und Hinweis "x"   … und dem Hinweis "x"   … mit dem Hinweis "x"
// Number and note are optional and can be combined: … und mit "2" und dem Hinweis "Pflichtfeld"
const LABEL_NOTE_DE = `(?: (?:und )?mit (?:der Nummer )?${Q('label')})?(?: (?:und|mit) (?:dem )?Hinweis ${Q('note')})?`;
const LABEL_NOTE_EN = `(?: (?:and )?with (?:label |number )?${Q('label')})?(?: (?:and|with) (?:a |the )?note ${Q('note')})?`;
const re = (...parts: string[]) => new RegExp(`^${parts.join('')}$`);

const refinement = (a: VocabArgs): TargetRefinement => ({ nth: a.nth, scopeKind: a.scopeKind, scopeName: a.scopeName, landmark: a.landmark });
const target = (ctx: VocabContext, a: VocabArgs) => ctx.target(a.kind!, a.name!, refinement(a));
const describe = (a: VocabArgs) => describeTarget(a.kind!, a.name!, refinement(a));
const opt = (v: string | undefined) => (v === undefined || v === null || v === '' ? undefined : v);

export const VOCABULARY: VocabEntry[] = [
  // ── Anmeldung ────────────────────────────────────────────────────────────
  {
    key: 'login', keyword: 'Given', group: 'Anmeldung',
    patterns: {
      de: [
        re('ich bin (?:als ', Q('persona'), ' angemeldet|angemeldet als ', Q('persona2'), ')', `(?: mit (?:dem )?Passwort ${Q('password')})?`),
        re('ich melde mich als ', Q('persona'), `(?: mit (?:dem )?Passwort ${Q('password')})?`, ' an'),
        re('ich mich als ', Q('persona'), `(?: mit (?:dem )?Passwort ${Q('password')})?`, ' anmelde'),
      ],
      en: [
        re('I am logged in as ', Q('persona'), `(?: with password ${Q('password')})?`),
        re('I log in as ', Q('persona'), `(?: with password ${Q('password')})?`),
      ],
    },
    examples: {
      de: ['Angenommen ich bin angemeldet als "schooladmin"', 'Wenn ich mich als "teacher" anmelde'],
      en: ['Given I am logged in as "schooladmin"'],
    },
    run: (ctx, a) => ctx.login((a.persona ?? a.persona2)!, opt(a.password)),
  },

  // ── Navigation ───────────────────────────────────────────────────────────
  {
    key: 'open', keyword: 'Given', group: 'Navigation',
    patterns: {
      de: [re('ich öffne (?:die Seite )?', Q('url')), re('ich (?:die Seite )?', Q('url'), ' öffne')],
      en: [re('I open (?:the page )?', Q('url')), re('I am on (?:the page )?', Q('url'))],
    },
    examples: { de: ['Wenn ich die Seite "/administration/persons" öffne'], en: ['When I open the page "/administration/persons"'] },
    run: async (ctx, a) => { await ctx.setArea(undefined); await ctx.page.goto(a.url!); },
  },
  {
    key: 'navigate', keyword: 'When', group: 'Navigation',
    patterns: {
      de: [re('ich navigiere zu ', Q('name')), re('ich zu ', Q('name'), ' navigiere')],
      en: [re('I navigate to ', Q('name')), re('I go to ', Q('name'))],
    },
    examples: { de: ['Wenn ich zu "Personen" navigiere'], en: ['When I navigate to "Persons"'] },
    run: async (ctx, a) => {
      const { page } = ctx;
      const name = a.name!;
      await page.getByRole('link', { name, exact: true })
        .or(page.getByRole('menuitem', { name, exact: true }))
        .or(page.getByRole('tab', { name, exact: true }))
        .first()
        .click();
      await page.waitForLoadState();
    },
  },
  {
    key: 'click', keyword: 'When', group: 'Navigation',
    patterns: {
      de: [re('ich klicke auf ', T), re('ich auf ', T, ' klicke')],
      en: [re('I click (?:on )?', T)],
    },
    examples: {
      de: ['Wenn ich auf den Button "Neue Person" klicke', 'Und ich klicke auf den Tab "Mitgliedschaften"', 'Wenn ich auf den zweiten Link "Impressum" klicke', 'Und ich klicke auf den Button "Speichern" im Dialog "Person anlegen"'],
      en: ['When I click the button "New person"', 'When I click the link "Imprint" in the footer'],
    },
    run: (ctx, a) => target(ctx, a).click(),
  },
  {
    key: 'scroll', keyword: 'When', group: 'Navigation',
    patterns: {
      de: [
        re('(?:ich )?scrolle (?:zu|zur|zum|bis zu|bis zur|bis zum) ', T),
        re('ich (?:zu|zur|zum|bis zu|bis zur|bis zum) ', T, ' scrolle'),
        re('(?:ich )?(?:scrolle|hole) ', T, ' in den (?:sichtbaren Bereich|Blick)'),
        re('ich ', T, ' in den (?:sichtbaren Bereich|Blick) (?:scrolle|hole)'),
      ],
      en: [re('(?:I )?scroll (?:down |up )?to ', T), re('(?:I )?scroll ', T, ' into view')],
    },
    examples: {
      de: ['Und ich scrolle zum Link "alle Updates"', 'Und scrolle den Link "alle Ereignisse" in den sichtbaren Bereich'],
      en: ['And I scroll to the link "all updates"', 'And scroll the link "all events" into view'],
    },
    run: (ctx, a) => ctx.scrollTo(target(ctx, a)),
  },
  {
    key: 'scrollPage', keyword: 'When', group: 'Navigation',
    patterns: {
      de: [
        re('(?:ich )?scrolle (?:ganz )?(?<where>nach unten|nach oben|ans Seitenende|zum Seitenende|ans Ende der Seite|zum Ende der Seite|zum Seitenanfang|an den Seitenanfang|an den Anfang der Seite|zum Anfang der Seite)'),
        re('ich (?:ganz )?(?<where>nach unten|nach oben|ans Seitenende|zum Seitenende|ans Ende der Seite|zum Ende der Seite|zum Seitenanfang|an den Seitenanfang|an den Anfang der Seite|zum Anfang der Seite) scrolle'),
      ],
      en: [re('(?:I )?scroll (?:all the way )?(?<where>down|up|to the bottom|to the top)(?: of the page)?')],
    },
    examples: { de: ['Und ich scrolle ans Seitenende', 'Und ich scrolle an den Anfang der Seite'], en: ['And I scroll to the bottom of the page'] },
    run: (ctx, a) => ctx.scrollPage(/oben|anfang|up|top/i.test(a.where ?? '') ? 'top' : 'bottom'),
  },

  {
    key: 'area', keyword: 'Given', group: 'Navigation',
    patterns: {
      de: [re(
        '(?:ich )?arbeite (?:jetzt |ab jetzt |nur |nur noch )?(?:in|im|innerhalb)(?: (?:von|des|der|dem|den|die|das))? ',
        `(?:(?<landmark>${LANDMARK})(?! ")|(?<kind>[${LETTERS}]+) "(?<name>[^"]*)")`,
      )],
      en: [re(
        '(?:I )?work (?:only )?(?:in|inside|within)(?: the)? ',
        `(?:(?<landmark>${LANDMARK})(?! ")|(?<kind>[${LETTERS}]+) "(?<name>[^"]*)")`,
      )],
    },
    examples: {
      de: ['Und ich arbeite in der Fußzeile', 'Und ich arbeite im Bereich "Hauptmenü"', 'Und ich arbeite im Dialog "Person anlegen"'],
      en: ['And I work in the footer', 'And I work in the area "main menu"'],
    },
    run: (ctx, a) => ctx.setArea({ kind: a.kind, name: a.name, landmark: a.landmark }),
  },
  {
    key: 'areaReset', keyword: 'Given', group: 'Navigation',
    patterns: {
      de: [re('(?:ich )?arbeite wieder (?:auf|mit) der (?:ganzen|gesamten) Seite')],
      en: [re('(?:I )?work on the (?:whole|full|entire) page again')],
    },
    examples: { de: ['Und ich arbeite wieder auf der ganzen Seite'], en: ['And I work on the whole page again'] },
    run: (ctx) => ctx.setArea(undefined),
  },

  // ── Eingaben ─────────────────────────────────────────────────────────────
  {
    key: 'fill', keyword: 'When', group: 'Eingaben',
    patterns: {
      de: [
        re('ich fülle ', T, ' mit ', Q('value'), ' aus'),
        re('ich ', T, ' mit ', Q('value'), ' ausfülle'),
        re('ich gebe ', Q('value'), ' in ', T, ' ein'),
        re('ich ', Q('value'), ' in ', T, ' eingebe'),
      ],
      en: [re('I fill (?:in )?', T, ' with ', Q('value')), re('I enter ', Q('value'), ' in(?:to)? ', T)],
    },
    examples: { de: ['Und ich fülle das Feld "Vorname" mit "Max" aus', 'Und ich gebe "Muster" in das Feld "Nachname" ein'], en: ['And I fill in the field "First name" with "Max"'] },
    run: (ctx, a) => target(ctx, a).fill(a.value ?? ''),
  },
  {
    key: 'select', keyword: 'When', group: 'Eingaben',
    patterns: {
      de: [re('ich wähle ', Q('value'), ' (?:in|bei) ', T, '(?: aus)?'), re('ich ', Q('value'), ' (?:in|bei) ', T, ' auswähle')],
      en: [re('I select ', Q('value'), ' (?:in|from) ', T)],
    },
    examples: { de: ['Und ich wähle "Lehrkraft" in der Auswahl "Rolle" aus'], en: ['And I select "Teacher" from the select "Role"'] },
    run: async (ctx, a) => { await target(ctx, a).selectOption({ label: a.value! }); },
  },
  {
    key: 'check', keyword: 'When', group: 'Eingaben',
    patterns: {
      de: [re('ich (?:setze den Haken bei|aktiviere) ', T), re('ich ', T, ' aktiviere')],
      en: [re('I check ', T)],
    },
    examples: { de: ['Und ich aktiviere die Checkbox "Aktiv"'], en: ['And I check the checkbox "Active"'] },
    run: (ctx, a) => target(ctx, a).check(),
  },
  {
    key: 'uncheck', keyword: 'When', group: 'Eingaben',
    patterns: {
      de: [re('ich (?:entferne den Haken bei|deaktiviere) ', T), re('ich ', T, ' deaktiviere')],
      en: [re('I uncheck ', T)],
    },
    examples: { de: ['Und ich deaktiviere die Checkbox "Aktiv"'], en: ['And I uncheck the checkbox "Active"'] },
    run: (ctx, a) => target(ctx, a).uncheck(),
  },
  {
    key: 'hover', keyword: 'When', group: 'Eingaben',
    patterns: {
      de: [re('ich fahre mit der Maus über ', T), re('ich mit der Maus über ', T, ' fahre')],
      en: [re('I hover (?:over )?', T)],
    },
    examples: { de: ['Und ich fahre mit der Maus über den Button "Löschen"'], en: ['And I hover over the button "Delete"'] },
    run: (ctx, a) => target(ctx, a).hover(),
  },
  {
    key: 'press', keyword: 'When', group: 'Eingaben',
    patterns: {
      de: [re('ich drücke (?:die Taste )?', Q('key')), re('ich (?:die Taste )?', Q('key'), ' drücke')],
      en: [re('I press (?:the key )?', Q('key'))],
    },
    examples: { de: ['Und ich drücke die Taste "Enter"'], en: ['And I press "Enter"'] },
    run: (ctx, a) => ctx.page.keyboard.press(a.key!),
  },

  // ── Warten ───────────────────────────────────────────────────────────────
  {
    key: 'waitFor', keyword: 'When', group: 'Warten',
    patterns: {
      de: [re('ich warte auf ', T), re(T, ' ist sichtbar')],
      en: [re('I wait for ', T), re(T, ' is visible')],
    },
    examples: { de: ['Und ich warte auf den Dialog "Person anlegen"'], en: ['And I wait for the dialog "Create person"'] },
    run: (ctx, a) => target(ctx, a).waitFor({ state: 'visible' }),
  },
  {
    key: 'waitTime', keyword: 'When', group: 'Warten',
    patterns: {
      de: [re('ich warte (?<amount>\\d+) ?(?<unit>ms|Millisekunden|Sekunden|Sekunde|s)')],
      en: [re('I wait (?<amount>\\d+) ?(?<unit>ms|milliseconds|seconds|second|s)')],
    },
    examples: { de: ['Und ich warte 500 Millisekunden'], en: ['And I wait 500 ms'] },
    run: (ctx, a) => {
      const n = Number(a.amount);
      const ms = /^(ms|milli)/i.test(a.unit ?? '') ? n : n * 1000;
      return ctx.page.waitForTimeout(ms);
    },
  },

  // ── Markieren ────────────────────────────────────────────────────────────
  {
    key: 'highlight', keyword: 'Then', group: 'Markieren',
    patterns: {
      de: [
        re('(?:ich )?markiere ', T, LABEL_NOTE_DE),
        re('(?:ich )?hebe ', T, LABEL_NOTE_DE, ' hervor'),
        re('ich ', T, LABEL_NOTE_DE, ' markiere'),
      ],
      en: [re('(?:I )?highlight ', T, LABEL_NOTE_EN), re('(?:I )?outline ', T, LABEL_NOTE_EN)],
    },
    examples: {
      de: [
        'Dann markiere den Button "Speichern"',
        'Dann markiere das Feld "Vorname" mit "1"',
        'Dann markiere das Feld "E-Mail" mit "2" und Hinweis "Pflichtfeld"',
        'Dann markiere den Link "Hilfe" und dem Hinweis "Öffnet die Anleitung"',
        'Dann markiere den letzten Link "Impressum" mit "2"',
        'Dann markiere das Feld "E-Mail" im Formular "Person anlegen" mit "1"',
      ],
      en: [
        'Then highlight the button "Save"',
        'Then highlight the field "First name" with "1"',
        'Then highlight the field "Email" with "2" and note "Required"',
      ],
    },
    run: async (ctx, a) => {
      ctx.docshot.highlight(target(ctx, a), { label: opt(a.label), note: opt(a.note), description: describe(a) });
    },
  },
  {
    key: 'pointAt', keyword: 'Then', group: 'Markieren',
    patterns: {
      de: [re('(?:ich )?zeige (?:mit einem Pfeil )?auf ', T, LABEL_NOTE_DE)],
      en: [re('(?:I )?point (?:with an arrow )?(?:at|to) ', T, LABEL_NOTE_EN)],
    },
    examples: {
      de: [
        'Dann zeige mit einem Pfeil auf den Button "Hilfe"',
        'Dann zeige mit einem Pfeil auf das Feld "Suche" und mit "2"',
        'Dann zeige mit einem Pfeil auf den Link "Hilfe" und mit "2" und dem Hinweis "Pflichtfeld"',
        'Dann zeige mit einem Pfeil auf den Link "Impressum" in der Fußzeile mit "7"',
      ],
      en: [
        'Then point at the button "Help"',
        'Then point at the link "Help" and with "2" and the note "Required"',
      ],
    },
    run: async (ctx, a) => {
      ctx.docshot.pointAt(target(ctx, a), { label: opt(a.label), note: opt(a.note), description: describe(a) });
    },
  },
  {
    key: 'mask', keyword: 'Then', group: 'Markieren',
    patterns: {
      de: [re('(?:ich )?(?:verdecke|verpixele|schwärze) ', T)],
      en: [re('(?:I )?(?:mask|blur) ', T)],
    },
    examples: { de: ['Und verdecke das Feld "E-Mail"'], en: ['And mask the field "Email"'] },
    run: async (ctx, a) => { ctx.docshot.mask(target(ctx, a)); },
  },

  {
    key: 'hideMarksAll', keyword: 'Then', group: 'Markieren',
    patterns: {
      de: [re('(?:ich )?(?:blende|entferne) (?:alle |die )?(?:Markierungen|Markierung) aus'), re('(?:ich )?entferne (?:alle |die )?Markierungen')],
      en: [re('(?:I )?(?:hide|remove|clear) (?:all |the )?(?:markers|marks|highlights)')],
    },
    examples: { de: ['Und blende die Markierungen aus', 'Und entferne alle Markierungen'], en: ['And hide the markers'] },
    run: async (ctx) => { await ctx.docshot.hideMarks(); },
  },
  {
    key: 'hideMarkLabel', keyword: 'Then', group: 'Markieren',
    patterns: {
      de: [
        re('(?:ich )?blende (?:die )?Markierung (?:mit der Nummer )?', Q('label'), ' aus'),
        re('(?:ich )?entferne (?:die )?Markierung (?:mit der Nummer )?', Q('label')),
      ],
      en: [re('(?:I )?(?:hide|remove) (?:the )?marker (?:with (?:label |number )?)?', Q('label'))],
    },
    examples: { de: ['Und blende die Markierung "1" aus', 'Und entferne die Markierung "2"'], en: ['And hide the marker "1"'] },
    run: async (ctx, a) => { await ctx.docshot.hideMarks({ label: a.label }); },
  },
  {
    key: 'hideMarkTarget', keyword: 'Then', group: 'Markieren',
    patterns: {
      de: [
        re('(?:ich )?blende (?:die )?Markierung (?:von|vom|auf) ', T, ' aus'),
        re('(?:ich )?entferne (?:die )?Markierung (?:von|vom|auf) ', T),
      ],
      en: [re('(?:I )?(?:hide|remove) (?:the )?marker (?:of|on|from) ', T)],
    },
    examples: { de: ['Und entferne die Markierung vom Feld "Vorname"'], en: ['And remove the marker of the field "First name"'] },
    run: async (ctx, a) => { await ctx.docshot.hideMarks({ description: describe(a) }); },
  },

  // ── Screenshot ───────────────────────────────────────────────────────────
  {
    key: 'screenshotPage', keyword: 'Then', group: 'Screenshot',
    patterns: {
      de: [re('(?:ich )?erstelle (?:einen |ein )?Screenshot(?: ', Q('shot'), ')? der (?:ganzen|gesamten) Seite')],
      en: [re('(?:I )?take (?:a )?screenshot(?: ', Q('shot'), ')? of the (?:whole|full|entire) page')],
    },
    examples: { de: ['Und erstelle einen Screenshot der ganzen Seite'], en: ['And take a screenshot of the whole page'] },
    run: async (ctx, a) => { await ctx.docshot.capture({ fullPage: true, name: opt(a.shot) }); },
  },
  {
    key: 'screenshot', keyword: 'Then', group: 'Screenshot',
    patterns: {
      de: [re('(?:ich )?erstelle (?:einen |ein )?Screenshot(?: ', Q('shot'), ')?(?: (?:von|vom) ', T, ')?')],
      en: [re('(?:I )?take (?:a )?screenshot(?: ', Q('shot'), ')?(?: of ', T, ')?')],
    },
    examples: {
      de: [
        'Dann erstelle einen Screenshot',
        'Dann erstelle einen Screenshot vom Formular "Person anlegen"',
        'Dann erstelle einen Screenshot vom Bereich "Hauptmenü"',
        'Dann erstelle einen Screenshot vom Bereich "footer .feeds"',
        'Dann erstelle einen Screenshot "schritt-2" von dem Dialog "Mitgliedschaft hinzufügen"',
      ],
      en: ['Then take a screenshot', 'Then take a screenshot of the form "Create person"'],
    },
    run: async (ctx, a) => {
      await ctx.docshot.capture({ name: opt(a.shot), target: a.kind ? target(ctx, a) : undefined });
    },
  },

  // ── Video ────────────────────────────────────────────────────────────────
  {
    key: 'videoStart', keyword: 'When', group: 'Video',
    patterns: {
      de: [
        re('(?:ich )?starte (?:ein |das |die )?(?:Video|Aufnahme|Videoaufnahme)(?: ', Q('shot'), ')?(?: (?:von|vom) ', T, ')?'),
        re('ich (?:ein |das |die )?(?:Video|Aufnahme|Videoaufnahme)(?: ', Q('shot'), ')?(?: (?:von|vom) ', T, ')? starte'),
      ],
      en: [re('(?:I )?start (?:a |the )?(?:video|recording)(?: ', Q('shot'), ')?(?: of ', T, ')?')],
    },
    examples: {
      de: ['Dann starte ein Video', 'Dann starte ein Video vom Formular "Person anlegen"', 'Wenn ich ein Video "ausfuellen" vom Dialog "Person anlegen" starte'],
      en: ['When I start a video', 'When I start a video of the form "Create person"'],
    },
    run: async (ctx, a) => {
      await ctx.docshot.startVideo({ name: opt(a.shot), target: a.kind ? target(ctx, a) : undefined });
    },
  },
  {
    key: 'videoStop', keyword: 'Then', group: 'Video',
    patterns: {
      de: [re('(?:ich )?(?:beende|stoppe) (?:das |die )?(?:Video|Aufnahme|Videoaufnahme)'), re('ich (?:das |die )?(?:Video|Aufnahme|Videoaufnahme) (?:beende|stoppe)')],
      en: [re('(?:I )?(?:stop|end|finish) (?:the )?(?:video|recording)')],
    },
    examples: { de: ['Dann beende das Video', 'Wenn ich das Video beende'], en: ['Then stop the video'] },
    run: async (ctx) => { await ctx.docshot.stopVideo(); },
  },
  {
    key: 'videoTitle', keyword: 'When', group: 'Video',
    patterns: {
      de: [re('(?:ich )?(?:zeige|blende) (?:den |einen )?Titel ', Q('title'), '(?: mit (?:der )?Beschreibung ', Q('desc'), ')?(?: ein)?')],
      en: [re('(?:I )?show (?:the |a )?title ', Q('title'), '(?: with (?:the )?description ', Q('desc'), ')?')],
    },
    examples: { de: ['Und zeige den Titel "Person anlegen" mit der Beschreibung "In drei Schritten"'], en: ['And show the title "Create a person"'] },
    run: async (ctx, a) => { await ctx.docshot.showTitle(a.title!, opt(a.desc)); },
  },
];

/** Named groups in the order they appear (= order of positional step arguments). */
export function groupNames(pattern: RegExp): string[] {
  return [...pattern.source.matchAll(/\(\?<([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => m[1]);
}
