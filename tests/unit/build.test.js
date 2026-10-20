'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, guardIds } = require('../../tools/build');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tlmi-build-')); }

test('build writes dist with server files and one index.html', () => {
  const out = tmp();
  const written = build({ outDir: path.join(out, 'dist') });
  const files = fs.readdirSync(path.join(out, 'dist')).sort();
  assert.deepEqual(files, written.slice().sort());
  assert.ok(files.includes('Api.gs') && files.includes('Repository.gs') && files.includes('Setup.gs'));
  assert.ok(files.includes('appsscript.json'));
  assert.equal(files.filter((f) => f.endsWith('.html')).length, 1);
  const serverFiles = fs.readdirSync(path.join(__dirname, '..', '..', 'src', 'server')).filter((f) => f.endsWith('.gs'));
  serverFiles.forEach((f) => assert.ok(files.includes(f), f));
  const page = fs.readFileSync(path.join(out, 'dist', 'index.html'), 'utf8');
  assert.ok(page.includes('<style>') && page.includes('window.TLMI_TRANSPORT = "appsscript"'));
  assert.ok(page.includes('id="view-manager"') && page.includes('id="view-home"'), 'the views are inlined');
  assert.ok(!/<link[^>]+stylesheet/i.test(page) && !/<script[^>]+src=/i.test(page), 'nothing is loaded from outside');
  assert.ok(!page.includes('<!--STYLES-->') && !page.includes('<!--VIEWS-->') && !page.includes('<!--SCRIPTS-->'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'dist', 'appsscript.json'), 'utf8')).runtimeVersion, 'V8');
  fs.rmSync(out, { recursive: true, force: true });
});

test('the page keeps dollar signs from the scripts', () => {
  const out = tmp();
  build({ outDir: path.join(out, 'dist') });
  const page = fs.readFileSync(path.join(out, 'dist', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'client', 'app.js'), 'utf8');
  assert.ok(page.includes(app), 'app.js is inlined unchanged');
  fs.rmSync(out, { recursive: true, force: true });
});

test('a mock build uses the mock transport', () => {
  const out = tmp();
  build({ outDir: path.join(out, 'dist'), transport: 'mock' });
  assert.ok(fs.readFileSync(path.join(out, 'dist', 'index.html'), 'utf8').includes('window.TLMI_TRANSPORT = "mock"'));
  fs.rmSync(out, { recursive: true, force: true });
});

// The ID-looking strings in this file and in the test below are invented samples. They exist only to prove that the
// build guard refuses an ID in the source. They are not real sheet, script or document IDs.
test('build refuses an ID in the source', () => {
  const bad = [
    "SpreadsheetApp.openById('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg');",
    "const u = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg/edit';",
    "const id = 'AKfycbxAbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';",
  ];
  for (const line of bad) {
    const src = tmp();
    fs.mkdirSync(path.join(src, 'server'));
    fs.writeFileSync(path.join(src, 'server', 'Bad.gs'), line + '\n');
    assert.throws(() => guardIds(src), /Script Properties/, line);
    assert.throws(() => build({ srcDir: src, outDir: path.join(src, 'dist') }), /Bad\.gs/);
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('build accepts short names and property keys', () => {
  const src = tmp();
  fs.mkdirSync(path.join(src, 'server'));
  fs.writeFileSync(path.join(src, 'server', 'Ok.gs'), "const k = 'TLMI_DB_ID'; const a = Props.get('LEGACY_COPY_ID'); SpreadsheetApp.openById(id);\n");
  assert.doesNotThrow(() => guardIds(src));
  fs.rmSync(src, { recursive: true, force: true });
});

test('the page is assembled without interpreting dollar patterns in the files', () => {
  const { assemblePage } = require('../../tools/assemble');
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<head><!--STYLES--></head><body><!--VIEWS--><!--SCRIPTS--></body>');
  const tricky = "a$&b $' $` $$ $1";
  fs.writeFileSync(path.join(dir, 'styles.css'), '/* ' + tricky + ' */ body{color:red}');
  fs.writeFileSync(path.join(dir, 'api.js'), '// ' + tricky + '\nwindow.A = 1;');
  fs.writeFileSync(path.join(dir, 'app.js'), '// ' + tricky + '\nwindow.B = 2;');
  fs.writeFileSync(path.join(dir, 'views', 'v.html'), '<template id="x">' + tricky + '</template>');
  const page = assemblePage(dir, 'mock');
  assert.equal(page.split(tricky).length - 1, 4, 'each file keeps its text exactly once');
  assert.ok(!page.includes('<!--'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a closing script or style tag inside a client file stops the build', () => {
  const { assemblePage } = require('../../tools/assemble');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'index.html'), '<!--STYLES--><!--VIEWS--><!--SCRIPTS-->');
  fs.writeFileSync(path.join(dir, 'styles.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'api.js'), 'var s = "</script>";');
  fs.writeFileSync(path.join(dir, 'app.js'), '');
  assert.throws(() => assemblePage(dir, 'mock'), /closing script tag/);
  fs.writeFileSync(path.join(dir, 'api.js'), '');
  fs.writeFileSync(path.join(dir, 'styles.css'), '</style>');
  assert.throws(() => assemblePage(dir, 'mock'), /closing style tag/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('each ID pattern is caught on its own', () => {
  const cases = [
    "SpreadsheetApp.openById('1AbCdEfGhIjKlMnOpQrStUvWxYz');",
    "x = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit';",
    "x = 'https://script.google.com/macros/s/AKfycbxAbCdEfGhIjKlMnOpQrStUvWxYz/exec';",
  ];
  for (const line of cases) {
    const src = tmp();
    fs.writeFileSync(path.join(src, 'Bad.gs'), line + '\n');
    assert.throws(() => guardIds(src), /Script Properties/, line);
    fs.rmSync(src, { recursive: true, force: true });
  }
});
