'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupReview, REVIEW_ID } = require('../helpers/review-env');
const { fillTab } = require('../helpers/sheets');
const M = require('../fixtures/master-log');
const L = require('../fixtures/legacy-copy');

const METRICS = (env) => Object.fromEntries(env.objects('summary').map((r) => [r.metric, r.value]));

test('summary equals the source row count and status counts', () => {
  const env = setupReview();
  const res = env.run();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.status, 'Done');
  assert.match(res.data.batch_id, /^IMP-\d{4}$/);
  // counted here from the fixture, one blank row left out
  const nonBlank = M.MASTER_LOG_ROWS.filter((r) => r.some((c) => c !== ''));
  const byResult = {};
  nonBlank.forEach((r) => { byResult[r[7]] = (byResult[r[7]] || 0) + 1; });
  const m = METRICS(env);
  assert.equal(Number(m['source_rows.master_log']), nonBlank.length);
  assert.equal(nonBlank.length, 10);
  assert.equal(Number(m['status.Certified']), byResult.CERTIFIED);
  assert.equal(Number(m['status.Promoted']), byResult.PROMOTION);
  assert.equal(Number(m['status.Quit']), byResult.QUIT);
  assert.equal(Number(m['status.Extended']), byResult.EXTENDED);
  assert.equal(Number(m['status.Probationary']), byResult.PROBATIONARY);
  assert.equal(Number(m['status.Failed']), byResult.FAILED + byResult.DISQUALIFIED);
  assert.equal(Number(m['status.Failed.of_which_Disqualified']), 1);
  assert.equal(Number(m['status.not_mapped']), 1);
  const mapped = ['Certified', 'Promoted', 'Quit', 'Extended', 'Probationary', 'Failed'].reduce((s, k) => s + Number(m['status.' + k]), 0);
  assert.equal(mapped + Number(m['status.not_mapped']), Number(m['source_rows.master_log']));
  assert.equal(Number(m['source_rows.uniform_log']), 3);
  assert.deepEqual(res.data.counts.master_log_rows, 10);
});

test('all six tabs are written with their headers', () => {
  const env = setupReview();
  env.run();
  for (const tab of ['persons_proposed', 'possible_duplicates', 'name_mapping', 'bad_values', 'uniform_split', 'summary']) {
    assert.ok(env.tab(tab).length >= 1, tab);
  }
  for (const tab of ['persons_proposed', 'possible_duplicates', 'name_mapping', 'bad_values', 'uniform_split']) {
    const head = env.tab(tab)[0];
    assert.deepEqual(head.slice(-6), ['row_key', 'decision', 'corrected_value', 'decided_by', 'decided_on', 'needs_review'], tab);
  }
  assert.deepEqual(env.tab('summary')[0], ['metric', 'value']);
});

test('unknown store lands in name_mapping with status none', () => {
  const env = setupReview();
  env.run();
  const rows = env.objects('name_mapping');
  const get = (kind, raw) => rows.find((r) => r.kind === kind && r.raw_value === raw);
  assert.equal(get('store', 'UNKNOWN PROVINCE').status, 'none');
  assert.equal(get('store', 'UNKNOWN PROVINCE').match, '');
  assert.equal(get('store', 'TEST STORE ONE').status, 'exact');
  assert.equal(get('store', 'TEST STORE ONE').match, 'TEST STORE ONE');
  assert.equal(get('store', 'DONA TEST').status, 'candidate');
  assert.equal(get('store', 'DONA TEST').candidates, 'DOÑA TEST');
  assert.equal(get('store', 'DOÑA TEST').status, 'exact');
  assert.equal(get('store', 'NONE'), undefined, 'NONE in SUPPORT STORE means no support store');
  assert.equal(Number(METRICS(env)['support_store.none']), 2);
});

test('stations, with the asterisk spelling left for a person to decide', () => {
  const env = setupReview();
  env.run();
  const rows = env.objects('name_mapping');
  const get = (raw) => rows.find((r) => r.kind === 'station' && r.raw_value === raw);
  assert.equal(get('FOOD PREP').status, 'exact');
  assert.equal(get('FOOD PREP').match, 'Food Prep');
  assert.equal(get('PIZZA MAKER*').status, 'candidate');
  assert.equal(get('PIZZA MAKER*').candidates, 'Pizza Maker');
  assert.equal(get('PIZZA MAKER*').note, 'ASTERISK');
});

