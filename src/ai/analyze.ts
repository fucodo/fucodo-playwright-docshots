import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Docshot } from '../fixture';
import { KEYWORDS, type DocshotLanguage } from '../sources/rst';
import { TARGET_KINDS } from '../steps/targets';
import { groupNames, VOCABULARY, type VocabArgs, type VocabContext, type VocabEntry } from '../steps/vocabulary';
import { aiConfig, chat, imageDataUrl, parseJsonReply, type AiConfig, type ChatMessage } from './client';

/** Written by the CLI, read by the analyze step inside the Playwright worker. */
export interface AnalyzeJob {
  id: string;
  image: string;          // absolute path of the old screenshot
  url: string;            // page to start from (relative to baseURL or absolute)
  persona?: string;
  lang: DocshotLanguage;
  attempts: number;
  workDir: string;        // absolute, results go here
  /** Project steps as cucumber expressions (from `bddgen export`) */
  projectSteps?: string[];
}

export interface AnalyzeResult {
  ok: boolean;
  id: string;
  lang: DocshotLanguage;
  /** Complete step list incl. login + open, ready for an RST block */
  steps: string[];
  /** Steps proposed by the model (without login/open) */
  proposed: string[];
  notes: string[];
  attempts: { steps: string[]; errors: string[] }[];
  preview?: string;
  plannedFile: string;
  model: string;
  error?: string;
}

interface ModelAnswer {
  steps: string[];
  notes?: string[];
}

export interface AnalyzeDeps {
  page: Page;
  docshot: Docshot;
  context: VocabContext;
  areaNames: string[];
  /** Names of project steps (cucumber expressions as text) – offered to the model as well */
  projectSteps?: string[];
  ai?: AiConfig;
}

// ── step matching ──────────────────────────────────────────────────────────

export function stripKeyword(step: string, lang: DocshotLanguage): string {
  const kws = [...KEYWORDS[lang].steps].sort((a, b) => b.length - a.length);
  const t = step.trim();
  for (const k of kws) {
    if (t === k) return '';
    if (t.startsWith(k + ' ')) return t.slice(k.length + 1).trim();
  }
  return t;
}

export function matchStep(step: string, lang: DocshotLanguage): { entry: VocabEntry; args: VocabArgs } | undefined {
  const text = stripKeyword(step, lang);
  for (const entry of VOCABULARY) {
    for (const pattern of entry.patterns[lang]) {
      const m = pattern.exec(text);
      if (!m) continue;
      const args: VocabArgs = {};
      for (const n of groupNames(pattern)) args[n] = m.groups?.[n] || undefined;
      return { entry, args };
    }
  }
  return undefined;
}

/** Makes sure every step starts with a keyword; the model sometimes forgets them. */
export function withKeywords(steps: string[], lang: DocshotLanguage): string[] {
  const and = lang === 'de' ? 'Und' : 'And';
  const then = lang === 'de' ? 'Dann' : 'Then';
  return steps
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i, all) => {
      if (stripKeyword(s, lang) !== s) return s;
      const isLastScreenshot = i === all.length - 1 && /screenshot/i.test(s);
      return `${isLastScreenshot ? then : and} ${s}`;
    });
}

// ── prompt ─────────────────────────────────────────────────────────────────

function vocabularyHelp(lang: DocshotLanguage, areaNames: string[], projectSteps: string[]): string {
  const lines: string[] = [];
  for (const entry of VOCABULARY) {
    if (entry.key === 'login' || entry.key === 'open') continue; // done before the model's steps
    for (const ex of entry.examples[lang]) lines.push(`- ${ex}`);
  }
  const kinds = [...new Set(Object.keys(TARGET_KINDS).filter((k) => !['selektor', 'selector'].includes(k)))];
  return [
    'Allowed step sentences (examples – keep the exact sentence structure, change only the quoted values):',
    ...lines,
    projectSteps.length ? '\nProject specific steps (use them verbatim where they fit, {string} = quoted value):' : '',
    ...projectSteps.map((s) => `- ${s}`),
    '',
    `Targets are written as <Kind> "<accessible name>" with an optional article. Kinds: ${kinds.join(', ')}.`,
    'For a kind, the name must be the exact accessible name from the ARIA snapshot (button/link text, field label, heading text).',
    areaNames.length
      ? `Named areas (use them exactly like this, e.g. "vom Formular \\"X\\"" / "of the form \\"X\\""): ${areaNames.map((a) => (a.includes('"') ? a : `Bereich "${a}"`)).join(', ')}`
      : 'There are no named areas – crop with Dialog "…" or leave the screenshot uncropped.',
  ].join('\n');
}

