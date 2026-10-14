const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { matchStep, withKeywords, stripKeyword } = require('../dist/ai/analyze');
const { findImageReferences, insertBlock, idExists } = require('../dist/ai/insert');
const { parseJsonReply, aiConfig } = require('../dist/ai/client');

test('matches model steps with and without keyword', () => {
  assert.equal(matchStep('Wenn ich auf den Button "Speichern" klicke', 'de').entry.key, 'click');
  assert.equal(matchStep('Then take a screenshot of the form "X"', 'en').entry.key, 'screenshot');
  assert.equal(matchStep('Und tanze', 'de'), undefined);
  assert.deepEqual(withKeywords(['markiere den Button "A"', 'erstelle einen Screenshot'], 'de'), ['Und markiere den Button "A"', 'Dann erstelle einen Screenshot']);
  assert.equal(stripKeyword('Gegeben sei ich öffne "/x"', 'de'), 'ich öffne "/x"');
});

test('parses fenced or chatty JSON replies', () => {
  assert.deepEqual(parseJsonReply('Sure!\n```json\n{"steps":["a"]}\n```'), { steps: ['a'] });
  assert.deepEqual(parseJsonReply('{"steps":[]} thanks'), { steps: [] });
});

test('reads AI config with fallbacks', () => {
  const c = aiConfig({ OPENAI_API_KEY: 'k', DOCSHOTS_AI_JSON_MODE: 'false' });
  assert.equal(c.baseUrl, 'https://api.openai.com/v1');
  assert.equal(c.apiKey, 'k');
  assert.equal(c.jsonMode, false);
});

test('finds TYPO3-style image references and inserts the block', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-'));
  const doc = path.join(root, 'Documentation', 'Admin');
  fs.mkdirSync(path.join(root, 'Documentation', 'Images'), { recursive: true });
  fs.mkdirSync(doc, { recursive: true });
  const img = path.join(root, 'Documentation', 'Images', 'old.png');
  fs.writeFileSync(img, '');
  const rst = path.join(doc, 'Page.rst');
  fs.writeFileSync(rst, 'Title\n=====\n\n    ..  figure:: /Images/old.png\n        :alt: x\n\n..  image:: ../Images/old.png\n');

  const refs = findImageReferences(root, ['Documentation/**/*.rst'], img);
  assert.equal(refs.length, 2);
  const newImg = path.join(root, 'Documentation', 'Images', 'Screenshots', 'old', 'desktop-light-de.png');
  const newPath = insertBlock(refs[0], 'old', ['Dann erstelle einen Screenshot'], newImg, root);
  assert.equal(newPath, '/Images/Screenshots/old/desktop-light-de.png');
  const out = fs.readFileSync(rst, 'utf8');
  assert.match(out, /\n    \.\.  docshot: old\n        Dann erstelle einen Screenshot\n\n    \.\.  figure:: \/Images\/Screenshots\/old\/desktop-light-de\.png/);
  assert.match(out, /\.\.  image:: \.\.\/Images\/old\.png/); // other style untouched in this run
  assert.equal(idExists(root, ['Documentation/**/*.rst'], 'old'), path.join('Documentation', 'Admin', 'Page.rst'));
});