test('officers: one spelled three ways, a first name, a typo and notes typed into the column', () => {
  const env = setupReview();
  env.run();
  const rows = env.objects('name_mapping').filter((r) => r.kind === 'officer');
  const get = (raw) => rows.find((r) => r.raw_value === raw);
  assert.equal(get('OLIVIA').status, 'exact');
  assert.equal(get('OLIVIA').match, 'Olivia Tester');
  assert.equal(get('OLIVIA').occurrences, '10');
  assert.equal(get('MARCO').status, 'exact');
  assert.equal(get('OLIVA').status, 'candidate');
  assert.equal(get('OLIVA').candidates, 'Olivia Tester');
  assert.equal(get('ZED').status, 'none');
  assert.equal(get('NO CERT').status, 'none');
  assert.equal(get('NO CERT').note, 'LOOKS_LIKE_NOTE');
  assert.equal(get('GIO / 2ND EXTEND').note, 'LOOKS_LIKE_NOTE');
  assert.equal(get('N/A'), undefined);
});

test('9475% lands in bad_values with proposed 94.75', () => {
  const env = setupReview();
  env.run();
  const bad = env.objects('bad_values');
  const row = bad.find((r) => r.raw_value === '9475%');
  assert.ok(row);
  assert.deepEqual([row.source_tab, row.source_row, row.column, row.code, row.proposed], ['MASTER_LOG', '3', 'istv', 'PERCENT_SCALED', '94.75']);
});

test('every kind of bad value from the fixture is listed with its source row', () => {
  const env = setupReview();
  env.run();
  const key = (r) => r.source_tab + ':' + r.source_row + ':' + r.column + ':' + r.code;
  const keys = env.objects('bad_values').map(key);
  for (const want of [
    'MASTER_LOG:7:date_certified:CERT_BEFORE_ENTRY',
    'MASTER_LOG:7:uniform_release:UNREADABLE',
    'MASTER_LOG:7:uniform_release:UNKNOWN_SIZE',
    'MASTER_LOG:8:techval_fp:SERIAL_1899',
    'MASTER_LOG:9:date_certified:FUTURE',
    'MASTER_LOG:9:status:UNKNOWN_STATUS_VALUE',
    'MASTER_LOG:11:result:UNKNOWN_STATUS',
    'MASTER_LOG:12:entry_date:UNREADABLE',
    'UNIFORM_LOG:4:size:UNKNOWN_SIZE',
    'UNIFORM_LOG:4:quantity:BAD_QUANTITY',
  ]) assert.ok(keys.includes(want), 'missing ' + want + ' in ' + keys.join(', '));
  const future = env.objects('bad_values').find((r) => r.column === 'date_certified' && r.code === 'FUTURE');
  assert.equal(future.proposed, '2026-08-12');
  // Disqualified is information, not an error
  assert.ok(!keys.some((k) => k.startsWith('MASTER_LOG:7:result')));
  assert.equal(env.objects('bad_values').filter((r) => r.source_row === '10').length, 0, 'the blank row is skipped');
});

test('uniform cell with two parts gives two uniform_split rows', () => {
  const env = setupReview();
  env.run();
  const rows = env.objects('uniform_split');
  const r2 = rows.filter((r) => r.source === 'MASTER_LOG' && r.source_row === '2');
  assert.deepEqual(r2.map((r) => [r.size, r.quantity]), [['SMALL', '3'], ['LARGE', '1']]);
  assert.ok(r2.every((r) => r.full_name === 'MARCO TESTER' && r.item === ''));
  const dr = rows.find((r) => r.source_row === '5');
  assert.deepEqual([dr.size, dr.quantity, dr.dr_no], ['XLARGE', '1', '700003248']);
  const ul = rows.filter((r) => r.source === 'UNIFORM_LOG');
  assert.equal(ul.length, 2);
  assert.deepEqual([ul[0].size, ul[0].quantity, ul[0].dr_no, ul[0].issued_on], ['MEDIUM', '2', '700000001', '2026-09-28']);
  assert.equal(rows.length, 7);
});

test('persons are proposed, a person with two enrollments is one person, duplicates are pairs', () => {
  const env = setupReview();
  env.run();
  const persons = env.objects('persons_proposed');
  assert.equal(persons.length, 9);
  const rea = persons.find((p) => p.proposed_name === 'REA SAMPLE');
  assert.equal(rea.enrollments, '2');
  assert.equal(rea.entry_dates, '2025-03-02 | 2026-08-05');
  assert.equal(rea.source_rows, '4, 5');
  const dups = env.objects('possible_duplicates');
  assert.equal(dups.length, 1);
  assert.deepEqual([dups[0].name_a, dups[0].name_b, dups[0].reason], ['DARYL FAYE C. SAMPLE', 'DARYL FAYE SAMPLE', 'MIDDLE_PART_DIFFERS']);
});

