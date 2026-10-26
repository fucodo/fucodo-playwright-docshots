const { test } = require('node:test');
const assert = require('node:assert/strict');
const { labelMatcher } = require('../dist/steps/targets');

test('labels: without affixes the name stays an exact string', () => {
  assert.equal(labelMatcher('Speichern'), 'Speichern');
  assert.equal(labelMatcher('Speichern', { prefixes: [], suffixes: [''] }), 'Speichern');
});

test('labels: optional prefixes and suffixes, whole string, case-sensitive', () => {
  const m = labelMatcher('Person anlegen', { prefixes: ['[✓] ', '(x)'], suffixes: [' *'] });
  for (const ok of ['Person anlegen', '[✓] Person anlegen', '[✓]Person  anlegen', '(x) Person anlegen *', 'Person anlegen*']) assert.match(ok, m, ok);
  for (const bad of ['person anlegen', '[✓] Person anlegen speichern', 'Neue Person anlegen', '[?] Person anlegen', '✓ Person anlegen']) assert.doesNotMatch(bad, m, bad);
});

test('labels: regex characters in names and affixes are literal', () => {
  const m = labelMatcher('Preis (netto) $', { prefixes: ['[*] '] });
  assert.match('[*] Preis (netto) $', m);
  assert.doesNotMatch('[x] Preis (netto) $', m);
});
