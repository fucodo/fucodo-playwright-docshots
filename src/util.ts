export function slug(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'screenshot';
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? slug(values[key]) : m));
}

/** Reads @id:, @viewports:, @schemes:, @lang:/@languages: tags of the current test. */
export function readDocshotTags(tags: string[]) {
  const list = (prefixes: string[]) => {
    for (const t of tags) {
      for (const p of prefixes) {
        if (t.toLowerCase().startsWith(`@${p}:`)) return t.slice(p.length + 2).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return undefined;
  };
  return {
    id: list(['id'])?.[0],
    viewports: list(['viewports', 'viewport']),
    schemes: list(['schemes', 'scheme']),
    languages: list(['languages', 'lang', 'language']),
    source: list(['source'])?.[0],
  };
}
