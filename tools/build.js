'use strict';
// Builds dist/ for `clasp push`: every server .gs file, one index.html (CSS, views and scripts inlined) and appsscript.json.
// It refuses to build when a sheet, script or document ID is written in the source: IDs belong in Script Properties.
const fs = require('node:fs');
const path = require('node:path');
const { assemblePage } = require('./assemble');

const ROOT = path.join(__dirname, '..');

const ID_PATTERNS = [
  [/openById\(\s*['"`][A-Za-z0-9_-]{25,}['"`]/, 'an ID passed to openById'],
  [/docs\.google\.com\/(spreadsheets|document|forms)\/d\/[A-Za-z0-9_-]{25,}/, 'a Google document link with an ID'],
  [/script\.google\.com\/[^\s'"]*[A-Za-z0-9_-]{25,}/, 'a Google script link with an ID'],
  [/['"`][A-Za-z0-9_-]{33,}['"`]/, 'a quoted string of 33 or more letters and digits (looks like an ID)'],
];

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function guardIds(srcDir) {
  const found = [];
  filesUnder(srcDir).forEach((file) => {
    if (!/\.(gs|js|html|css|json)$/.test(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    ID_PATTERNS.forEach(([re, what]) => {
      if (re.test(text)) found.push(path.relative(srcDir, file) + ': ' + what);
    });
  });
  if (found.length) throw new Error('Build stopped. Remove the ID from the source and use Script Properties:\n  ' + found.join('\n  '));
}

function build(opts) {
  const o = Object.assign({ srcDir: path.join(ROOT, 'src'), outDir: path.join(ROOT, 'dist'), manifest: path.join(ROOT, 'appsscript.json'), transport: 'appsscript' }, opts || {});
  guardIds(o.srcDir);
  fs.rmSync(o.outDir, { recursive: true, force: true });
  fs.mkdirSync(o.outDir, { recursive: true });
  const written = [];
  fs.readdirSync(path.join(o.srcDir, 'server')).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    fs.copyFileSync(path.join(o.srcDir, 'server', f), path.join(o.outDir, f));
    written.push(f);
  });
  fs.writeFileSync(path.join(o.outDir, 'index.html'), assemblePage(path.join(o.srcDir, 'client'), o.transport));
  written.push('index.html');
  fs.copyFileSync(o.manifest, path.join(o.outDir, 'appsscript.json'));
  written.push('appsscript.json');
  return written;
}

module.exports = { build, guardIds };

if (require.main === module) {
  try {
    const written = build();
    console.log('dist/ built: ' + written.length + ' files');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
