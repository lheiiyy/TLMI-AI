'use strict';
// Pushes the built app to the DEV or TEST Apps Script project with clasp. It refuses LIVE: LIVE is deployed by hand
// by the owner, after a dated copy of the LIVE sheet (docs/SETUP.md). It refuses a dirty git tree, so that every deploy
// has a commit to roll back to, and it refuses to push when the unit tests fail.
// The script ID is read from the git-ignored file .clasp.<env>.json and is never printed or committed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// On Windows, npm and clasp are .cmd shims that spawnSync cannot start without a shell. git is a real executable. The
// commands and arguments are fixed strings in this file; no user input goes into a command line.
function spawnOptions(cmd, platform, cwd) {
  return {
    cwd: cwd,
    encoding: 'utf8',
    stdio: cmd === 'git' ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: platform === 'win32' && (cmd === 'npm' || cmd === 'clasp')
  };
}

function defaultRun(cmd, args, opts) {
  const r = spawnSync(cmd, args, spawnOptions(cmd, process.platform, (opts && opts.cwd) || ROOT));
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', error: r.error };
}

// A command that could not be started at all (r.error is set) is reported as such, not as a failed test or push.
function notStarted(cmd, r) {
  return r && r.error ? new Error('Could not run ' + cmd + ': ' + (r.error.message || String(r.error))) : null;
}

function deploy(env, opts) {
  const o = Object.assign({ root: ROOT, run: defaultRun, build: () => require('./build').build(), log: console.log }, opts || {});
  if (env !== 'dev' && env !== 'test') throw new Error('deploy pushes to dev or test only. LIVE is deployed by hand by the owner.');

  const status = o.run('git', ['status', '--porcelain']);
  if (status.status !== 0) throw new Error('git status failed.');
  if (String(status.stdout).trim() !== '') throw new Error('The working tree has uncommitted changes. Commit first, so that every deploy can be rolled back.');

  const file = '.clasp.' + env + '.json';
  const claspFile = path.join(o.root, file);
  if (!fs.existsSync(claspFile)) throw new Error('Missing ' + file + ' (it is ignored by git). See docs/SETUP.md.');
  let scriptId;
  try { scriptId = JSON.parse(fs.readFileSync(claspFile, 'utf8')).scriptId; } catch (e) { throw new Error(file + ' is not valid JSON.'); }
  if (typeof scriptId !== 'string' || scriptId === '') throw new Error(file + ' has no scriptId.');

  const tested = o.run('npm', ['test']);
  if (notStarted('npm', tested)) throw notStarted('npm', tested);
  if (tested.status !== 0) throw new Error('The unit tests failed. Nothing was pushed.');
  o.build();
  const dist = path.join(o.root, 'dist');
  fs.writeFileSync(path.join(dist, '.clasp.json'), JSON.stringify({ scriptId: scriptId, rootDir: '.' }));

  const pushed = o.run('clasp', ['push', '--force'], { cwd: dist });
  if (notStarted('clasp', pushed)) throw notStarted('clasp', pushed);
  if (pushed.status !== 0) throw new Error('clasp push failed. Is clasp installed (npm install -g @google/clasp) and are you logged in (clasp login)?');
  o.log('Pushed to ' + env.toUpperCase() + '. The web app is not redeployed by this: see docs/SETUP.md for the deployment step.');
  return { env: env };
}

module.exports = { deploy, spawnOptions };

if (require.main === module) {
  try {
    deploy(process.argv[2]);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
