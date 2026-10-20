'use strict';
// Review round 2 of pull request C: failed review writes, needs_review, alias rules, grade and officer rules,
// swap proposals, seed reports and seed audit rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupReview } = require('../helpers/review-env');
const { setupApi } = require('../helpers/env');
const { fillTab, readTab } = require('../helpers/sheets');
const { loadServer } = require('../helpers/loader');
const M = require('../fixtures/master-log');
const L = require('../fixtures/legacy-copy');

const R = loadServer().g('ImportRules');
const plain = (x) => JSON.parse(JSON.stringify(x));
const colOf = (name) => M.MASTER_LOG_HEADER.indexOf(name) + 1;

function decide(env, tab, matcher, values) {
  const rows = env.tab(tab);
  const head = rows[0];
  const rowIdx = rows.findIndex(matcher) + 1;
  assert.ok(rowIdx > 1, 'row to decide not found in ' + tab);
  const first = head.indexOf(values.from || 'decision') + 1;
  env.review.getSheetByName(tab).getRange(rowIdx, first, 1, values.cells.length).setValues([values.cells]);
}

// A failing setValues that writes nothing, as Google Sheets does.
function failOnce(sheet) {
  const orig = sheet.getRange.bind(sheet);
  let armed = true;
  sheet.getRange = (...a) => {
    const r = orig(...a);
    const sv = r.setValues.bind(r);
    r.setValues = (v) => {
      if (armed && v.length > 1) { armed = false; throw new Error('Service invoked too many times'); }
      return sv(v);
    };
    return r;
  };
  return () => { sheet.getRange = orig; };
}

test('a failed write on one review tab keeps that tab and its decisions', () => {
  const env = setupReview();
  env.run();
  decide(env, 'name_mapping', (r) => r[1] === 'UNKNOWN PROVINCE', { cells: ['correct value', 'DOÑA TEST', 'Ada Admin'] });
  const before = JSON.stringify(env.tab('name_mapping'));
  const restore = failOnce(env.review.getSheetByName('name_mapping'));
  const failed = env.run();
  restore();
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'SERVER');
  assert.equal(JSON.stringify(env.tab('name_mapping')), before, 'the old tab is untouched');
  const batches = env.plain(env.g('Repository').all('import_batches')).filter((b) => b.kind === 'IMPORT_REVIEW');
  assert.deepEqual(batches.map((b) => b.status), ['Done', 'Failed']);
  const next = env.run();
  assert.equal(next.data.status, 'Done');
  const row = env.objects('name_mapping').find((r) => r.raw_value === 'UNKNOWN PROVINCE');
  assert.deepEqual([row.decision, row.corrected_value, row.decided_by], ['correct value', 'DOÑA TEST', 'Ada Admin']);
});

test('writeReview over a longer old tab blanks the old cells and never clears first', () => {
  const env = setupReview();
  const ss = env.google.addSpreadsheet('rev-3', 'review');
  const Rp = env.g('Repository');
  Rp.writeReview('rev-3', 't', ['a', 'b', 'c'], [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]);
  Rp.writeReview('rev-3', 't', ['a', 'b'], [['x', 'y']]);
  assert.deepEqual(readTab(ss, 't'), [['a', 'b'], ['x', 'y']]);
  const restore = failOnce(ss.getSheetByName('t'));
  assert.throws(() => Rp.writeReview('rev-3', 't', ['a', 'b'], [['p', 'q'], ['r', 's']]), /too many times/);
  restore();
  assert.deepEqual(readTab(ss, 't'), [['a', 'b'], ['x', 'y']]);
});

test('an officer-cleared needs_review stays clear on an unchanged row', () => {
  const env = setupReview();
  env.run();
  decide(env, 'bad_values', (r) => r[1] === '3' && r[2] === 'istv', { cells: ['correct value'] });
  env.legacy.getSheetByName('MASTER_LOG').getRange(3, colOf('ISTV GRADE')).setValues([['9476%']]);
  env.run();
  let row = env.objects('bad_values').find((r) => r.source_row === '3' && r.column === 'istv');
  assert.equal(row.needs_review, 'TRUE');
  decide(env, 'bad_values', (r) => r[1] === '3' && r[2] === 'istv', { from: 'needs_review', cells: [''] });
  env.run();
  row = env.objects('bad_values').find((r) => r.source_row === '3' && r.column === 'istv');
  assert.equal(row.needs_review, '');
  assert.equal(row.decision, 'correct value');
});

test('a row that returns after SOURCE_CHANGED is marked TRUE', () => {
  const env = setupReview();
  env.run();
  decide(env, 'bad_values', (r) => r[1] === '8' && r[2] === 'techval_fp', { cells: ['correct value'] });
  const cell = env.legacy.getSheetByName('MASTER_LOG').getRange(8, colOf('TECHVAL FP'));
  cell.setValues([['90%']]);
  env.run();
  assert.equal(env.objects('bad_values').find((r) => r.source_row === '8' && r.column === 'techval_fp').needs_review, 'SOURCE_CHANGED');
  cell.setValues([['30 Dec 1899']]);
  env.run();
  const back = env.objects('bad_values').find((r) => r.source_row === '8' && r.column === 'techval_fp');
  assert.equal(back.decision, 'correct value');
  assert.equal(back.needs_review, 'TRUE');
});

