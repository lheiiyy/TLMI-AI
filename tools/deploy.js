'use strict';
// Pushes the built app to the DEV or TEST Apps Script project with clasp. It refuses LIVE: LIVE is deployed by hand
// by the owner, after a dated copy of the LIVE sheet (docs/SETUP.md). It refuses a dirty git tree, so that every deploy
// has a commit to roll back to, and it refuses to push when the unit tests fail.
// The script ID is read from the git-ignored file .clasp.<env>.json and is never printed or committed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function defaultRun(cmd, args, opts) {
  const r = spawnSync(cmd, args, { cwd: (opts && opts.cwd) || ROOT, encoding: 'utf8', stdio: cmd === 'git' ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', error: r.error };
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

  if (o.run('npm', ['test']).status !== 0) throw new Error('The unit tests failed. Nothing was pushed.');
  o.build();
  const dist = path.join(o.root, 'dist');
  fs.writeFileSync(path.join(dist, '.clasp.json'), JSON.stringify({ scriptId: scriptId, rootDir: '.' }));

  const pushed = o.run('clasp', ['push', '--force'], { cwd: dist });
  if (pushed.status !== 0) throw new Error('clasp push failed. Is clasp installed (npm install -g @google/clasp) and are you logged in (clasp login)?');
  o.log('Pushed to ' + env.toUpperCase() + '. The web app is not redeployed by this: see docs/SETUP.md for the deployment step.');
  return { env: env };
}

module.exports = { deploy };

if (require.main === module) {
  try {
    deploy(process.argv[2]);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
