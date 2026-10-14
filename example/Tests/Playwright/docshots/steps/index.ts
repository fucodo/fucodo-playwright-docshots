import { mergeTests } from '@playwright/test';
import { docshotTest, registerDocshotSteps } from '@fucodo/playwright-docshots';
import { test as appTest } from '@playwright-common/index';
import { LoginPage } from '@playwright-common/pages/login-page';
import { personas } from '../personas';

/** One test object for built-in and project steps – your fixtures + the docshot fixture. */
export const test = mergeTests(appTest, docshotTest);

export const { Given, When, Then } = registerDocshotSteps(test, {
  personas,

  // Reuses your LoginPage page object – same flow as the loginPage fixture.
  login: async ({ page, credentials }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.completeLogin(credentials.username, credentials.password);
  },

  // Named areas for things without a clean accessible name.
  // Key: the exact phrase support staff write, or a plain name for 'Bereich "…"'.
  areas: {
    'Formular "Person anlegen"': (page) => page.locator('dialog[open]'),
    'form "Create person"': (page) => page.locator('dialog[open]'),
    'Tabelle "Personen"': (page) => page.locator('table'),
    'Hauptmenü': (page) => page.getByRole('navigation'),
    'Spalte "E-Mail"': (page) => page.locator('td.mail'),
  },
});
