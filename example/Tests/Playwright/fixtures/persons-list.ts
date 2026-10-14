import { test as base } from "@playwright/test";
import { PersonsListPage } from "@playwright-common/pages/persons-list-page";

export const test = base.extend<{ personsListPage: PersonsListPage }>({
  personsListPage: async ({ page }, use) => {
    await use(new PersonsListPage(page));
  },
});