test('confirm with several candidates and no value makes no alias and says so', () => {
  const env = setupReview();
  env.legacy.getSheetByName('MASTER_LOG').getRange(2, colOf('Mother Store')).setValues([['TEST']]);
  env.run();
  const row = () => env.objects('name_mapping').find((r) => r.kind === 'store' && r.raw_value === 'TEST');
  assert.equal(row().status, 'candidate');
  assert.ok(row().candidates.split(' | ').length > 1);
  decide(env, 'name_mapping', (r) => r[0] === 'store' && r[1] === 'TEST', { cells: ['confirm'] });
  env.run();
  assert.equal(row().status, 'candidate');
  assert.equal(row().note, 'CONFIRM_NEEDS_VALUE');
  assert.equal(row().decision, 'confirm');
});

test('confirm with a value that is not a master record makes no alias and says so', () => {
  const env = setupReview();
  env.run();
  decide(env, 'name_mapping', (r) => r[0] === 'store' && r[1] === 'UNKNOWN PROVINCE', { cells: ['confirm', 'PROVINCIAL TESTT'] });
  env.run();
  const row = env.objects('name_mapping').find((r) => r.raw_value === 'UNKNOWN PROVINCE');
  assert.equal(row.status, 'none');
  assert.equal(row.match, '');
  assert.equal(row.note, 'ALIAS_TARGET_UNKNOWN');
});

test('confirm with exactly one candidate and no value makes the alias, but a typed value must be a master name', () => {
  const env = setupReview();
  env.run();
  decide(env, 'name_mapping', (r) => r[0] === 'store' && r[1] === 'DONA TEST', { cells: ['confirm'] });
  env.run();
  const row = env.objects('name_mapping').find((r) => r.raw_value === 'DONA TEST');
  assert.equal(row.status, 'exact');
  assert.equal(row.match, 'DOÑA TEST');
  // a typed value is matched to the master spelling, ignoring case and spacing
  decide(env, 'name_mapping', (r) => r[0] === 'store' && r[1] === 'UNKNOWN PROVINCE', { cells: ['confirm', ' provincial  test '] });
  env.run();
  const row2 = env.objects('name_mapping').find((r) => r.raw_value === 'UNKNOWN PROVINCE');
  assert.equal(row2.status, 'exact');
  assert.equal(row2.match, 'PROVINCIAL TEST');
});

test('an alias for an officer must be an active user', () => {
  const env = setupReview();
  env.run();
  decide(env, 'name_mapping', (r) => r[0] === 'officer' && r[1] === 'ZED', { cells: ['confirm', 'Nobody Here'] });
  env.run();
  assert.equal(env.objects('name_mapping').find((r) => r.raw_value === 'ZED').note, 'ALIAS_TARGET_UNKNOWN');
  decide(env, 'name_mapping', (r) => r[0] === 'officer' && r[1] === 'ZED', { cells: ['confirm', 'marco sample'] });
  env.run();
  const z = env.objects('name_mapping').find((r) => r.raw_value === 'ZED');
  assert.deepEqual([z.status, z.match], ['exact', 'Marco Sample']);
});

test('parseGrade proposes a scaled value only for four or five digits', () => {
  assert.deepEqual(plain(R.parseGrade('105%')), { issue: 'OUT_OF_RANGE' });
  assert.deepEqual(plain(R.parseGrade('875%')), { issue: 'OUT_OF_RANGE' });
  assert.deepEqual(plain(R.parseGrade('999%')), { issue: 'OUT_OF_RANGE' });
  assert.deepEqual(plain(R.parseGrade('9475%')), { issue: 'PERCENT_SCALED', proposed: 94.75 });
  assert.deepEqual(plain(R.parseGrade('1000%')), { issue: 'PERCENT_SCALED', proposed: 10 });
  assert.deepEqual(plain(R.parseGrade('10000%')), { issue: 'PERCENT_SCALED', proposed: 100 });
  assert.deepEqual(plain(R.parseGrade('10001%')), { issue: 'OUT_OF_RANGE' });
  assert.deepEqual(plain(R.parseGrade('9475.5%')), { issue: 'OUT_OF_RANGE' });
});

test('a one-letter officer name is never exact', () => {
  const users = ['Ada Admin', 'Ben Cruz', 'Carla Diaz'];
  assert.deepEqual(plain(R.matchOfficer('A', users)), { status: 'candidate', candidates: ['Ada Admin'] });
  assert.equal(plain(R.matchOfficer('Z', users)).status, 'none');
  assert.equal(plain(R.matchOfficer('AD', users)).status, 'candidate');
  assert.equal(plain(R.matchOfficer('ADA', users)).status, 'exact');
  assert.equal(plain(R.matchOfficer('Ada Admin', users)).status, 'exact');
});

