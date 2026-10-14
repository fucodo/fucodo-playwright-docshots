// Domain steps on top of your page objects – they show up in the cheat sheet as "Projektspezifische Schritte".
import { Given, When } from './index';

Given('ich bin in der Personenverwaltung', async ({ personsListPage }) => {
  await personsListPage.goto();
});

When('ich den Dialog zum Anlegen einer Person öffne', async ({ personsListPage }) => {
  await personsListPage.openCreateDialog();
});
