'use strict';
// An API environment with a legacy copy (SETTINGS, SEED_OFFICERS, MASTER_LOG, UNIFORM_LOG), an empty review sheet,
// and the master data already seeded.
const { setupApi } = require('./env');
const { fillTab, readTab } = require('./sheets');
const L = require('../fixtures/legacy-copy');
const M = require('../fixtures/master-log');

const REVIEW_ID = 'review-sheet-id';

function setupReview(opts = {}) {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(L.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', L.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', L.SEED_OFFICERS);
  if (opts.masterLog !== false) fillTab(ss, 'MASTER_LOG', [M.MASTER_LOG_HEADER].concat(opts.masterRows || M.MASTER_LOG_ROWS));
  if (opts.uniformLog !== false) fillTab(ss, 'UNIFORM_LOG', [M.UNIFORM_LOG_HEADER].concat(M.UNIFORM_LOG_ROWS));
  env.legacy = ss;
  env.review = env.google.addSpreadsheet(REVIEW_ID, 'review');
  env.g('Props').set('LEGACY_COPY_ID', L.LEGACY_ID);
  env.g('Props').set('REVIEW_SHEET_ID', REVIEW_ID);
  env.admin = env.signIn('admin');
  const seed = env.call('seed.run', {}, env.admin);
  if (!seed.ok) throw new Error('seed failed in test: ' + JSON.stringify(seed));
  env.run = () => env.call('importReview.run', {}, env.admin);
  env.tab = (name) => readTab(env.review, name);
  // The tab as objects keyed by its header row.
  env.objects = (name) => {
    const rows = env.tab(name);
    if (!rows.length) return [];
    return rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));
  };
  env.snapshot = () => JSON.stringify(env.g('Schema').names().map((t) => [t, env.plain(env.g('Repository').all(t))]));
  return env;
}

module.exports = { setupReview, REVIEW_ID };
