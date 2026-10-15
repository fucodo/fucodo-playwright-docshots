import type { Locator, Page } from '@playwright/test';

/** Named areas provided by devs, e.g. 'Formular "Benutzer anlegen"' or just 'Seitenleiste'. */
export type AreaRegistry = Record<string, (page: Page) => Locator>;

/** Where to search: the whole page or inside another element (scope). */
type Root = Page | Locator;
type Resolver = (root: Root, name: string) => Locator;

// Page and Locator share getByRole/getByLabel/getByText/locator – one cast keeps the overloads simple
const asPage = (root: Root) => root as Page;
const role = (r: Parameters<Page['getByRole']>[0]): Resolver => (root, name) => asPage(root).getByRole(r, { name, exact: true });

/**
 * Kind words support staff can use, in German and English.
 * Lookup is case-insensitive. Anything not listed here is looked up in the area registry.
 */
export const TARGET_KINDS: Record<string, Resolver> = {
  button: role('button'), schaltfläche: role('button'), knopf: role('button'),
  link: role('link'),
  tab: role('tab'), reiter: role('tab'),
  menüpunkt: role('menuitem'), menuitem: role('menuitem'), menü: role('menuitem'),
  checkbox: role('checkbox'), kontrollkästchen: role('checkbox'),
  radio: role('radio'), option: role('radio'),
  auswahl: role('combobox'), auswahlfeld: role('combobox'), dropdown: role('combobox'), select: role('combobox'),
  überschrift: role('heading'), heading: role('heading'),
  dialog: role('dialog'),
  liste: role('list'), list: role('list'),
  tabelle: role('table'), table: role('table'),
  zeile: (root, name) => asPage(root).getByRole('row').filter({ hasText: name }),
  row: (root, name) => asPage(root).getByRole('row').filter({ hasText: name }),
  feld: (root, name) => asPage(root).getByLabel(name, { exact: true }),
  eingabefeld: (root, name) => asPage(root).getByLabel(name, { exact: true }),
  field: (root, name) => asPage(root).getByLabel(name, { exact: true }),
  text: (root, name) => asPage(root).getByText(name, { exact: true }),
  // escape hatch for devs – support staff should ask for a named area instead
  selektor: (root, css) => asPage(root).locator(css),
  selector: (root, css) => asPage(root).locator(css),
};

/**
 * Page regions without a name: "in der Fußzeile", "im Kopfbereich", "in the footer".
 * ARIA landmark first, the HTML element as fallback (e.g. a <footer> inside <main> has no landmark role).
 */
const LANDMARKS: Record<string, (page: Page) => Locator> = {
  fußzeile: (p) => p.getByRole('contentinfo').or(p.locator('footer')).last(),
  footer: (p) => p.getByRole('contentinfo').or(p.locator('footer')).last(),
  kopfzeile: (p) => p.getByRole('banner').or(p.locator('header')).first(),
  kopfbereich: (p) => p.getByRole('banner').or(p.locator('header')).first(),
  header: (p) => p.getByRole('banner').or(p.locator('header')).first(),
  navigation: (p) => p.getByRole('navigation').first(),
  seitenleiste: (p) => p.getByRole('complementary').or(p.locator('aside')).first(),
  sidebar: (p) => p.getByRole('complementary').or(p.locator('aside')).first(),
  hauptbereich: (p) => p.getByRole('main').or(p.locator('main')).first(),
  inhaltsbereich: (p) => p.getByRole('main').or(p.locator('main')).first(),
  'main content': (p) => p.getByRole('main').or(p.locator('main')).first(),
  'main area': (p) => p.getByRole('main').or(p.locator('main')).first(),
  dialog: (p) => p.getByRole('dialog').last(),
};

export const LANDMARK_WORDS_DE = ['Fußzeile', 'Kopfzeile', 'Kopfbereich', 'Navigation', 'Seitenleiste', 'Hauptbereich', 'Inhaltsbereich', 'Dialog'];
export const LANDMARK_WORDS_EN = ['footer', 'header', 'navigation', 'sidebar', 'main content', 'main area', 'dialog'];

const ORDINALS: Record<string, number> = {
  ersten: 0, erste: 0, zweiten: 1, zweite: 1, dritten: 2, dritte: 2, vierten: 3, vierte: 3, fünften: 4, fünfte: 4,
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4,
  letzten: -1, letzte: -1, last: -1,
};
export const ORDINAL_WORDS = Object.keys(ORDINALS);

export class UnknownTargetError extends Error {}

/** Kind words for "a named area or a CSS selector". */
export const AREA_KINDS = ['bereich', 'area', 'region'];

