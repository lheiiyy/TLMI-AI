'use strict';
// A review environment (tests/helpers/review-env.js) whose review sheet has been built and can be given officer decisions,
// plus helpers for the legacy import. Invented data only.
const { setupReview } = require('./review-env');
const { BASELINE } = require('../fixtures/review-decisions');
const { writeDecisions } = require('./review-decide');

function setupImport(opts = {}) {
  const env = setupReview(opts);
  const first = env.run();
  if (!first.ok || first.data.status !== 'Done') throw new Error('review run failed: ' + JSON.stringify(first));

  // Writes decisions into the review sheet. See tests/fixtures/review-decisions.js for the shape.
  env.decide = (spec) => writeDecisions(env.review, spec);
  env.decideBaseline = () => env.decide(BASELINE);
  env.validate = () => env.call('import.validate', {}, env.admin);
  env.validateOk = () => {
    const r = env.validate();
    if (!r.ok) throw new Error('validate failed: ' + JSON.stringify(r));
    return r.data;
  };
  env.importRows = (importId) => env.rows('import_rows').filter((r) => r.import_id === importId);
  env.rows = (t) => env.plain(env.g('Repository').all(t));
  // The result of every row of a batch, by source row.
  env.results = (importId) => Object.fromEntries(env.importRows(importId).map((r) => [r.source_row, r.result]));
  env.issuesOf = (importId, row) => {
    const r = env.importRows(importId).find((x) => x.source_row === row);
    return JSON.parse(r.issues);
  };
  env.codesOf = (importId, row) => env.issuesOf(importId, row).issues.map((i) => i.code);
  env.warningsOf = (importId, row) => env.issuesOf(importId, row).warnings.map((i) => i.code);
  return env;
}

module.exports = { setupImport, BASELINE };

// A master-log row built from named cells. Defaults: a probationary row of an invented person at an exact store and station.
const COLS = ['ts', 'entry_date', 'batch', 'store', 'name', 'station', 'support', 'result', 'uniform', 'entry_by', 'istv', 'techval_fp',
  'techval_pm', 'exam_fp', 'exam_pm', 'entry_average', 'deadline', 'cert_by', 'date_certified', 'cert_grade', 'exam_grade', 'average', 'status'];
function masterRow(over) {
  const base = {
    entry_date: '1 Mar 2026', batch: 'BATCH 7', store: 'TEST STORE ONE', name: 'JO EXAMPLE', station: 'FOOD PREP', result: 'PROBATIONARY',
    entry_by: 'OLIVIA', istv: '90%',
  };
  const v = Object.assign(base, over || {});
  return COLS.map((c) => (v[c] === undefined ? '' : v[c]));
}

// The plan as the service would compute it now (decisions and sources as they are in the sheets).
function planNow(env) {
  const S = env.g('ImportService');
  const g = S._internals.gather();
  return env.plain(S.plan(g.master, g.decisions, g.lists, S._internals.readState(env.g('Repository'))));
}

module.exports.masterRow = masterRow;
module.exports.planNow = planNow;