function systemPrompt(lang: DocshotLanguage): string {
  const language = lang === 'de' ? 'German' : 'English';
  return [
    'You turn an existing documentation screenshot into executable steps for a screenshot tool.',
    `Write the steps in ${language} Gherkin (keywords ${KEYWORDS[lang].steps.filter((k) => k !== '*').join(', ')}).`,
    'Reply with a single JSON object: {"steps": ["…"], "notes": ["…"]} and nothing else.',
  ].join(' ');
}

function taskPrompt(job: AnalyzeJob, help: string, aria: string, currentUrl: string): string {
  return [
    `The user is already logged in${job.persona ? ` as "${job.persona}"` : ''} and the page ${currentUrl} is open.`,
    'Image 1 is the OLD documentation screenshot. Image 2 is the CURRENT state of the open page. The ARIA snapshot below describes the CURRENT page.',
    '',
    'Write the steps that, starting from the current page, recreate what the old screenshot documents:',
    '1. Interactions needed to reach the documented state (open dialogs, switch tabs, fill example values that are visible in the old image – use fictional data).',
    '2. Annotations that are visible in the old image: outlined/framed elements → "markiere … mit \\"<badge number>\\"" (or highlight … with "<n>"), callout texts → "und Hinweis \\"…\\"" / "and note \\"…\\"", arrows → "zeige mit einem Pfeil auf …" / "point at …", blacked-out areas → "verdecke …" / "mask …". Keep the badge numbers of the old image.',
    '3. Exactly one screenshot step at the end: if the old image is cropped to a region (dialog, form, menu, table), screenshot that region; otherwise a plain screenshot.',
    '',
    'Rules:',
    '- Do NOT include login or opening the start page.',
    '- Use labels as they appear in the CURRENT page, even if the old image shows different wording – mention every such difference in "notes".',
    '- Only use the allowed sentences. If something cannot be expressed, leave it out and explain it in "notes".',
    '',
    help,
    '',
    'ARIA snapshot of the current page:',
    aria,
  ].join('\n');
}

// ── page helpers ───────────────────────────────────────────────────────────

async function ariaOf(page: Page): Promise<string> {
  const snap = await page.locator('body').ariaSnapshot().catch(() => '(ARIA snapshot not available)');
  return snap.length > 20_000 ? snap.slice(0, 20_000) + '\n… (truncated)' : snap;
}

/** Scales a data URL down to maxSide in a blank page (no CSP of the app involved). */
async function scaled(page: Page, dataUrl: string, maxSide: number): Promise<string> {
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(
      async ({ src, max }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        if (f >= 1) return src;
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * f);
        c.height = Math.round(img.naturalHeight * f);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      },
      { src: dataUrl, max: maxSide },
    );
  } finally {
    await blank.close();
  }
}

async function currentScreenshot(page: Page): Promise<string> {
  const buf = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ── dry run ────────────────────────────────────────────────────────────────

async function dryRun(
  steps: string[],
  deps: AnalyzeDeps,
  job: AnalyzeJob,
  preview: Docshot,
  projectStepMatchers: RegExp[],
): Promise<string[]> {
  const errors: string[] = [];
  steps.forEach((s, i) => {
    if (!matchStep(s, job.lang) && !projectStepMatchers.some((re) => re.test(stripKeyword(s, job.lang)))) {
      errors.push(`Step ${i + 1} matches no allowed sentence: "${s}"`);
    }
  });
  if (errors.length) return errors;

  const screenshots = steps.filter((s) => matchStep(s, job.lang)?.entry.group === 'Screenshot');
  if (screenshots.length !== 1 || matchStep(steps[steps.length - 1], job.lang)?.entry.group !== 'Screenshot') {
    return ['There must be exactly one screenshot step, and it must be the last step.'];
  }

  // execute built-in steps against the live page; project steps cannot run here and are skipped
  const ctx: VocabContext = { ...deps.context, docshot: preview };
  for (let i = 0; i < steps.length; i++) {
    const m = matchStep(steps[i], job.lang);
    if (!m) continue;
    try {
      if (m.args.kind && m.args.name !== undefined) {
        const target = ctx.target(m.args.kind, m.args.name);
        const found = await target.first().waitFor({ state: 'attached', timeout: 3_000 }).then(() => true, () => false);
        if (!found) throw new Error(`no element found for ${m.args.kind} "${m.args.name}" – use a name from the ARIA snapshot`);
        const count = await target.count();
        if (count > 1) throw new Error(`${m.args.kind} "${m.args.name}" is ambiguous (${count} matches) – use a more specific target or a named area`);
      }
      await withTimeout(m.entry.run(ctx, m.args), 10_000, `Step ${i + 1} timed out`);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0];
      errors.push(`Step ${i + 1} failed: "${steps[i]}" → ${msg}`);
      break; // later steps depend on this one
    }
  }
  return errors;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

function cucumberToRegex(expr: string): RegExp {
  const escaped = expr.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{string\\\}|\{string\}/g, '"[^"]*"').replace(/\{(int|float|word)\}/g, '\\S+');
  return new RegExp(`^${escaped}$`);
}

