'use strict';
// Writes officer decisions into a (fake) review sheet. The shape is described in tests/fixtures/review-decisions.js.
const { readTab } = require('./sheets');

function writeDecisions(review, spec) {
  const put = (tab, match, decision, value) => {
    const sheet = review.getSheetByName(tab);
    const rows = readTab(review, tab);
    const head = rows[0];
    const idx = rows.findIndex((r, i) => i > 0 && match(Object.fromEntries(head.map((h, c) => [h, r[c]]))));
    if (idx < 0) throw new Error('no row to decide in ' + tab);
    sheet.getRange(idx + 1, head.indexOf('decision') + 1, 1, 2).setValues([[decision, value === undefined ? '' : value]]);
  };
  const s = spec || {};
  Object.keys(s.persons || {}).forEach((k) => {
    const d = [].concat(s.persons[k]);
    put('persons_proposed', (r) => r.proposed_name === k, d[0], d[1]);
  });
  Object.keys(s.duplicates || {}).forEach((k) => {
    const [a, b] = k.split(' | ');
    put('possible_duplicates', (r) => r.name_a === a && r.name_b === b, s.duplicates[k]);
  });
  (s.mapping || []).forEach(([kind, raw, decision, value]) => put('name_mapping', (r) => r.kind === kind && r.raw_value === raw, decision, value));
  (s.bad || []).forEach(([row, column, decision, value]) => put('bad_values', (r) => r.source_row === String(row) && r.column === column, decision, value));
}

module.exports = { writeDecisions };
