const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VOCABULARY } = require('../dist');
const { matchStep } = require('../dist/ai/analyze');

// Kay's list – the reference for consistent marking steps
const CASES = [
  ['Dann markiere den Button "Speichern"',                                      'highlight', 'Button', 'Speichern', undefined, undefined],
  ['Dann markiere das Feld "Vorname" mit "1"',                                   'highlight', 'Feld',   'Vorname',   '1',       undefined],
  ['Dann markiere das Feld "E-Mail" mit "2" und Hinweis "Pflichtfeld"',          'highlight', 'Feld',   'E-Mail',    '2',       'Pflichtfeld'],
  ['Dann markiere den Link "Vorname" mit "1"',                                   'highlight', 'Link',   'Vorname',   '1',       undefined],
  ['Dann zeige mit einem Pfeil auf den Button "Hilfe"',                          'pointAt',   'Button', 'Hilfe',     undefined, undefined],
  ['Dann zeige mit einem Pfeil auf das Feld "Hilfe"',                            'pointAt',   'Feld',   'Hilfe',     undefined, undefined],
  ['Dann zeige mit einem Pfeil auf den Link "Hilfe"',                            'pointAt',   'Link',   'Hilfe',     undefined, undefined],
  ['Dann zeige mit einem Pfeil auf den Link "Hilfe" und mit "2"',                'pointAt',   'Link',   'Hilfe',     '2',       undefined],
  ['Dann zeige mit einem Pfeil auf den Link "Hilfe" und mit "2" und dem Hinweis "Pflichtfeld"', 'pointAt', 'Link', 'Hilfe', '2', 'Pflichtfeld'],
  ['Und verdecke das Feld "E-Mail"',                                             'mask',      'Feld',   'E-Mail',    undefined, undefined],
  // the same suffixes work on both marking steps
  ['Dann markiere den Button "Speichern" und mit "3" und dem Hinweis "Zum Schluss"', 'highlight', 'Button', 'Speichern', '3', 'Zum Schluss'],
  ['Dann zeige mit einem Pfeil auf den Button "Hilfe" mit "1" und Hinweis "Hier"',   'pointAt',   'Button', 'Hilfe',     '1', 'Hier'],
  ['Dann markiere das Feld "Vorname" mit dem Hinweis "Pflicht"',                 'highlight', 'Feld',   'Vorname',   undefined, 'Pflicht'],
  ['Dann zeige mit einem Pfeil auf den Link "Hilfe" und dem Hinweis "Anleitung"','pointAt',   'Link',   'Hilfe',     undefined, 'Anleitung'],
  // English counterparts
  ['Then highlight the field "Email" with "2" and note "Required"',              'highlight', 'field',  'Email',     '2',       'Required'],
  ['Then point at the link "Help" and with "2" and the note "Required"',         'pointAt',   'link',   'Help',      '2',       'Required'],
];

for (const [text, key, kind, name, label, note] of CASES) {
  test(text, () => {
    const lang = /^(Dann|Und|Wenn|Angenommen)\b/.test(text) ? 'de' : 'en';
    const m = matchStep(text, lang);
    assert.ok(m, 'no step matches');
    assert.equal(m.entry.key, key);
    assert.deepEqual(
      { kind: m.args.kind, name: m.args.name, label: m.args.label, note: m.args.note },
      { kind, name, label, note },
    );
    // exactly one built-in pattern may match – otherwise steps would be ambiguous
    const text0 = text.replace(/^\S+\s/, '');
    const hits = VOCABULARY.flatMap((e) => e.patterns[lang].filter((p) => p.test(text0)));
    assert.equal(hits.length, 1, `ambiguous: ${hits.length} patterns`);
  });
}
