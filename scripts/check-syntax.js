'use strict';

// Minimal lint: every JS file under src, scripts, test and public must at least parse.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const roots = ['src', 'scripts', 'test', 'public'];
let failed = 0;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (e) { failed++; console.error(`${file}\n${e.stderr}`); }
  }
}
if (failed) process.exit(1);
console.log('Syntax check passed.');
