const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeVideo, findFfmpeg, DEFAULT_VIDEO } = require('../dist/video');
const { probeJpegSize, withFormat } = require('../dist/video');
const { VOCABULARY } = require('../dist');
const { matchStep } = require('../dist/ai/analyze');

const ffmpeg = findFfmpeg();
const ffprobe = ffmpeg && ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

function jpeg(color, w = 400, h = 300) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-jpg-')), 'f.jpg');
  spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', out]);
  return fs.readFileSync(out);
}
function probe(file) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height,codec_name', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  return { ...j.streams[0], duration: Number(j.format.duration) };
}

test('reads JPEG size and switches the extension', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  assert.deepEqual(probeJpegSize(jpeg('red', 320, 200)), { width: 320, height: 200 });
  assert.equal(withFormat('/x/a.mp4', 'webm'), '/x/a.webm');
  assert.equal(withFormat('/x/a', 'mp4'), '/x/a.mp4');
});

test('encodes variable-rate frames with real timing and crops (mp4)', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  const t0 = 1_000_000;
  const frames = [
    { data: jpeg('red'), timestamp: t0, viewportWidth: 400, viewportHeight: 300 },
    { data: jpeg('blue'), timestamp: t0 + 1000, viewportWidth: 400, viewportHeight: 300 },
  ];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-vid-')), 'out.mp4');
  const res = encodeVideo({
    frames, endTimestamp: t0 + 2000, file,
    options: { ...DEFAULT_VIDEO, hold: 500 },
    region: { x: 10, y: 10, width: 101, height: 77 },
  });
  const p = probe(file);
  assert.equal(p.codec_name, 'h264');
  assert.equal(p.width, 100);   // even sizes for H.264
  assert.equal(p.height, 76);
  assert.equal(res.width, 100);
  assert.ok(Math.abs(p.duration - 3.0) < 0.2, `duration ${p.duration}`); // 2 s + 2 × 0.5 s hold
});

test('webm output', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  const t0 = 5_000;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-vid-')), 'out.webm');
  encodeVideo({ frames: [{ data: jpeg('green'), timestamp: t0, viewportWidth: 400, viewportHeight: 300 }], endTimestamp: t0 + 500, file, options: { ...DEFAULT_VIDEO, format: 'webm', hold: 0 } });
  const p = probe(file);
  assert.equal(p.codec_name, 'vp9');
  assert.equal(p.width, 400);
});

test('fails clearly without frames', () => {
  assert.throws(() => encodeVideo({ frames: [], endTimestamp: 0, file: '/tmp/x.mp4', options: DEFAULT_VIDEO }), /Keine Video-Frames/);
});

const CASES = [
  ['Dann starte ein Video', 'videoStart', {}],
  ['Dann starte ein Video vom Formular "Person anlegen"', 'videoStart', { kind: 'Formular', name: 'Person anlegen' }],
  ['Wenn ich ein Video "teil-2" vom Dialog "X" starte', 'videoStart', { shot: 'teil-2', kind: 'Dialog', name: 'X' }],
  ['Dann beende das Video', 'videoStop', {}],
  ['Und blende die Markierungen aus', 'hideMarksAll', {}],
  ['Und entferne alle Markierungen', 'hideMarksAll', {}],
  ['Und blende die Markierung "1" aus', 'hideMarkLabel', { label: '1' }],
  ['Und entferne die Markierung mit der Nummer "2"', 'hideMarkLabel', { label: '2' }],
  ['Und entferne die Markierung vom Feld "Vorname"', 'hideMarkTarget', { kind: 'Feld', name: 'Vorname' }],
  ['Und blende die Markierung von dem Button "Speichern" aus', 'hideMarkTarget', { kind: 'Button', name: 'Speichern' }],
  ['Und zeige den Titel "Person anlegen" mit der Beschreibung "Kurz"', 'videoTitle', { title: 'Person anlegen', desc: 'Kurz' }],
  ['When I start a video of the form "Create person"', 'videoStart', { kind: 'form', name: 'Create person' }],
  ['And hide the marker "1"', 'hideMarkLabel', { label: '1' }],
  ['Then stop the recording', 'videoStop', {}],
];
for (const [text, key, expected] of CASES) {
  test(`step: ${text}`, () => {
    const lang = /^(Dann|Und|Wenn)\b/.test(text) ? 'de' : 'en';
    const m = matchStep(text, lang);
    assert.ok(m, 'no match');
    assert.equal(m.entry.key, key);
    for (const [k, v] of Object.entries(expected)) assert.equal(m.args[k], v, k);
    const t = text.replace(/^\S+\s/, '');
    assert.equal(VOCABULARY.flatMap((e) => e.patterns[lang].filter((p) => p.test(t))).length, 1, 'ambiguous');
  });
}

test('drops frames of a temporarily resized viewport (screenshots during recording)', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  const t0 = 10_000;
  const frames = [
    { data: jpeg('red', 400, 300), timestamp: t0, viewportWidth: 400, viewportHeight: 300 },
    { data: jpeg('blue', 400, 900), timestamp: t0 + 300, viewportWidth: 400, viewportHeight: 900 }, // full-page shot
    { data: jpeg('green', 400, 300), timestamp: t0 + 600, viewportWidth: 400, viewportHeight: 300 },
  ];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-vid-')), 'out.mp4');
  encodeVideo({ frames, endTimestamp: t0 + 1000, file, options: { ...DEFAULT_VIDEO, hold: 0 }, region: { x: 0, y: 200, width: 200, height: 100 } });
  const p = probe(file);
  assert.equal(p.height, 100);
  assert.ok(Math.abs(p.duration - 1.0) < 0.15, `duration ${p.duration}`);
});