test('no TLMI_DB table other than import_batches and audit_log changes', () => {
  const env = setupReview();
  const before = JSON.parse(env.snapshot());
  env.run();
  const after = JSON.parse(env.snapshot());
  const changed = after.filter((t, i) => JSON.stringify(t) !== JSON.stringify(before[i])).map((t) => t[0]).sort();
  assert.deepEqual(changed, ['audit_log', 'id_counters', 'import_batches']);
  const batch = after.find((t) => t[0] === 'import_batches')[1].filter((b) => b.kind === 'IMPORT_REVIEW');
  assert.equal(batch.length, 1);
  assert.equal(batch[0].status, 'Done');
  assert.equal(batch[0].source_row_count, 13);
  assert.ok(env.auditRows().some((r) => r.event === 'IMPORT.REVIEW_RUN'));
  // the legacy copy is not written
  assert.equal(env.legacy.getSheetByName('MASTER_LOG').getLastRow(), 1 + M.MASTER_LOG_ROWS.length);
  assert.equal(env.legacy.getSheetByName('name_mapping'), null);
});

test('re-run keeps a decision on an unchanged row', () => {
  const env = setupReview();
  env.run();
  const sheet = env.review.getSheetByName('name_mapping');
  const head = env.tab('name_mapping')[0];
  const rowIdx = env.tab('name_mapping').findIndex((r) => r[1] === 'UNKNOWN PROVINCE') + 1;
  sheet.getRange(rowIdx, head.indexOf('decision') + 1, 1, 3).setValues([['correct value', 'DOÑA TEST', 'Ada Admin']]);
  const second = env.run();
  assert.equal(second.data.status, 'Done');
  const row = env.objects('name_mapping').find((r) => r.raw_value === 'UNKNOWN PROVINCE');
  assert.deepEqual([row.decision, row.corrected_value, row.decided_by, row.needs_review], ['correct value', 'DOÑA TEST', 'Ada Admin', '']);
  assert.equal(env.objects('name_mapping').filter((r) => r.raw_value === 'UNKNOWN PROVINCE').length, 1);
});

test('re-run marks a changed row needs_review and never clears the decision', () => {
  const env = setupReview();
  env.run();
  const sheet = env.review.getSheetByName('bad_values');
  const head = env.tab('bad_values')[0];
  const rowIdx = env.tab('bad_values').findIndex((r) => r[0] === 'MASTER_LOG' && r[1] === '3' && r[2] === 'istv') + 1;
  sheet.getRange(rowIdx, head.indexOf('decision') + 1, 1, 1).setValues([['correct value']]);
  // the source value changes
  const col = M.MASTER_LOG_HEADER.indexOf('ISTV GRADE') + 1;
  env.legacy.getSheetByName('MASTER_LOG').getRange(3, col).setValues([['94750%']]);
  env.run();
  const row = env.objects('bad_values').find((r) => r.source_row === '3' && r.column === 'istv');
  assert.equal(row.raw_value, '94750%');
  assert.equal(row.decision, 'correct value');
  assert.equal(row.needs_review, 'TRUE');
});

test('a decided row whose source disappeared is kept and marked', () => {
  const env = setupReview();
  env.run();
  const sheet = env.review.getSheetByName('bad_values');
  const head = env.tab('bad_values')[0];
  const rowIdx = env.tab('bad_values').findIndex((r) => r[0] === 'MASTER_LOG' && r[1] === '8') + 1;
  sheet.getRange(rowIdx, head.indexOf('decision') + 1, 1, 1).setValues([['correct value']]);
  const col = M.MASTER_LOG_HEADER.indexOf('TECHVAL FP') + 1;
  env.legacy.getSheetByName('MASTER_LOG').getRange(8, col).setValues([['90%']]);
  env.run();
  const row = env.objects('bad_values').find((r) => r.source_row === '8' && r.column === 'techval_fp');
  assert.ok(row);
  assert.equal(row.decision, 'correct value');
  assert.equal(row.needs_review, 'SOURCE_CHANGED');
});

test('a confirmed alias is used on the next run', () => {
  const env = setupReview();
  env.run();
  const sheet = env.review.getSheetByName('name_mapping');
  const head = env.tab('name_mapping')[0];
  const rowIdx = env.tab('name_mapping').findIndex((r) => r[0] === 'store' && r[1] === 'UNKNOWN PROVINCE') + 1;
  sheet.getRange(rowIdx, head.indexOf('decision') + 1, 1, 2).setValues([['confirm', 'PROVINCIAL TEST']]);
  env.run();
  const row = env.objects('name_mapping').find((r) => r.raw_value === 'UNKNOWN PROVINCE');
  assert.equal(row.status, 'exact');
  assert.equal(row.match, 'PROVINCIAL TEST');
  assert.equal(row.decision, 'confirm');
});