// ── main ───────────────────────────────────────────────────────────────────

export function loginAndOpenSteps(job: AnalyzeJob): string[] {
  if (job.lang === 'de') {
    return job.persona
      ? [`Angenommen ich bin angemeldet als "${job.persona}"`, `Und ich öffne die Seite "${job.url}"`]
      : [`Angenommen ich öffne die Seite "${job.url}"`];
  }
  return job.persona
    ? [`Given I am logged in as "${job.persona}"`, `And I open the page "${job.url}"`]
    : [`Given I open the page "${job.url}"`];
}

export async function analyze(job: AnalyzeJob, deps: AnalyzeDeps): Promise<AnalyzeResult> {
  const ai = deps.ai ?? aiConfig();
  const { page, docshot } = deps;
  const projectSteps = deps.projectSteps ?? [];
  const projectStepMatchers = projectSteps.map(cucumberToRegex);
  const outDir = path.join(job.workDir, job.id);
  fs.mkdirSync(outDir, { recursive: true });

  const result: AnalyzeResult = {
    ok: false, id: job.id, lang: job.lang, steps: [], proposed: [], notes: [], attempts: [],
    plannedFile: docshot.plannedFile(job.id), model: ai.model,
  };

  const start = async () => {
    if (job.persona) await deps.context.login(job.persona);
    await page.goto(job.url);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  };

  try {
    await start();
    const oldImage = await scaled(page, imageDataUrl(job.image), ai.maxImageSide);
    const help = vocabularyHelp(job.lang, deps.areaNames, projectSteps);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(job.lang) },
      {
        role: 'user',
        content: [
          { type: 'text', text: taskPrompt(job, help, await ariaOf(page), page.url()) },
          { type: 'image_url', image_url: { url: oldImage, detail: 'high' } },
          { type: 'image_url', image_url: { url: await currentScreenshot(page), detail: 'high' } },
        ],
      },
    ];

    for (let attempt = 1; attempt <= job.attempts; attempt++) {
      const reply = await chat(ai, messages);
      messages.push({ role: 'assistant', content: reply });
      const answer = parseJsonReply<ModelAnswer>(reply);
      const steps = withKeywords(Array.isArray(answer.steps) ? answer.steps.map(String) : [], job.lang);
      result.proposed = steps;
      result.notes = Array.isArray(answer.notes) ? answer.notes.map(String) : [];

      // fresh start for every dry run
      if (attempt > 1) await start();
      const preview = docshot.withOutput(path.join(outDir, `preview-${attempt}.png`), path.join(outDir, 'manifest'));
      const errors = await dryRun(steps, deps, job, preview, projectStepMatchers);
      result.attempts.push({ steps, errors });

      if (!errors.length) {
        result.ok = true;
        result.preview = path.join(outDir, `preview-${attempt}.png`);
        break;
      }
      if (attempt < job.attempts) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Your steps were executed against the page and did not work:',
                ...errors.map((e) => `- ${e}`),
                '',
                'Fix the steps and reply with the complete JSON again. ARIA snapshot at the moment of the failure:',
                await ariaOf(page),
              ].join('\n'),
            },
            { type: 'image_url', image_url: { url: await currentScreenshot(page), detail: 'high' } },
          ],
        });
      }
    }
    result.steps = [...loginAndOpenSteps(job), ...result.proposed];
    if (!result.ok) result.error = 'Die vorgeschlagenen Schritte ließen sich nicht ausführen (siehe attempts).';
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}
