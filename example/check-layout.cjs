// Checks the recorded annotation layouts of the last `docshots test` run for overflow and collisions.
const fs = require('node:fs');
const { layoutProblems } = require('@fucodo/playwright-docshots');
const manifest = JSON.parse(fs.readFileSync('.docshots/manifest.json', 'utf8'));
let problems = 0;
let checked = 0;
for (const [id, entries] of Object.entries(manifest)) {
  for (const e of entries) {
    if (!e.layout) continue;
    checked++;
    const found = layoutProblems(e.layout, e.marks);
    problems += found.length;
    console.log(`${found.length ? '✘' : '✔'} ${id} [${e.project}]${found.map((p) => `\n    ${p}`).join('')}`);
  }
}
console.log(`\n${checked} layouts checked, ${problems} problems`);
process.exit(problems ? 1 : 0);
