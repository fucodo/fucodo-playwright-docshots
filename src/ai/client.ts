import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal client for any OpenAI-compatible chat completions API
 * (OpenAI, Azure-compatible proxies, LiteLLM, Ollama, vLLM, LM Studio, …).
 *
 * .env / environment:
 *   DOCSHOTS_AI_BASE_URL   default: $OPENAI_BASE_URL or https://api.openai.com/v1
 *   DOCSHOTS_AI_API_KEY    default: $OPENAI_API_KEY (may be empty for local servers)
 *   DOCSHOTS_AI_MODEL      default: $OPENAI_MODEL or gpt-4o   – must support image input
 *   DOCSHOTS_AI_JSON_MODE  default: true  – send response_format: json_object (set false if your server rejects it)
 *   DOCSHOTS_AI_TIMEOUT_MS default: 180000
 *   DOCSHOTS_AI_MAX_IMAGE_SIDE default: 2000 – larger images are scaled down in the browser before sending
 */

export interface AiConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  jsonMode: boolean;
  timeoutMs: number;
  maxImageSide: number;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** Loads .env from the given directory without overriding variables that are already set. */
export function loadEnv(dir = process.cwd()): void {
  const file = path.join(dir, '.env');
  if (!fs.existsSync(file)) return;
  const loader = (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (loader) {
    // loadEnvFile does not override existing variables either
    loader(file);
    return;
  }
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    baseUrl: (env.DOCSHOTS_AI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: env.DOCSHOTS_AI_API_KEY || env.OPENAI_API_KEY || undefined,
    model: env.DOCSHOTS_AI_MODEL || env.OPENAI_MODEL || 'gpt-4o',
    jsonMode: !/^(0|false|no|off)$/i.test(env.DOCSHOTS_AI_JSON_MODE ?? 'true'),
    timeoutMs: Number(env.DOCSHOTS_AI_TIMEOUT_MS || 180_000),
    maxImageSide: Number(env.DOCSHOTS_AI_MAX_IMAGE_SIDE || 2000),
  };
}

/** Problems that make a call pointless – checked by the CLI before a browser starts. */
export function aiConfigProblems(cfg: AiConfig): string[] {
  const problems: string[] = [];
  if (!cfg.apiKey && /api\.openai\.com/.test(cfg.baseUrl)) {
    problems.push('Kein API-Key: DOCSHOTS_AI_API_KEY (oder OPENAI_API_KEY) in .env setzen.');
  }
  try {
    new URL(cfg.baseUrl);
  } catch {
    problems.push(`DOCSHOTS_AI_BASE_URL ist keine gültige URL: ${cfg.baseUrl}`);
  }
  return problems;
}

export async function chat(cfg: AiConfig, messages: ChatMessage[]): Promise<string> {
  const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0 };
  if (cfg.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`KI-API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`Unerwartete KI-Antwort: ${text.slice(0, 500)}`);
  return content;
}

/** Extracts the first JSON object from a reply (tolerates ```json fences and chatter). */
export function parseJsonReply<T>(reply: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  const candidate = fenced ? fenced[1] : reply;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`Die KI-Antwort enthält kein JSON: ${reply.slice(0, 300)}`);
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

export function imageDataUrl(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}
