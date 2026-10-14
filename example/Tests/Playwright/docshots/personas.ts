import type { PersonaRegistry } from '@fucodo/playwright-docshots';

// No real passwords in the repo – only where to find them (CI variables / local .env).
export const personas: PersonaRegistry = {
  schooladmin: { username: 'doc-schooladmin', passwordEnv: 'DOCSHOT_PW_SCHOOLADMIN' },
  teacher:     { username: 'doc-teacher',     passwordEnv: 'DOCSHOT_PW_TEACHER' },
};
