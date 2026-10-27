const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withImageFormat, DEFAULT_IMAGE } = require('../dist/image');
const { DEFAULT_OUTPUT } = require('../dist');

test('webp is the default image format', () => {
  assert.equal(DEFAULT_IMAGE.format, 'webp');
  assert.match(DEFAULT_OUTPUT, /\.webp$/);
});

test('withImageFormat replaces the extension of the output template', () => {
  assert.equal(withImageFormat('img/{id}/{viewport}.png', 'webp'), 'img/{id}/{viewport}.webp');
  assert.equal(withImageFormat('img/a.webp', 'png'), 'img/a.png');
  assert.equal(withImageFormat('img/a.jpeg', 'webp'), 'img/a.webp');
  assert.equal(withImageFormat('img/a.PNG', 'jpeg'), 'img/a.jpg');
  assert.equal(withImageFormat('img/a', 'webp'), 'img/a.webp');
  assert.equal(withImageFormat('img/a.v1', 'png'), 'img/a.v1.png');
});
