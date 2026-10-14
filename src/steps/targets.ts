import type { Locator, Page } from '@playwright/test';

/** Named areas provided by devs, e.g. 'Formular "Benutzer anlegen"' or just 'Seitenleiste'. */
export type AreaRegistry = Record<string, (page: Page) => Locator>;

type Resolver = (page: Page, name: string) => Locator;

const role = (r: Parameters<Page['getByRole']>[0]): Resolver => (page, name) => page.getByRole(r, { name, exact: true });

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
  zeile: (page, name) => page.getByRole('row').filter({ hasText: name }),
  row: (page, name) => page.getByRole('row').filter({ hasText: name }),
  feld: (page, name) => page.getByLabel(name, { exact: true }),
  eingabefeld: (page, name) => page.getByLabel(name, { exact: true }),
  field: (page, name) => page.getByLabel(name, { exact: true }),
  text: (page, name) => page.getByText(name, { exact: true }),
  // escape hatch for devs – support staff should ask for a named area instead
  selektor: (page, css) => page.locator(css),
  selector: (page, css) => page.locator(css),
};

export class UnknownTargetError extends Error {}

/**
 * Resolves `<kind> "<name>"`:
 *   1. area registry with the full phrase:  'Formular "Benutzer anlegen"'
 *   2. built-in kind words:                 Button, Feld, Link, …
 *   3. area registry with the kind as name: 'Bereich "Seitenleiste"' → areas['Seitenleiste']
 */
export function resolveTarget(page: Page, kind: string, name: string, areas: AreaRegistry = {}): Locator {
  const phrase = `${kind} "${name}"`;
  const byPhrase = findCaseInsensitive(areas, phrase);
  if (byPhrase) return byPhrase(page);

  const builtin = TARGET_KINDS[kind.toLowerCase()];
  if (builtin) return builtin(page, name);

  const lowerKind = kind.toLowerCase();
  if (['bereich', 'area', 'region'].includes(lowerKind)) {
    const byName = findCaseInsensitive(areas, name);
    if (byName) return byName(page);
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

export const describeTarget = (kind: string, name: string) => `${kind} "${name}"`;
