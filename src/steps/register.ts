import fs from 'node:fs';
import type { Page, TestInfo, TestType } from '@playwright/test';
import type * as PlaywrightBdd from 'playwright-bdd';
import { peer } from '../peer';
import type { Docshot } from '../fixture';
import { createCredentialsResolver, type Credentials, type CredentialsResolver, type PersonaRegistry } from '../credentials';
import type { DocshotLanguage } from '../sources/rst';
import { AMBIGUOUS_HINT, describeTarget, invalidSelectorMessage, resolveTarget, type AreaRegistry, type LabelAffixes } from './targets';
import { groupNames, VOCABULARY, type VocabContext } from './vocabulary';
import { analyze, type AnalyzeJob } from '../ai/analyze';

export interface LoginContext {
  page: Page;
  credentials: Credentials;
}

export interface DocshotAdapters {
  /** How to log in – usually 2–3 lines calling your existing LoginPage page object. */
  login?: (ctx: LoginContext) => Promise<void>;
  /** Persona registry for the default credentials resolver. */
  personas?: PersonaRegistry;
  /** Replaces the default resolver entirely (vault, CLI, …). */
  credentials?: CredentialsResolver;
  /** Named areas, e.g. { 'Formular "Person anlegen"': page => page.locator('form#person') } */
  areas?: AreaRegistry;
  /**
   * Optional text around labels that steps may leave out, e.g. { prefixes: ['[✓] '], suffixes: [' *'] }:
   * `den Button "Speichern"` then also finds "[✓] Speichern" and "Speichern *".
   */
  labels?: LabelAffixes;
  /** Which vocabularies to register. Default: both. */
  languages?: DocshotLanguage[];
  /** Skip built-in steps by key (see VOCABULARY), e.g. to replace 'login' with your own. */
  exclude?: string[];
}

type FixturesWithDocshot = { page: Page; docshot: Docshot };

const STEP_KIND: Record<string, 'action' | 'mark' | 'wait' | 'other'> = {
  Anmeldung: 'action', Navigation: 'action', Eingaben: 'action', Markieren: 'mark', Warten: 'wait',
};

/**
 * Registers the built-in vocabulary against *your* test object, so built-in
 * and project steps share the same fixtures.
 *
 * Returns { Given, When, Then } for your own domain steps.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDocshotSteps<T extends TestType<any, any>>(test: T, adapters: DocshotAdapters = {}) {
  const { createBdd } = peer<typeof PlaywrightBdd>('playwright-bdd');
  const bdd = createBdd(test);
  const resolveCredentials = adapters.credentials ?? createCredentialsResolver(adapters.personas);
  const languages = adapters.languages ?? ['de', 'en'];
  const exclude = new Set(adapters.exclude ?? []);

  const contextFor = ({ page, docshot }: FixturesWithDocshot): VocabContext => ({
    page,
    docshot,
    // an own scope ("… in der Fußzeile") wins, otherwise the active area ("ich arbeite in …") applies
    target: (kind, name, refine) =>
      resolveTarget(page, kind, name, adapters.areas, {
        ...refine,
        within: refine?.scopeKind || refine?.landmark ? undefined : docshot.activeArea,
      }, adapters.labels),
    setArea: async (spec) => {
      if (!spec) return docshot.clearArea();
      const locator = spec.landmark
        ? resolveTarget(page, 'Bereich', spec.landmark, adapters.areas, {}, adapters.labels)
        : resolveTarget(page, spec.kind!, spec.name ?? '', adapters.areas, {}, adapters.labels);
      await docshot.setArea(locator, spec.landmark ?? describeTarget(spec.kind!, spec.name ?? ''));
    },
    scrollTo: (target) => docshot.scrollIntoView(target),
    scrollPage: (where) => docshot.scrollPage(where),
    login: async (persona, password) => {
      if (!adapters.login) {
        throw new Error('Kein Login-Adapter konfiguriert: registerDocshotSteps(test, { login: async ({ page, credentials }) => … })');
      }
      const credentials = await resolveCredentials(persona, password);
      await adapters.login({ page, credentials });
    },
  });

  for (const entry of VOCABULARY) {
    if (exclude.has(entry.key)) continue;
    const define = bdd[entry.keyword] as unknown as (pattern: RegExp, fn: (...a: never[]) => Promise<void>) => void;
    for (const lang of languages) {
      for (const pattern of entry.patterns[lang]) {
        const names = groupNames(pattern);
        // NOTE: the first parameter must stay a literal destructuring –
        // playwright-bdd reads it to know which fixtures the step needs.
        const fn = async ({ page, docshot }: FixturesWithDocshot, ...values: (string | null | undefined)[]) => {
          const args: Record<string, string | undefined> = {};
          names.forEach((n, i) => (args[n] = values[i] ?? undefined));
          try {
            await entry.run(contextFor({ page, docshot }), args);
          } catch (e) {
            // Playwright's strict mode: several elements match → explain how to narrow it down
            // Bereich "…" that is neither a named area nor valid CSS
            if (e instanceof Error && args.kind && /(Unexpected token|is not a valid selector|Unknown engine|SyntaxError: Failed to execute)/i.test(e.message)) {
              const isArea = ['bereich', 'area', 'region', 'selektor', 'selector'];
              const which = isArea.includes(args.kind.toLowerCase()) ? args.name : isArea.includes((args.scopeKind ?? '').toLowerCase()) ? args.scopeName : undefined;
              if (which !== undefined) throw new Error(`${invalidSelectorMessage(which, adapters.areas ?? {})}\n\n${e.message}`);
            }
            const m = e instanceof Error && /strict mode violation: .* resolved to (\d+) elements/.exec(e.message);
            if (m) {
              const what = args.kind ? describeTarget(args.kind, args.name ?? '', args) : 'das Ziel';
              throw new Error(`${what} ist nicht eindeutig (${m[1]} Treffer). ${AMBIGUOUS_HINT}\n\n${(e as Error).message}`);
            }
            throw e;
          }
          // while a video records: keep live markers on their elements and give viewers time
          await docshot.afterStep(STEP_KIND[entry.group] ?? 'other');
        };
        // keep playwright-bdd's arity check happy for the rest parameter: fixtures + one per group
        Object.defineProperty(fn, 'length', { value: names.length + 1 });
        define(pattern, fn);
      }
    }
  }

  // Hidden step used by `docshots from-image` – never written by humans, not in the cheat sheet.
  const analyzeStep = async (
    { page, docshot, $testInfo }: FixturesWithDocshot & { $testInfo: TestInfo },
    jobFile: string,
  ) => {
    const job: AnalyzeJob & { projectSteps?: string[] } = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    $testInfo.setTimeout(Math.max($testInfo.timeout, 10 * 60_000)); // model calls are slow
    const context = contextFor({ page, docshot });
    const result = await analyze(job, {
      page,
      docshot,
      context,
      areaNames: Object.keys(adapters.areas ?? {}),
      projectSteps: job.projectSteps,
    });
    if (result.error && !result.attempts.length) throw new Error(result.error);
  };
  (bdd.Given as unknown as (p: RegExp, fn: typeof analyzeStep) => void)(/^docshots-analyze "([^"]+)"$/, analyzeStep);

  return bdd;
}
