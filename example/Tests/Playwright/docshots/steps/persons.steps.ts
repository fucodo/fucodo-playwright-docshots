// Domain steps on top of your page objects – they show up in the cheat sheet as "Projektspezifische Schritte".
import { Given, When, Then } from './index';

Given('ich bin in der Personenverwaltung', async ({ personsListPage }) => {
  await personsListPage.goto();
});

When('ich den Dialog zum Anlegen einer Person öffne', async ({ personsListPage }) => {
  await personsListPage.openCreateDialog();
});

// Test-only steps for the scroll checks in the example (not needed in real projects)
Then('die Seite ist ganz {word} gescrollt', async ({ page }, where: string) => {
  const state = await page.evaluate(() => {
    const els = [document.scrollingElement, ...Array.from(document.querySelectorAll('*'))].filter(
      (el): el is Element => !!el && el.scrollHeight > el.clientHeight + 1 && (el === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(el).overflowY)),
    );
    return els.map((el) => ({ el: el.tagName + (el.className ? '.' + el.className : ''), top: Math.round(el.scrollTop), max: el.scrollHeight - el.clientHeight }));
  });
  const scrolled = state.filter((s) => s.max > 0);
  const ok = where === 'oben' ? scrolled.every((s) => s.top <= 1) : scrolled.some((s) => s.top >= s.max - 1);
  if (!ok) throw new Error(`nicht ganz ${where}: ${JSON.stringify(scrolled)}`);
});
