export { defineDocshotConfig, DEFAULT_OUTPUT, type DocshotConfig, type ViewportSpec, type LanguageSpec } from './config';
export {
  docshotTest, Docshot, readDocshotTags, fillTemplate,
  type DocshotFixtures, type DocshotOptions, type DocshotVariant, type CaptureOptions, type ManifestEntry,
} from './fixture';
export { registerDocshotSteps, type DocshotAdapters, type LoginContext } from './steps/register';
export { resolveTarget, TARGET_KINDS, type AreaRegistry } from './steps/targets';
export { VOCABULARY, type VocabEntry } from './steps/vocabulary';
export { createCredentialsResolver, envName, type Persona, type PersonaRegistry, type Credentials, type CredentialsResolver } from './credentials';
export { extractAll, rewriteLocations } from './sources/extract';
export { parseRst, toFeature, DocshotSourceError, type DocshotLanguage } from './sources/rst';
export { layoutProblems } from './overlay';
export type { OverlayTheme, MarkStyle, OverlayLayout, CaptureMode } from './overlay';
export { checkSetup, initProject, formatWarnings, type SetupWarning, type InitOptions, type InitResult } from './setup';