test('a missing MASTER_LOG tab fails the batch and keeps the old review', () => {
  const env = setupReview();
  env.run();
  const keep = JSON.stringify(env.tab('bad_values'));
  assert.ok(keep.length > 10);
  const sheets = env.legacy.sheets;
  sheets.splice(sheets.findIndex((s) => s.name === 'MASTER_LOG'), 1);
  const res = env.run();
  assert.equal(res.ok, true);
  assert.equal(res.data.status, 'Failed');
  assert.ok(res.data.message.includes('MASTER_LOG'));
  assert.ok(!JSON.stringify(res).includes(L.LEGACY_ID));
  assert.equal(JSON.stringify(env.tab('bad_values')), keep);
  const batches = env.plain(env.g('Repository').all('import_batches')).filter((b) => b.kind === 'IMPORT_REVIEW');
  assert.deepEqual(batches.map((b) => b.status), ['Done', 'Failed']);
  assert.ok(batches[1].note.includes('MASTER_LOG'));
  assert.ok(!JSON.stringify(batches).includes(L.LEGACY_ID));
});

test('a missing required header fails the batch', () => {
  const env = setupReview();
  const sheet = env.legacy.getSheetByName('MASTER_LOG');
  sheet.getRange(1, 5).setValues([['Name of person']]);
  const res = env.run();
  assert.equal(res.data.status, 'Failed');
  assert.ok(res.data.message.includes('FULL NAME'));
});

test('headers match after trimming and collapsing spaces', () => {
  const env = setupReview();
  const res = env.run();
  assert.equal(res.data.status, 'Done');
  assert.ok(M.MASTER_LOG_HEADER.some((h) => h !== h.trim() || /  /.test(h)));
});

test('importReview.get returns counts only, never an id or link', () => {
  const env = setupReview();
  const none = env.call('importReview.get', {}, env.admin);
  assert.deepEqual(none.data, { last_run: null, counts: {} });
  env.run();
  const got = env.call('importReview.get', {}, env.admin);
  assert.equal(got.data.last_run.status, 'Done');
  assert.equal(got.data.counts.bad_values, env.objects('bad_values').length);
  assert.equal(got.data.counts.persons_proposed, 9);
  const text = JSON.stringify(got);
  for (const bad of [REVIEW_ID, L.LEGACY_ID, 'docs.google', 'http']) assert.ok(!text.includes(bad), bad);
});

test('non-Admin is FORBIDDEN', () => {
  const env = setupReview();
  for (const role of ['officer', 'supervisor', 'manager', 'senior']) {
    const t = env.signIn(role);
    assert.equal(env.call('importReview.run', {}, t).error.code, 'FORBIDDEN', role);
    assert.equal(env.call('importReview.get', {}, t).error.code, 'FORBIDDEN', role);
  }
  assert.equal(env.tab('summary').length, 0);
});

test('missing REVIEW_SHEET_ID or LEGACY_COPY_ID is CONFIG_MISSING by name', () => {
  const env = setupReview();
  env.g('Props').remove('REVIEW_SHEET_ID');
  assert.equal(env.run().error.message.includes('REVIEW_SHEET_ID'), true);
  env.g('Props').set('REVIEW_SHEET_ID', REVIEW_ID);
  env.g('Props').remove('LEGACY_COPY_ID');
  const r = env.run();
  assert.equal(r.error.code, 'CONFIG_MISSING');
  assert.ok(r.error.message.includes('LEGACY_COPY_ID'));
});

test('the review runs without a UNIFORM_LOG tab', () => {
  const env = setupReview({ uniformLog: false });
  const res = env.run();
  assert.equal(res.data.status, 'Done');
  assert.equal(Number(METRICS(env)['source_rows.uniform_log']), 0);
  assert.equal(env.objects('uniform_split').filter((r) => r.source === 'UNIFORM_LOG').length, 0);
});

test('review text is stored as text', () => {
  const env = setupReview({ masterRows: [M.MASTER_LOG_ROWS[0].slice(0, 4).concat(['00123 TEST', ...M.MASTER_LOG_ROWS[0].slice(5)])] });
  env.run();
  const p = env.objects('persons_proposed');
  assert.equal(p[0].proposed_name, '00123 TEST');
  assert.equal(p[0].entry_dates, '2025-11-14');
});

test('an unexpected error is a SERVER error to the caller, a Failed batch with a generic note, and keeps the old review', () => {
  const env = setupReview();
  env.run();
  const keep = JSON.stringify(env.tab('persons_proposed'));
  env.g('ImportRules').checkRow = () => { throw new TypeError('cannot read ' + L.LEGACY_ID); };
  const res = env.run();
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'SERVER');
  assert.ok(!JSON.stringify(res).includes(L.LEGACY_ID));
  const batches = env.plain(env.g('Repository').all('import_batches')).filter((b) => b.kind === 'IMPORT_REVIEW');
  assert.deepEqual(batches.map((b) => b.status), ['Done', 'Failed']);
  assert.equal(batches[1].note, 'Unexpected error.');
  assert.equal(JSON.stringify(env.tab('persons_proposed')), keep);
});
