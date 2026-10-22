'use strict';
// Part 2B, Task 8: the Team Leader tables, the year in IDs, the shared history counter, and the new settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');
const { setupDb } = require('../helpers/db');
const { fillTab } = require('../helpers/sheets');
const F = require('../fixtures/legacy-copy');

const NEW_TABLES = ['persons', 'person_aliases', 'tl_enrollments', 'assessments', 'tl_extensions', 'tl_certifying_officers', 'status_history', 'import_rows'];

test('the eight new tables exist with the exact prefixes, profiles and years of spec section 5', () => {
  const env = setupDb({ tables: false });
  const S = env.g('Schema');
  const expect = {
    persons: ['PER-', 6, 'MUT', false], person_aliases: ['PAL-', 6, 'APP', false], tl_enrollments: ['TLE-', 4, 'MUT', true],
    assessments: ['ASM-', 6, 'APP', true], tl_extensions: ['TLX-', 6, 'APP', false], tl_certifying_officers: ['TLO-', 6, 'APP', false],
    status_history: ['HIS-', 6, 'APP', false], import_rows: ['IMR-', 6, 'MUT', false],
  };
  for (const name of NEW_TABLES) {
    const d = env.plain(S.table(name));
    assert.deepEqual([d.idPrefix, d.idWidth, d.profile, !!d.idYear], expect[name], name);
    const cols = env.plain(S.columns(name));
    assert.equal(cols[0], 'id');
  }
  assert.deepEqual(env.plain(S.TL_STATUSES), ['Entry', 'Probationary', 'Certification check', 'Certified', 'Extended', 'Failed', 'Quit', 'Promoted']);
  assert.deepEqual(env.plain(S.TL_OPEN_STATUSES), ['Entry', 'Probationary', 'Certification check', 'Extended']);
  const stamp = env.plain(S.table('status_history').stamp);
  assert.deepEqual(stamp, { at: 'at', by: 'user_id' });
});

test('setup creates the new tabs on a database that has only the Phase 1 tabs', () => {
  const env = setupDb({ tables: false });
  env.g('Repository').ensureTables();
  const again = env.plain(env.g('Repository').ensureTables());
  assert.deepEqual(again, []);
  for (const t of NEW_TABLES) assert.ok(env.sheet(t), t);
});

test('status_history and record_history ids never repeat across both tables', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const ids = [];
  R.transact((uow) => {
    ids.push(uow.append('record_history', { entity: 'users', entity_id: 'USR-0001', field: 'role', old_value: 'a', new_value: 'b' }, env.actor).id);
    ids.push(uow.append('status_history', { entity: 'tl_enrollments', entity_id: 'TLE-2026-0001', to_status: 'Entry', effective_date: '2026-10-20' }, env.actor).id);
    ids.push(uow.append('record_history', { entity: 'users', entity_id: 'USR-0001', field: 'role', old_value: 'b', new_value: 'c' }, env.actor).id);
  });
  R.transact((uow) => {
    ids.push(uow.append('status_history', { entity: 'tl_enrollments', entity_id: 'TLE-2026-0001', from_status: 'Entry', to_status: 'Probationary', effective_date: '2026-10-21' }, env.actor).id);
  });
  assert.deepEqual(ids, ['HIS-000001', 'HIS-000002', 'HIS-000003', 'HIS-000004']);
  assert.equal(new Set(ids).size, ids.length);
});

test('a TLE or ASM id takes the year of the record\'s own date, and each year counts on its own', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const enrol = (year) => R.transact((uow) => uow.insert('tl_enrollments', {
    person_id: 'PER-000001', mother_location_id: 'LOC-0001', entry_date: year + '-03-01', deadline: year + '-06-01', status: 'Entry',
  }, env.actor, year).id);
  assert.equal(enrol(2025), 'TLE-2025-0001');
  assert.equal(enrol(2026), 'TLE-2026-0001');
  assert.equal(enrol(2025), 'TLE-2025-0002');
  const grade = (year) => R.transact((uow) => uow.append('assessments', {
    subject_type: 'TL_ENROLLMENT', subject_id: 'TLE-2025-0001', component_id: 'CMP-0001', score: 90, assessed_on: year + '-03-02', retake_no: 0,
  }, env.actor, year).id);
  assert.equal(grade(2025), 'ASM-2025-000001');
  assert.equal(grade(2025), 'ASM-2025-000002');
  assert.equal(grade(2024), 'ASM-2024-000001');
  // with no year given, the current year of the clock is used
  const current = R.transact((uow) => uow.insert('tl_enrollments', {
    person_id: 'PER-000001', mother_location_id: 'LOC-0001', entry_date: '2026-10-20', deadline: '2027-01-20', status: 'Entry',
  }, env.actor).id);
  assert.match(current, /^TLE-2026-0002$/);
});

test('a score is a number from 0 to 100 with at most two decimals, and a status is one of the eight', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const grade = (score) => R.transact((uow) => uow.append('assessments', {
    subject_type: 'TL_ENROLLMENT', subject_id: 'TLE-2026-0001', component_id: 'CMP-0001', score: score, assessed_on: '2026-10-20', retake_no: 0,
  }, env.actor));
  for (const bad of [-1, 100.01, 85.123]) {
    assert.throws(() => grade(bad), (e) => e.code === 'VALIDATION' && ['RANGE', 'DECIMALS'].includes(e.fields[0].code), String(bad));
  }
  for (const good of [0, 100, 85.5, 84.99]) assert.doesNotThrow(() => grade(good), String(good));
  assert.throws(() => R.transact((uow) => uow.insert('tl_enrollments', {
    person_id: 'P', mother_location_id: 'L', entry_date: '2026-10-20', deadline: '2027-01-20', status: 'Disqualified',
  }, env.actor)), (e) => e.fields[0].path === 'status');
});

