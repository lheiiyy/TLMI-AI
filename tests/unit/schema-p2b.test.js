'use strict';
// Part 2B, Task 8: the Team Leader tables, the settings definitions and the seed additions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');
const { setupDb } = require('../helpers/db');
const { fillTab } = require('../helpers/sheets');
const F = require('../fixtures/legacy-copy');

const NEW_TABLES = ['persons', 'person_aliases', 'tl_enrollments', 'assessments', 'tl_extensions', 'tl_certifying_officers', 'status_history', 'import_rows'];

test('every new table has id first and profile columns last', () => {
  const env = setupDb({ tables: false });
  const S = env.g('Schema');
  for (const name of NEW_TABLES) {
    const cols = env.plain(S.columns(name));
    const def = S.table(name);
    assert.equal(cols[0], 'id', name);
    const prof = env.plain(S.profileColumns(def));
    assert.deepEqual(cols.slice(cols.length - prof.length), prof, name);
    assert.deepEqual(cols.slice(1, cols.length - prof.length), Object.keys(def.fields), name);
  }
  const prefixes = Object.fromEntries(NEW_TABLES.map((n) => [n, [env.g('Schema').table(n).idPrefix, env.g('Schema').table(n).idWidth]]));
  assert.deepEqual(prefixes, {
    persons: ['PER-', 6], person_aliases: ['PAL-', 6], tl_enrollments: ['TLE-', 4], assessments: ['ASM-', 6],
    tl_extensions: ['TLX-', 6], tl_certifying_officers: ['TLO-', 6], status_history: ['HIS-', 6], import_rows: ['IMR-', 6],
  });
  assert.equal(S.table('tl_enrollments').idYear, true);
  assert.equal(S.table('assessments').idYear, true);
  assert.equal(S.table('status_history').appendOnly, true);
});

test('the Team Leader status and open-status lists are exported', () => {
  const env = setupDb({ tables: false });
  assert.deepEqual(env.plain(env.g('Schema').TL_STATUSES),
    ['Entry', 'Probationary', 'Certification check', 'Certified', 'Extended', 'Failed', 'Quit', 'Promoted']);
  assert.deepEqual(env.plain(env.g('Schema').TL_OPEN_STATUSES), ['Entry', 'Probationary', 'Certification check', 'Extended']);
});

test('status_history and record_history ids never repeat across both tables', () => {
  const env = setupDb();
  const ids = env.g('Repository').transact((uow) => {
    const out = [];
    out.push(uow.append('status_history', { entity: 'tl_enrollments', entity_id: 'TLE-2026-0001', from_status: '', to_status: 'Entry', effective_date: '2026-10-20' }, env.actor).id);
    out.push(uow.append('record_history', { entity: 'users', entity_id: 'USR-0001', field: 'role', old_value: 'a', new_value: 'b' }, env.actor).id);
    out.push(uow.append('status_history', { entity: 'tl_enrollments', entity_id: 'TLE-2026-0001', from_status: 'Entry', to_status: 'Probationary', effective_date: '2026-10-20' }, env.actor).id);
    return out;
  });
  assert.deepEqual(env.plain(ids), ['HIS-000001', 'HIS-000002', 'HIS-000003']);
  const counters = env.plain(env.g('Repository').all('id_counters')).filter((c) => c.prefix === 'HIS-');
  assert.equal(counters.length, 1);
  assert.equal(counters[0].last_value, 3);
});

test('TLE id takes the year of the entry date', () => {
  const env = setupDb();
  const make = (entry, year) => env.g('Repository').transact((uow) => uow.insert('tl_enrollments', {
    person_id: 'PER-000001', mother_location_id: 'LOC-0001', station_id: 'STN-0001', entry_date: entry, deadline: entry, status: 'Entry',
  }, env.actor, year)).id;
  assert.equal(make('2025-11-30', 2025), 'TLE-2025-0001');
  assert.equal(make('2026-01-05', 2026), 'TLE-2026-0001');
  assert.equal(make('2025-12-01', 2025), 'TLE-2025-0002');
  const a = env.g('Repository').transact((uow) => uow.append('assessments', {
    subject_type: 'TL_ENROLLMENT', subject_id: 'TLE-2025-0001', component_id: 'CMP-0001', score: 88.5, assessed_on: '2025-12-02', retake_no: 0,
  }, env.actor, 2025));
  assert.equal(a.id, 'ASM-2025-000001');
});

test('an invalid status or subject type is refused', () => {
  const env = setupDb();
  assert.throws(() => env.g('Repository').transact((uow) => uow.insert('tl_enrollments', {
    person_id: 'P', mother_location_id: 'L', station_id: 'S', entry_date: '2026-10-20', deadline: '2026-10-20', status: 'Done',
  }, env.actor)), (e) => e.code === 'VALIDATION' && e.fields[0].path === 'status');
  assert.throws(() => env.g('Repository').transact((uow) => uow.append('assessments', {
    subject_type: 'OTHER', subject_id: 'x', component_id: 'y', score: 1, assessed_on: '2026-10-20', retake_no: 0,
  }, env.actor)), (e) => e.code === 'VALIDATION');
});

