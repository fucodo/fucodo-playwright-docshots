const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VOCABULARY } = require('../dist');
const { groupNames } = require('../dist/steps/vocabulary');

const KEYWORDS = /^(Angenommen|Gegeben sei|Wenn|Dann|Und|Aber|Given|When|Then|And|But)\s+/;

for (const lang of ['de', 'en']) {
  test(`every ${lang} example matches exactly one step`, () => {
    for (const entry of VOCABULARY) {
      for (const example of entry.examples[lang]) {
        const text = example.replace(KEYWORDS, '');
        const hits = VOCABULARY.flatMap((e) => e.patterns[lang].filter((p) => p.test(text)).map(() => e.key));
        assert.deepEqual(hits, [entry.key], `"${example}" → ${JSON.stringify(hits)}`);
      }
    }
  });
}

test('both German word orders give the same arguments', () => {
  const click = VOCABULARY.find((v) => v.key === 'click');
  const args = (text) => {
    const p = click.patterns.de.find((r) => r.test(text));
    const m = p.exec(text);
    return Object.fromEntries(groupNames(p).map((n) => [n, m.groups[n]]).filter(([, v]) => v !== undefined));
  };
  assert.deepEqual(args('ich klicke auf den Button "Speichern"'), { kind: 'Button', name: 'Speichern' });
  assert.deepEqual(args('ich auf den Button "Speichern" klicke'), { kind: 'Button', name: 'Speichern' });
});

test('highlight with label and note', () => {
  const hl = VOCABULARY.find((v) => v.key === 'highlight');
  const m = hl.patterns.de[0].exec('markiere das Feld "E-Mail" mit "2" und Hinweis "Pflichtfeld"');
  assert.equal(m.groups.kind, 'Feld');
  assert.equal(m.groups.label, '2');
  assert.equal(m.groups.note, 'Pflichtfeld');
});
