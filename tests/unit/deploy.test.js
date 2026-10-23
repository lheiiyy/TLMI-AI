'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deploy, spawnOptions } = require('../../tools/deploy');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tlmi-deploy-'));
  fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'client'), { recursive: true });
  return root;
}

// A fake runner: records the commands, answers `git status` with the text given.
function runner(gitStatus) {
  const calls = [];
  const fn = (cmd, args) => {
    calls.push([cmd].concat(args).join(' '));
    if (cmd === 'git') return { status: 0, stdout: gitStatus };
    return { status: 0, stdout: '' };
  };
  fn.calls = calls;
  return fn;
}

test('deploy refuses live and a dirty tree', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, '.clasp.dev.json'), JSON.stringify({ scriptId: 'dev-script-id-placeholder' }));
  const logs = [];
  const base = { root: root, log: (m) => logs.push(m), build: () => ['x'] };

  for (const env of ['live', 'LIVE', 'prod', '', undefined, '../dev']) {
    const run = runner('');
    assert.throws(() => deploy(env, Object.assign({ run: run }, base)), /dev or test/, String(env));
    assert.equal(run.calls.length, 0, 'nothing runs for ' + env);
  }

  const dirty = runner(' M src/server/Api.gs\n');
  assert.throws(() => deploy('dev', Object.assign({ run: dirty }, base)), /uncommitted/);
  assert.ok(!dirty.calls.some((c) => c.startsWith('clasp')), 'clasp never runs on a dirty tree');
  assert.ok(!dirty.calls.some((c) => c.startsWith('npm')), 'nothing is built or tested on a dirty tree');
  fs.rmSync(root, { recursive: true, force: true });
});

test('deploy needs the ignored clasp file for the environment', () => {
  const root = sandbox();
  const run = runner('');
  assert.throws(() => deploy('test', { root: root, run: run, build: () => [], log: () => {} }), /\.clasp\.test\.json/);
  assert.ok(!run.calls.some((c) => c.startsWith('clasp')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('deploy runs the tests, builds, copies the clasp file to dist and pushes from dist', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, '.clasp.test.json'), JSON.stringify({ scriptId: 'test-script-id-placeholder' }));
  const run = runner('');
  const built = [];
  deploy('test', { root: root, run: run, build: () => { built.push(1); fs.mkdirSync(path.join(root, 'dist'), { recursive: true }); return []; }, log: () => {} });
  assert.deepEqual(run.calls[0], 'git status --porcelain');
  assert.ok(run.calls.indexOf('npm test') > 0);
  assert.equal(built.length, 1);
  const clasp = JSON.parse(fs.readFileSync(path.join(root, 'dist', '.clasp.json'), 'utf8'));
  assert.deepEqual(clasp, { scriptId: 'test-script-id-placeholder', rootDir: '.' });
  const push = run.calls.find((c) => c.startsWith('clasp'));
  assert.equal(push, 'clasp push --force');
  assert.ok(run.calls.indexOf('npm test') < run.calls.indexOf(push));
  fs.rmSync(root, { recursive: true, force: true });
});

test('deploy stops when the tests fail and never pushes', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, '.clasp.dev.json'), JSON.stringify({ scriptId: 'dev-script-id-placeholder' }));
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd].concat(args).join(' '));
    if (cmd === 'npm') return { status: 1, stdout: '' };
    return { status: 0, stdout: '' };
  };
  assert.throws(() => deploy('dev', { root: root, run: run, build: () => [], log: () => {} }), /tests failed/);
  assert.ok(!calls.some((c) => c.startsWith('clasp')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('a clasp file without a script id is refused', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, '.clasp.dev.json'), JSON.stringify({}));
  assert.throws(() => deploy('dev', { root: root, run: runner(''), build: () => [], log: () => {} }), /scriptId/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the deploy command line never prints the script id', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, '.clasp.dev.json'), JSON.stringify({ scriptId: 'dev-script-id-placeholder' }));
  const logs = [];
  const run = runner('');
  deploy('dev', { root: root, run: run, build: () => { fs.mkdirSync(path.join(root, 'dist'), { recursive: true }); return []; }, log: (m) => logs.push(m) });
  assert.ok(!logs.join('\n').includes('dev-script-id-placeholder'));
  assert.ok(!run.calls.join('\n').includes('dev-script-id-placeholder'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('spawnOptions uses a shell for npm and clasp on Windows only', () => {
  assert.equal(spawnOptions('npm', 'win32', '/x').shell, true);
  assert.equal(spawnOptions('clasp', 'win32', '/x').shell, true);
  assert.equal(spawnOptions('git', 'win32', '/x').shell, false);
  for (const cmd of ['npm', 'clasp', 'git']) {
    assert.equal(spawnOptions(cmd, 'linux', '/x').shell, false, cmd + ' on linux');
    assert.equal(spawnOptions(cmd, 'darwin', '/x').shell, false, cmd + ' on darwin');
  }
  assert.equal(spawnOptions('npm', 'linux', '/x').cwd, '/x');
  assert.deepEqual(spawnOptions('git', 'linux', '/x').stdio, ['ignore', 'pipe', 'inherit']);
  assert.equal(spawnOptions('npm', 'linux', '/x').stdio, 'inherit');
});

test('deploy says the command could not be started when run returns an error', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, '.clasp.dev.json'), JSON.stringify({ scriptId: 'dev-script-id-placeholder' }));
  const calls = [];
  const run = (cmd, args) => {
    calls.push(cmd);
    if (cmd === 'npm') return { status: 1, stdout: '', error: new Error('spawnSync npm ENOENT') };
    return { status: 0, stdout: '' };
  };
  assert.throws(() => deploy('dev', { root: root, run: run, build: () => [], log: () => {} }), (e) => /Could not run npm: spawnSync npm ENOENT/.test(e.message) && !/tests failed/.test(e.message));
  assert.ok(!calls.includes('clasp'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('deploy says the command could not be started when clasp cannot run', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, '.clasp.dev.json'), JSON.stringify({ scriptId: 'dev-script-id-placeholder' }));
  const run = (cmd) => (cmd === 'clasp' ? { status: 1, stdout: '', error: new Error('spawnSync clasp EINVAL') } : { status: 0, stdout: '' });
  assert.throws(() => deploy('dev', { root: root, run: run, build: () => { fs.mkdirSync(path.join(root, 'dist'), { recursive: true }); return []; }, log: () => {} }), /Could not run clasp: spawnSync clasp EINVAL/);
  fs.rmSync(root, { recursive: true, force: true });
});