test('a certification date before entry gets a day and month swap proposal when one fits', () => {
  const rec = { entry_date: '15 Mar 2026', date_certified: '10/02/2026', full_name: 'A B', mother_store: 'S', result: 'CERTIFIED' };
  assert.deepEqual(plain(R.checkRow(rec, '2026-10-20')), [{ field: 'date_certified', raw: '10/02/2026', code: 'CERT_BEFORE_ENTRY', proposed: '2026-10-02' }]);
  // day above 12: no swap is possible
  const noSwap = Object.assign({}, rec, { date_certified: '24/01/2026' });
  assert.deepEqual(plain(R.checkRow(noSwap, '2026-10-20')), [{ field: 'date_certified', raw: '24/01/2026', code: 'CERT_BEFORE_ENTRY' }]);
  // the swapped date would be in the future: no proposal
  const future = Object.assign({}, rec, { entry_date: '15 Mar 2026', date_certified: '12/02/2026' });
  assert.equal(plain(R.checkRow(future, '2026-10-20'))[0].proposed, undefined);
  // same day and month: nothing to swap
  const same = Object.assign({}, rec, { entry_date: '15 Mar 2026', date_certified: '05/05/2025' });
  assert.equal(plain(R.checkRow(same, '2026-10-20'))[0].proposed, undefined);
  // not in slash form: no proposal
  const words = Object.assign({}, rec, { date_certified: '2 Feb 2026' });
  assert.equal(plain(R.checkRow(words, '2026-10-20'))[0].proposed, undefined);
});

function seedEnv(settings) {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(L.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', settings || L.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', L.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', L.LEGACY_ID);
  env.admin = env.signIn('admin');
  return env;
}

test('a region spelled differently only by case or spacing is skipped and reported once', () => {
  const env = seedEnv([['STORE A', 'NCR'], ['STORE B', 'Ncr '], ['STORE C', 'ncr'], ['STORE D', 'Ncr'], ['STORE E', 'NCR']]);
  const d = env.call('seed.run', {}, env.admin).data;
  const regions = d.skipped.filter((s) => s.table === 'regions');
  assert.deepEqual(regions.map((s) => [s.value, s.reason]), [['Ncr', 'DUPLICATE_IN_SOURCE'], ['ncr', 'DUPLICATE_IN_SOURCE']]);
  assert.equal(env.plain(env.g('Repository').all('regions')).length, 1);
  assert.equal(d.created.locations, 5);
});

test('every record the seed creates has its own audit row, with the same event names as the services', () => {
  const env = seedEnv();
  env.call('seed.run', {}, env.admin);
  const rows = env.plain(env.g('Repository').all('audit_log')).filter((r) => r.event !== 'AUTH.SIGNIN' && r.event !== 'SEED.RUN');
  const byEvent = {};
  rows.forEach((r) => { byEvent[r.event] = (byEvent[r.event] || 0) + 1; });
  assert.equal(byEvent['MASTER.BRAND.CREATED'], 1);
  assert.equal(byEvent['MASTER.REGION.CREATED'], 2);
  assert.equal(byEvent['MASTER.STATION.CREATED'], 6);
  assert.equal(byEvent['LOCATION.CREATED'], 4);
  assert.equal(byEvent['LOOKUP.CREATED'], 6);
  assert.equal(byEvent['COMPONENT.CREATED'], 9);
  assert.equal(byEvent['SETTING.CHANGED'], 8);
  assert.equal(byEvent['USER.CREATED'], 2);
  assert.equal(byEvent['USER.DEACTIVATED'], 1);
  const loc = env.plain(env.g('Repository').all('locations'))[0];
  const forLoc = rows.filter((r) => r.entity_id === loc.id);
  assert.equal(forLoc.length, 1);
  assert.equal(forLoc[0].entity, 'locations');
  assert.deepEqual(JSON.parse(forLoc[0].detail).source, 'SEED');
  assert.equal(forLoc[0].user_id, env.users.admin.id);
  const retired = env.plain(env.g('Repository').all('users')).find((u) => u.display_name === 'Pat Retired');
  assert.deepEqual(rows.filter((r) => r.entity_id === retired.id).map((r) => r.event).sort(), ['USER.CREATED', 'USER.DEACTIVATED']);
  assert.equal(env.call('audit.list', { filters: { entity: 'locations' } }, env.admin).data.length, 4);
  assert.equal(env.call('history.get', { entity: 'users', id: retired.id }, env.admin).data.length, 1);
});

test('a dry run writes no audit rows and a second run writes none for existing records', () => {
  const env = seedEnv();
  const before = env.plain(env.g('Repository').all('audit_log')).length;
  env.call('seed.run', { dry_run: true }, env.admin);
  assert.equal(env.plain(env.g('Repository').all('audit_log')).length, before);
  env.call('seed.run', {}, env.admin);
  const after = env.plain(env.g('Repository').all('audit_log')).length;
  env.call('seed.run', {}, env.admin);
  assert.equal(env.plain(env.g('Repository').all('audit_log')).length, after + 1, 'only the SEED.RUN row');
});
