'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');
const { fillTab } = require('../helpers/sheets');
const F = require('../fixtures/legacy-copy');

function withLegacy(opts = {}) {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(F.LEGACY_ID, 'legacy copy');
  if (opts.settings !== false) fillTab(ss, 'SETTINGS', opts.settings || F.SETTINGS);
  if (opts.officers !== false) fillTab(ss, 'SEED_OFFICERS', opts.officers || F.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', F.LEGACY_ID);
  env.admin = env.signIn('admin');
  env.seed = (p) => env.call('seed.run', p || {}, env.admin);
  env.rows = (t) => env.plain(env.g('Repository').all(t));
  return env;
}

test('seed creates the master lists', () => {
  const env = withLegacy();
  const res = env.seed();
  assert.equal(res.ok, true, JSON.stringify(res));
  const d = res.data;
  assert.equal(d.dry_run, false);
  assert.match(d.batch_id, /^IMP-\d{4}$/);
  assert.equal(env.rows('brands').length, 1);
  assert.deepEqual([env.rows('brands')[0].name, env.rows('brands')[0].code], ["Angel's Pizza", 'AP']);
  assert.deepEqual(env.rows('regions').map((r) => r.name).sort(), ['Cebu Test', 'NCR']);
  assert.deepEqual(env.rows('stations').map((s) => s.name), ['Food Prep', 'Pizza Maker', 'Cashier', 'Service', 'Commis', 'Dough Maker']);
  assert.ok(env.rows('stations').every((s) => s.brand_id === 'BRD-0001'));
  const lk = env.rows('lookups');
  assert.deepEqual(lk.filter((l) => l.category === 'location_type').map((l) => l.value), ['Store', 'Commissary', 'Office', 'Call Center', 'Warehouse']);
  assert.equal(lk.find((l) => l.value === 'Store').is_system, true);
  assert.equal(lk.find((l) => l.value === 'Commissary').is_system, false);
  assert.deepEqual(lk.filter((l) => l.category === 'tl_close_reason').map((l) => l.value), ['Disqualified']);
  const cmp = env.rows('assessment_components');
  assert.equal(cmp.length, 9);
  assert.deepEqual(cmp.filter((c) => c.stage === 'entry').map((c) => c.name),
    ['ISTV', 'Tech Val Food Prep', 'Tech Val Pizza Maker', 'TL entry exam Food Prep', 'TL entry exam Pizza Maker']);
  assert.ok(cmp.filter((c) => c.stage === 'entry').every((c) => c.required));
  assert.deepEqual(cmp.filter((c) => c.stage === 'certification').map((c) => [c.name, c.required]),
    [['Checklist', true], ['Exam', true], ['Kitchen feedback', false], ['Manager feedback', false]]);
  assert.ok(cmp.every((c) => c.weight === null));
  const st = Object.fromEntries(env.rows('settings').map((s) => [s.setting_key, s.value]));
  assert.deepEqual(st, { 'CFG-001': '30', 'CFG-002': '5', 'CFG-003': '15', 'CFG-040': '3', 'CFG-041': '85', 'CFG-042': '30', 'CFG-044': '30/40/30', 'CFG-045': '60/40' });
  assert.ok(env.rows('settings').every((s) => s.version === 1 && s.effective_from === '2026-10-20' && s.reason === 'Initial seed'));
  const locs = env.rows('locations');
  assert.deepEqual(locs.map((l) => l.name), ['TEST STORE ONE', 'DOÑA TEST', 'SECOND TEST STORE', 'PROVINCIAL TEST']);
  assert.ok(locs.every((l) => l.location_type === 'Store' && l.brand_id === 'BRD-0001' && l.region_id));
  assert.equal(d.created.brands, 1);
  assert.equal(d.created.locations, 4);
  assert.equal(d.created.settings, 8);
});

test('seeded settings are visible through settings.get and apply', () => {
  const env = withLegacy();
  env.seed();
  assert.equal(env.call('settings.get', { setting_key: 'CFG-041' }, env.admin).data.value, '85');
  assert.equal(env.g('SettingsService').require('CFG-041'), 85);
  assert.throws(() => env.g('SettingsService').require('CFG-047'), (e) => e.code === 'CONFIG_MISSING');
});

test('second run creates nothing', () => {
  const env = withLegacy();
  env.seed();
  const counts = () => ['brands', 'regions', 'locations', 'stations', 'lookups', 'assessment_components', 'settings', 'users'].map((t) => env.rows(t).length);
  const before = counts();
  const again = env.seed().data;
  assert.deepEqual(counts(), before);
  assert.ok(Object.values(again.created).every((n) => n === 0), JSON.stringify(again.created));
  assert.ok(again.skipped.length > 0);
});

test('dry_run writes nothing but reports counts', () => {
  const env = withLegacy();
  const dry = env.seed({ dry_run: true }).data;
  assert.equal(dry.dry_run, true);
  assert.equal(dry.batch_id, null);
  assert.equal(dry.created.locations, 4);
  assert.equal(dry.created.brands, 1);
  for (const t of ['brands', 'regions', 'locations', 'stations', 'lookups', 'assessment_components', 'settings', 'import_batches']) assert.equal(env.rows(t).length, 0, t);
  assert.equal(env.rows('users').length, 5);
  assert.equal(env.rows('audit_log').filter((r) => r.event === 'SEED.RUN').length, 0);
  const real = env.seed().data;
  assert.deepEqual(real.created, dry.created);
});

test('store with trailing space is trimmed and a tilde name is kept intact', () => {
  const env = withLegacy({ settings: [['DOÑA SOLEDAD ', 'NCR'], ['  Spaced   Out Store ', 'NCR ']] });
  env.seed();
  assert.deepEqual(env.rows('locations').map((l) => l.name), ['DOÑA SOLEDAD', 'Spaced Out Store']);
  assert.deepEqual(env.rows('regions').map((r) => r.name), ['NCR']);
  env.seed();
  assert.equal(env.rows('locations').length, 2);
});

test('duplicate store differing by case is skipped and listed', () => {
  const env = withLegacy();
  const d = env.seed().data;
  assert.equal(env.rows('locations').filter((l) => l.name.toLowerCase() === 'test store one').length, 1);
  const skip = d.skipped.find((s) => s.table === 'locations' && s.value === 'test store one');
  assert.ok(skip, JSON.stringify(d.skipped));
  assert.equal(skip.reason, 'DUPLICATE_IN_SOURCE');
  assert.equal(env.rows('locations')[0].name, 'TEST STORE ONE');
});

test('a store with a missing region is rejected and listed', () => {
  const env = withLegacy();
  const d = env.seed().data;
  assert.ok(d.rejected.some((r) => r.table === 'locations' && r.reason === 'REGION_MISSING' && r.row === 6));
  assert.ok(!env.rows('locations').some((l) => l.name === 'REGIONLESS STORE'));
  assert.ok(d.rejected.some((r) => r.table === 'locations' && r.row === 7 && r.reason === 'NAME_MISSING'));
});

test('CFG-047 is not seeded', () => {
  const env = withLegacy();
  env.seed();
  assert.ok(!env.rows('settings').some((s) => s.setting_key === 'CFG-047'));
});

test('officers get role from SEED_OFFICERS and an unknown role is rejected', () => {
  const env = withLegacy();
  const d = env.seed().data;
  const users = env.rows('users');
  const by = (n) => users.find((u) => u.display_name === n);
  assert.equal(by('Marco Sample').role, 'Training Officer');
  assert.equal(by('Marco Sample').hr_employee_no, '9002');
  assert.equal(users.filter((u) => u.display_name === 'Ada Admin').length, 1, 'an existing user is skipped, not duplicated');
  assert.equal(by('Pat Retired').is_active, false);
  assert.equal(by('Wrong Role'), undefined);
  assert.ok(d.rejected.some((r) => r.table === 'users' && r.reason === 'ROLE_UNKNOWN' && r.row === 6));
  assert.ok(d.rejected.some((r) => r.table === 'users' && r.reason === 'HR_NUMBER_DUPLICATE' && r.row === 7));
  assert.ok(d.skipped.some((s) => s.table === 'users' && s.value === 'olivia  tester'));
  assert.ok(users.every((u) => u.password_hash === '' && u.salt === ''));
  assert.equal(env.rows('users').filter((u) => u.display_name === 'Olivia Tester').length, 1);
});

test('import_batches has one row per real run', () => {
  const env = withLegacy();
  env.seed({ dry_run: true });
  assert.equal(env.rows('import_batches').length, 0);
  env.seed();
  env.seed();
  const b = env.rows('import_batches');
  assert.equal(b.length, 2);
  assert.ok(b.every((r) => r.kind === 'SEED' && r.status === 'Done'));
  assert.equal(b[0].source_row_count, 14);
  assert.equal(JSON.parse(b[0].counts).created.locations, 4);
  assert.equal(JSON.parse(b[1].counts).created.locations, 0);
  assert.equal(env.auditRows().filter((r) => r.event === 'SEED.RUN').length, 2);
  assert.ok(!JSON.stringify(b).includes(F.LEGACY_ID));
});

test('seed is Admin only and needs the legacy copy', () => {
  const env = withLegacy();
  for (const role of ['officer', 'supervisor', 'manager', 'senior']) assert.equal(env.call('seed.run', {}, env.signIn(role)).error.code, 'FORBIDDEN', role);
  env.g('Props').remove('LEGACY_COPY_ID');
  const r = env.seed();
  assert.equal(r.error.code, 'CONFIG_MISSING');
  assert.ok(r.error.message.includes('LEGACY_COPY_ID'));
  assert.equal(env.rows('brands').length, 0);
});

test('a missing source tab is NOT_FOUND and nothing is written', () => {
  const env = withLegacy({ officers: false });
  const r = env.seed();
  assert.equal(r.error.code, 'NOT_FOUND');
  assert.ok(r.error.message.includes('SEED_OFFICERS'));
  assert.ok(!JSON.stringify(r).includes(F.LEGACY_ID));
  assert.equal(env.rows('brands').length, 0);
  assert.equal(env.rows('import_batches').length, 0);
});

test('seeded rows pass through the same history and audit rules', () => {
  const env = withLegacy();
  env.seed();
  const ev = env.auditRows().find((r) => r.event === 'SEED.RUN');
  assert.ok(ev);
  assert.equal(ev.user_id, env.users.admin.id);
  assert.equal(env.rows('brands')[0].created_by, env.users.admin.id);
  // seeded master data is editable afterwards like any other
  const loc = env.rows('locations')[0];
  const r = env.call('locations.update', { id: loc.id, row_version: 1, patch: { name: 'TEST STORE 1' } }, env.admin);
  assert.equal(r.ok, true, JSON.stringify(r));
});
