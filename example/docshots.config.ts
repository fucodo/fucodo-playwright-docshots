import { defineDocshotConfig } from '@fucodo/playwright-docshots';
import baseConfig from './Tests/Playwright/playwright.config';

export default defineDocshotConfig({
  base: baseConfig,
  language: 'de',

  sources: {
    rst: ['Documentation/**/*.rst'],
    features: ['Documentation/Screenshots/**/*.feature'],
  },
  steps: ['Tests/Playwright/docshots/steps/**/*.ts'],

  variants: {
    viewports: {
      desktop: { width: 1280, height: 800, deviceScaleFactor: 2 },
      mobile: 'iPhone 13',
    },
    schemes: ['light', 'dark'],
    languages: { de: {}, en: {} },
  },

  output: 'Documentation/Images/Screenshots/{id}/{viewport}-{scheme}-{lang}.png',
  keepClean: true,
  clock: '2026-09-15T09:30:00+02:00',
  theme: { color: '#d50c2f' },
  video: { format: 'mp4', cursor: true },
});