/** Message for a CSS selector Playwright cannot parse (Bereich "…" / Selektor "…"). */
export function invalidSelectorMessage(name: string, areas: AreaRegistry): string {
  const known = Object.keys(areas);
  return (
    `"${name}" ist weder ein benannter Bereich noch ein gültiger CSS-Selektor.` +
    (known.length ? ` Benannte Bereiche: ${known.join(', ')}.` : ' Es sind keine Bereiche benannt (steps/index.ts → areas).') +
    ` Seitenbereiche: ${LANDMARK_WORDS_DE.join(', ')}.`
  );
}

export interface TargetRefinement {
  /** "ersten", "zweiten", "letzten", "second", … */
  nth?: string;
  /** search inside another target: <scopeKind> "<scopeName>" */
  scopeKind?: string;
  scopeName?: string;
  /** search inside a page region: Fußzeile, Kopfbereich, footer, … */
  landmark?: string;
  /** active area from "ich arbeite in …" – used when the step has no scope of its own */
  within?: Locator;
}

/**
 * Resolves `<kind> "<name>"`:
 *   1. area registry with the full phrase:  'Formular "Benutzer anlegen"'
 *   2. built-in kind words:                 Button, Feld, Link, …
 *   3. area registry with the kind as name: 'Bereich "Seitenleiste"' → areas['Seitenleiste']
 *
 * Optionally inside a scope ("im Dialog "X"", "in der Fußzeile") and/or the n-th match ("den zweiten Link …").
 */
export function resolveTarget(page: Page, kind: string, name: string, areas: AreaRegistry = {}, refine: TargetRefinement = {}): Locator {
  let root: Root = page;
  if (refine.landmark) {
    const lm = LANDMARKS[refine.landmark.toLowerCase()];
    if (!lm) throw new UnknownTargetError(`Unbekannter Seitenbereich "${refine.landmark}". Möglich: ${LANDMARK_WORDS_DE.join(', ')}`);
    root = lm(page);
  } else if (refine.scopeKind && refine.scopeName !== undefined) {
    root = resolveIn(page, page, refine.scopeKind, refine.scopeName, areas);
  } else if (refine.within) {
    root = refine.within;
  }
  let loc = resolveIn(page, root, kind, name, areas);
  if (refine.nth) {
    const n = ORDINALS[refine.nth.toLowerCase()];
    if (n === undefined) throw new UnknownTargetError(`Unbekannte Zählung "${refine.nth}" – möglich: ersten, zweiten, dritten, letzten`);
    loc = n < 0 ? loc.last() : loc.nth(n);
  }
  return loc;
}

function resolveIn(page: Page, root: Root, kind: string, name: string, areas: AreaRegistry): Locator {
  const inScope = (area: (page: Page) => Locator) => (root === page ? area(page) : (root as Locator).locator(area(page)));
  const phrase = `${kind} "${name}"`;
  const byPhrase = findCaseInsensitive(areas, phrase);
  if (byPhrase) return inScope(byPhrase);

  const builtin = TARGET_KINDS[kind.toLowerCase()];
  if (builtin) return builtin(root, name);

  const lowerKind = kind.toLowerCase();
  if (AREA_KINDS.includes(lowerKind)) {
    // Bereich "X": 1. named area from steps/index.ts, 2. page region (Fußzeile, …), 3. CSS selector
    const byName = findCaseInsensitive(areas, name);
    if (byName) return inScope(byName);
    const landmark = LANDMARKS[name.toLowerCase()];
    if (landmark) return root === page ? landmark(page) : (root as Locator).locator(landmark(page));
    return asPage(root).locator(name);
  }

  const known = [...Object.keys(TARGET_KINDS), ...Object.keys(areas)];
  throw new UnknownTargetError(
    `Unbekanntes Ziel ${phrase}. Möglich sind z. B. Button "…", Feld "…", Link "…" oder ein Bereich: ${known.filter((k) => /\s|"/.test(k) || !TARGET_KINDS[k]).join(', ') || '(keine Bereiche definiert)'}`,
  );
}

function findCaseInsensitive<T>(record: Record<string, T>, key: string): T | undefined {
  if (key in record) return record[key];
  const lower = key.toLowerCase();
  const hit = Object.keys(record).find((k) => k.toLowerCase() === lower);
  return hit ? record[hit] : undefined;
}

/** Human-readable target incl. refinement, for messages: 'zweiten Link "Impressum" in der Fußzeile' */
export function describeTarget(kind: string, name: string, refine: TargetRefinement = {}): string {
  const base = `${refine.nth ? `${refine.nth} ` : ''}${kind} "${name}"`;
  if (refine.landmark) return `${base} in ${refine.landmark}`;
  if (refine.scopeKind) return `${base} in ${refine.scopeKind} "${refine.scopeName}"`;
  return base;
}

/** Hint appended to "not unique" errors. */
export const AMBIGUOUS_HINT =
  'Eingrenzen z. B. mit „… in der Fußzeile“, „… im Dialog "Name"“, „… im Bereich "Name"“, „den zweiten/letzten …“ – oder vorher „Und ich arbeite in der Fußzeile“.';
