const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VOCABULARY } = require('../dist');
const { matchStep } = require('../dist/ai/analyze');

// [text, step key, expected args]
const CASES = [
  // Kay's sentence, with the scope instead of CSS in the name
  ['Dann zeige mit einem Pfeil auf den Link "Impressum" in der Fußzeile mit "7"', 'pointAt', { kind: 'Link', name: 'Impressum', landmark: 'Fußzeile', label: '7' }],
  ['Dann zeige mit einem Pfeil auf den zweiten Link "Impressum" mit "7"', 'pointAt', { nth: 'zweiten', kind: 'Link', name: 'Impressum', label: '7' }],
  ['Dann zeige mit einem Pfeil auf den Link "Impressum" im Bereich "Fußzeile" mit "7" und dem Hinweis "Rechtliches"', 'pointAt', { scopeKind: 'Bereich', scopeName: 'Fußzeile', label: '7', note: 'Rechtliches' }],
  ['Dann markiere den letzten Link "Impressum" mit "2"', 'highlight', { nth: 'letzten', kind: 'Link', label: '2' }],
  ['Dann markiere den Button "Speichern" im Dialog "Person anlegen" mit "3"', 'highlight', { kind: 'Button', name: 'Speichern', scopeKind: 'Dialog', scopeName: 'Person anlegen', label: '3' }],
  ['Dann markiere den Button "Speichern" im Dialog', 'highlight', { kind: 'Button', landmark: 'Dialog' }],
  ['Dann markiere den Link "Impressum" im Selektor "footer .legal"', 'highlight', { scopeKind: 'Selektor', scopeName: 'footer .legal' }],
  ['Dann markiere den Link "Impressum" innerhalb der Navigation', 'highlight', { landmark: 'Navigation' }],
  ['Dann markiere die zweite Zeile "Anna"', 'highlight', { nth: 'zweite', kind: 'Zeile', name: 'Anna' }],
  ['Wenn ich auf den zweiten Link "Impressum" klicke', 'click', { nth: 'zweiten', kind: 'Link' }],
  ['Und ich klicke auf den Link "Impressum" in der Kopfzeile', 'click', { landmark: 'Kopfzeile' }],
  ['Und ich fülle das Feld "Vorname" im Dialog "Person anlegen" mit "Max" aus', 'fill', { scopeKind: 'Dialog', value: 'Max' }],
  ['Und ich gebe "Max" in das Feld "Vorname" im Dialog "Person anlegen" ein', 'fill', { kind: 'Feld', scopeName: 'Person anlegen', value: 'Max' }],
  ['Und ich scrolle zum Link "Impressum" in der Fußzeile', 'scroll', { landmark: 'Fußzeile' }],
  ['Und entferne die Markierung vom Link "Impressum" in der Fußzeile', 'hideMarkTarget', { landmark: 'Fußzeile' }],
  ['Dann erstelle einen Screenshot vom Formular "Person anlegen" im Dialog', 'screenshot', { kind: 'Formular', landmark: 'Dialog' }],
  ['Dann starte ein Video von der Tabelle "Personen" im Hauptbereich', 'videoStart', { kind: 'Tabelle', landmark: 'Hauptbereich' }],
  // no false scope: "in den sichtbaren Bereich" is the scroll wording, not a scope
  ['Und scrolle den Link "Impressum" in den sichtbaren Bereich', 'scroll', { kind: 'Link', name: 'Impressum', landmark: undefined, scopeKind: undefined }],
  // English
  ['Then point at the second link "Imprint" with "7"', 'pointAt', { nth: 'second', label: '7' }],
  ['When I click the link "Imprint" in the footer', 'click', { landmark: 'footer' }],
  ['Then highlight the button "Save" inside the dialog "Create person" with "1"', 'highlight', { scopeKind: 'dialog', scopeName: 'Create person', label: '1' }],
];

for (const [text, key, expected] of CASES) {
  test(text, () => {
    const lang = /^(Dann|Und|Wenn)\b/.test(text) ? 'de' : 'en';
    const m = matchStep(text, lang);
    assert.ok(m, 'no step matches');
    assert.equal(m.entry.key, key);
    for (const [k, v] of Object.entries(expected)) assert.equal(m.args[k], v, k);
    const t = text.replace(/^\S+\s/, '');
    assert.equal(VOCABULARY.flatMap((e) => e.patterns[lang].filter((p) => p.test(t))).length, 1, 'ambiguous');
  });
}

const AREA_CASES = [
  ['Und ich arbeite in der Fußzeile', 'area', { landmark: 'Fußzeile' }],
  ['Und ich arbeite im Bereich "Hauptmenü"', 'area', { kind: 'Bereich', name: 'Hauptmenü' }],
  ['Und ich arbeite im Bereich "footer .feeds"', 'area', { kind: 'Bereich', name: 'footer .feeds' }],
  ['Und ich arbeite nur noch im Dialog "Person anlegen"', 'area', { kind: 'Dialog', name: 'Person anlegen' }],
  ['Und ich arbeite im Dialog', 'area', { landmark: 'Dialog' }],
  ['Und ich arbeite wieder auf der ganzen Seite', 'areaReset', {}],
  ['Und ich scrolle an den Anfang der Seite', 'scrollPage', { where: 'an den Anfang der Seite' }],
  ['Und ich scrolle zum Anfang der Seite', 'scrollPage', { where: 'zum Anfang der Seite' }],
  ['Dann erstelle einen Screenshot vom Bereich "footer .feeds"', 'screenshot', { kind: 'Bereich', name: 'footer .feeds' }],
  ['Dann erstelle einen Screenshot vom Bereich "Fußzeile"', 'screenshot', { kind: 'Bereich', name: 'Fußzeile' }],
  ['And I work in the footer', 'area', { landmark: 'footer' }],
  ['And I work on the whole page again', 'areaReset', {}],
];
for (const [text, key, expected] of AREA_CASES) {
  test(`area: ${text}`, () => {
    const lang = /^(Dann|Und|Wenn)\b/.test(text) ? 'de' : 'en';
    const m = matchStep(text, lang);
    assert.ok(m, 'no step matches');
    assert.equal(m.entry.key, key);
    for (const [k, v] of Object.entries(expected)) assert.equal(m.args[k], v, k);
    const t = text.replace(/^\S+\s/, '');
    assert.equal(VOCABULARY.flatMap((e) => e.patterns[lang].filter((p) => p.test(t))).length, 1, 'ambiguous');
  });
}
