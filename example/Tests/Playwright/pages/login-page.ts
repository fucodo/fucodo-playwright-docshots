import type { Page } from '@playwright/test';

/** Stand-in for your existing LoginPage. */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async completeLogin(username: string, password: string) {
    await this.page.locator('#username').fill(username);
    await this.page.locator('#password').fill(password);
    await this.page.locator('#login-submit').click();
    await this.page.waitForURL((url) => !url.pathname.startsWith('/login'));
  }
}