test('import_batches accepts the legacy kind and the new statuses', () => {
  const env = setupDb();
  const R = env.g('Repository');
  for (const status of ['Validated', 'Committing', 'Committed', 'Superseded']) {
    assert.doesNotThrow(() => R.transact((uow) => uow.insert('import_batches', { kind: 'LEGACY_TL', status: status }, env.actor)), status);
  }
  assert.throws(() => R.transact((uow) => uow.insert('import_batches', { kind: 'OTHER', status: 'Done' }, env.actor)));
});

test('CFG-047 can be set by Admin and is not seeded; TLMI-001 is seeded as 90', () => {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(F.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', F.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', F.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', F.LEGACY_ID);
  const admin = env.signIn('admin');
  assert.equal(env.call('seed.run', {}, admin).ok, true);
  const rows = env.plain(env.g('Repository').all('settings'));
  assert.ok(!rows.some((r) => r.setting_key === 'CFG-047'));
  assert.equal(rows.find((r) => r.setting_key === 'TLMI-001').value, '90');
  const listed = env.call('settings.list', {}, admin).data;
  assert.equal(listed.find((s) => s.setting_key === 'CFG-047').value, null);
  assert.equal(listed.find((s) => s.setting_key === 'CFG-002').label, 'Wrong passwords before a pause');
  const set = env.call('settings.set', { setting_key: 'CFG-047', value: '2', reason: 'Decided by Leo' }, admin);
  assert.equal(set.ok, true, JSON.stringify(set));
  assert.equal(env.g('SettingsService').require('CFG-047'), 2);
  assert.equal(env.g('SettingsService').require('TLMI-001'), 90);
});

test('a seed run on a Phase 1 database adds the TL course program component and TLMI-001 only, and keeps a value Admin set', () => {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(F.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', F.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', F.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', F.LEGACY_ID);
  const admin = env.signIn('admin');
  assert.equal(env.call('seed.run', {}, admin).ok, true);
  // Make the database look like a Phase 1 one: no course component, no TLMI-001 row.
  const R = env.g('Repository');
  const sheet = (t) => env.sheet(t);
  const delRow = (t, match) => {
    const cols = env.plain(env.g('Schema').columns(t));
    const data = sheet(t).getDataRange().getValues();
    const at = data.findIndex((r, i) => i > 0 && match(Object.fromEntries(cols.map((c, j) => [c, r[j]]))));
    sheet(t).deleteRows(at + 1, 1);
  };
  delRow('assessment_components', (r) => r.name === 'TL course program');
  delRow('settings', (r) => r.setting_key === 'TLMI-001');
  assert.equal(env.call('settings.set', { setting_key: 'TLMI-001', value: '88', reason: 'Admin choice' }, admin).ok, true);
  const again = env.call('seed.run', {}, admin).data;
  assert.equal(again.created.assessment_components, 1);
  assert.equal(again.created.settings, 0, 'TLMI-001 was set by Admin, so it is kept');
  const total = Object.entries(again.created).filter(([k, n]) => n > 0).map(([k]) => k);
  assert.deepEqual(total, ['assessment_components']);
  assert.equal(env.plain(R.all('settings')).filter((r) => r.setting_key === 'TLMI-001').length, 1);
  assert.equal(env.g('SettingsService').require('TLMI-001'), 88);
  // and with no TLMI-001 row at all, the seed adds it
  delRow('settings', (r) => r.setting_key === 'TLMI-001');
  const third = env.call('seed.run', {}, admin).data;
  assert.equal(third.created.settings, 1);
  assert.equal(env.g('SettingsService').require('TLMI-001'), 90);
});

test('the validator checks min, max and decimals', () => {
  const env = setupDb({ tables: false });
  const V = env.g('Validator');
  const def = { name: 'x', fields: { n: { type: 'int', min: 1, max: 5 }, d: { type: 'number', min: 0, max: 100, decimals: 2 } } };
  const run = (o) => V.clean(def, o, 'create');
  assert.deepEqual(env.plain(run({ n: 5, d: 99.99 })), { n: 5, d: 99.99 });
  assert.throws(() => run({ n: 0 }), (e) => e.fields[0].code === 'RANGE');
  assert.throws(() => run({ n: 6 }), (e) => e.fields[0].code === 'RANGE');
  assert.throws(() => run({ d: 100.5 }), (e) => e.fields[0].code === 'RANGE');
  assert.throws(() => run({ d: 1.005 }), (e) => e.fields[0].code === 'DECIMALS');
  assert.doesNotThrow(() => run({ d: 84.99 }));
});

test('the validator checks a list of text values and its number of items', () => {
  const env = setupDb({ tables: false });
  const V = env.g('Validator');
  const def = { name: 'x', fields: { ids: { type: 'array', min: 1, max: 3 } } };
  const run = (o) => env.plain(V.clean(def, o, 'create'));
  assert.deepEqual(run({ ids: [' a ', 'b'] }), { ids: ['a', 'b'] });
  assert.throws(() => run({ ids: [] }), (e) => e.fields[0].code === 'RANGE');
  assert.throws(() => run({ ids: ['a', 'b', 'c', 'd'] }), (e) => e.fields[0].code === 'RANGE');
  assert.throws(() => run({ ids: 'a' }), (e) => e.fields[0].code === 'TYPE');
  assert.throws(() => run({ ids: [1] }), (e) => e.fields[0].code === 'TYPE');
});
