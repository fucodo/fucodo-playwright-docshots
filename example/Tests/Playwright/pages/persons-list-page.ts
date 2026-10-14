import type { Page } from '@playwright/test';

/** Stand-in for your existing PersonsListPage. */
export class PersonsListPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/administration/persons');
  }

  /** language-neutral: the first primary button in the toolbar */
  async openCreateDialog() {
    await this.page.locator('.toolbar button.primary').click();
    await this.page.locator('dialog[open]').waitFor();
  }
}
