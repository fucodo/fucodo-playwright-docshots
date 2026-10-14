// Your existing fixture, unchanged.
import { test as base } from "@playwright/test";
import { LoginPage } from "@playwright-common/pages/login-page";
import { HomePage } from "@playwright-common/pages/home-page";

export type LoginOptions = {
  loginUsername: string;
  loginPassword: string;
};

export type LoginFixtures = {
  loginPage: LoginPage;
  loggedInPage: HomePage;
};

export const test = base.extend<LoginOptions & LoginFixtures>({
  loginUsername: ["", { option: true }],
  loginPassword: ["", { option: true }],

  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await test.step("goto login page", async () => {
      await loginPage.goto();
    });

    await use(loginPage);
  },

  loggedInPage: async ({ page, loginUsername, loginPassword }, use) => {
    const loginPage = new LoginPage(page);
    await test.step("login", async () => {
      await loginPage.completeLogin(loginUsername, loginPassword);
    });

    await use(new HomePage(page));
  }
});