test('a score outside 0 to 100 is refused by the schema', () => {
  const env = setupDb();
  const put = (score) => env.g('Repository').transact((uow) => uow.append('assessments', {
    subject_type: 'TL_ENROLLMENT', subject_id: 'x', component_id: 'y', score, assessed_on: '2026-10-20', retake_no: 0,
  }, env.actor));
  assert.throws(() => put(100.5), (e) => e.code === 'VALIDATION' && e.fields[0].path === 'score');
  assert.throws(() => put(-1), (e) => e.code === 'VALIDATION');
  assert.doesNotThrow(() => put(100));
});

test('CFG-047 can be set by Admin and is not seeded', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const before = env.call('settings.list', {}, admin).data.find((s) => s.setting_key === 'CFG-047');
  assert.ok(before, 'CFG-047 is defined');
  assert.equal(before.value, null);
  assert.equal(before.group, 'Team Leader');
  const set = env.call('settings.set', { setting_key: 'CFG-047', value: '2', reason: 'Decided' }, admin);
  assert.equal(set.ok, true, JSON.stringify(set));
  assert.equal(env.g('SettingsService').require('CFG-047'), 2);
  assert.equal(env.call('settings.set', { setting_key: 'CFG-047', value: '11', reason: 'Too many', supersedes_id: set.data.id }, admin).error.code, 'VALIDATION');
  assert.equal(env.call('settings.set', { setting_key: 'CFG-047', value: '0', reason: 'Too few', supersedes_id: set.data.id }, admin).error.code, 'VALIDATION');
});

test('the CFG-002 label no longer says PIN, and TLMI-001 is defined as an int from 1 to 100', () => {
  const env = setupDb({ tables: false });
  const defs = env.plain(env.g('SettingsService').SETTING_DEFS);
  assert.equal(defs['CFG-002'].label, 'Wrong passwords before a pause');
  assert.deepEqual(defs['TLMI-001'], { label: 'TL course program pass mark', group: 'Team Leader', value_type: 'int', min: 1, max: 100 });
  assert.deepEqual(defs['CFG-047'], { label: 'Extension limit (number of extensions)', group: 'Team Leader', value_type: 'int', min: 1, max: 10 });
});

function withLegacy() {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(F.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', F.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', F.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', F.LEGACY_ID);
  env.admin = env.signIn('admin');
  env.rows = (t) => env.plain(env.g('Repository').all(t));
  return env;
}

test('TLMI-001 is seeded as 90; CFG-047 is not seeded', () => {
  const env = withLegacy();
  assert.equal(env.call('seed.run', {}, env.admin).ok, true);
  const st = Object.fromEntries(env.rows('settings').map((s) => [s.setting_key, s.value]));
  assert.equal(st['TLMI-001'], '90');
  assert.ok(!('CFG-047' in st));
  const course = env.rows('assessment_components').find((c) => c.name === 'TL course program');
  assert.deepEqual([course.stage, course.required], ['certification', true]);
});

test('a seed run on a Phase 1 database adds the TL course program component and TLMI-001 only, and keeps a TLMI-001 value Admin already set', () => {
  const env = withLegacy();
  env.call('seed.run', {}, env.admin);
  // Make the database look like Phase 1: remove the component and the setting, then let Admin set another TLMI-001 value.
  const R = env.g('Repository');
  const sheet = env.sheet('assessment_components');
  const settings = env.sheet('settings');
  const find = (sh, col, val) => { const v = sh.getDataRange().getValues(); return v.findIndex((r, i) => i > 0 && r[col] === val) + 1; };
  sheet.deleteRows(find(sheet, 1, 'TL course program'), 1);
  settings.deleteRows(find(settings, 1, 'TLMI-001'), 1);
  const second = env.call('seed.run', {}, env.admin);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(env.plain(second.data.created), { brands: 0, regions: 0, lookups: 0, stations: 0, assessment_components: 1, settings: 1, locations: 0, users: 0 });
  // Now Admin changes TLMI-001; another seed run keeps it.
  const cur = env.rows('settings').find((s) => s.setting_key === 'TLMI-001');
  env.call('settings.set', { setting_key: 'TLMI-001', value: '92', supersedes_id: cur.id, reason: 'Raised' }, env.admin);
  const third = env.call('seed.run', {}, env.admin);
  assert.equal(third.data.created.settings, 0);
  assert.equal(env.g('SettingsService').require('TLMI-001'), 92);
  assert.equal(R.all('assessment_components').filter((c) => c.name === 'TL course program').length, 1);
});

test('import_batches accepts LEGACY_TL and the four new statuses', () => {
  const env = setupDb();
  for (const status of ['Validated', 'Committing', 'Committed', 'Superseded']) {
    assert.doesNotThrow(() => env.g('Repository').transact((uow) => uow.insert('import_batches', { kind: 'LEGACY_TL', status }, env.actor)), status);
  }
  assert.throws(() => env.g('Repository').transact((uow) => uow.insert('import_batches', { kind: 'OTHER', status: 'Done' }, env.actor)), (e) => e.code === 'VALIDATION');
});
