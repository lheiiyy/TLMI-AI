'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

function ok(env, token, method, params) {
  const r = env.call(method, params, token);
  assert.equal(r.ok, true, method + ' -> ' + JSON.stringify(r));
  return r.data;
}

function seedBasics(env, token) {
  const brand = ok(env, token, 'brands.create', { name: "Test Pizza", code: 'TP' });
  const region = ok(env, token, 'regions.create', { name: 'North Test' });
  ok(env, token, 'lookups.create', { category: 'location_type', value: 'Store', label: 'Store', sort_order: 1 });
  return { brand, region };
}

test('create then list a brand', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const b = ok(env, t, 'brands.create', { name: 'Test Pizza', code: 'TP' });
  assert.equal(b.id, 'BRD-0001');
  assert.equal(b.row_version, 1);
  const list = env.call('brands.list', {}, t);
  assert.equal(list.data.length, 1);
  assert.deepEqual(list.meta.page, { page: 1, page_size: 25, total: 1 });
  assert.equal(env.call('brands.get', { id: b.id }, t).data.code, 'TP');
  assert.equal(env.call('brands.get', { id: 'BRD-0099' }, t).error.code, 'NOT_FOUND');
});

test('brand code cannot change', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const b = ok(env, t, 'brands.create', { name: 'Test Pizza', code: 'TP' });
  const r = env.call('brands.update', { id: b.id, row_version: 1, patch: { code: 'XX' } }, t);
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].code, 'IMMUTABLE');
  assert.equal(ok(env, t, 'brands.update', { id: b.id, row_version: 1, patch: { name: 'Test Pizza 2' } }).name, 'Test Pizza 2');
});

test('duplicate location name differing by case and space is VALIDATION', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const { brand, region } = seedBasics(env, t);
  const mk = (name) => env.call('locations.create', { name, location_type: 'Store', brand_id: brand.id, region_id: region.id }, t);
  assert.equal(mk('Doña  Soledad').ok, true);
  const dup = mk('  doña soledad ');
  assert.equal(dup.error.code, 'VALIDATION');
  assert.equal(dup.error.fields[0].code, 'DUPLICATE');
  assert.equal(mk('Other Store').ok, true);
});

test('location with an inactive region is VALIDATION', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const { brand, region } = seedBasics(env, t);
  ok(env, t, 'regions.deactivate', { id: region.id, row_version: 1 });
  const r = env.call('locations.create', { name: 'A', location_type: 'Store', brand_id: brand.id, region_id: region.id }, t);
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].path, 'region_id');
  assert.equal(r.error.fields[0].code, 'LINK');
  assert.equal(env.call('locations.create', { name: 'A', location_type: 'Store', brand_id: 'BRD-0099' }, t).error.fields[0].path, 'brand_id');
  assert.equal(env.call('locations.create', { name: 'A', location_type: 'Kiosk', brand_id: brand.id }, t).error.fields[0].path, 'location_type');
  assert.equal(env.call('locations.create', { name: 'A', location_type: 'Store', brand_id: brand.id }, t).ok, true);
  assert.equal(env.call('stations.create', { name: 'Food Prep', brand_id: 'BRD-0099' }, t).error.code, 'VALIDATION');
});

test('system lookup Store cannot be disabled or renamed', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  env.g('Repository').transact((uow) => uow.insert('lookups', { category: 'location_type', value: 'Store', label: 'Store', sort_order: 1, is_system: true }, env.actor));
  const id = env.call('lookups.list', {}, t).data[0].id;
  const off = env.call('lookups.deactivate', { id, row_version: 1 }, t);
  assert.equal(off.error.code, 'VALIDATION');
  assert.equal(off.error.fields[0].code, 'SYSTEM_VALUE');
  assert.equal(env.call('lookups.update', { id, row_version: 1, patch: { label: 'Shop' } }, t).error.fields[0].code, 'SYSTEM_VALUE');
  assert.equal(ok(env, t, 'lookups.update', { id, row_version: 1, patch: { sort_order: 5 } }).sort_order, 5);
  assert.equal(env.call('lookups.get', { id }, t).data.is_active, true);
  assert.equal(env.call('lookups.create', { category: 'x', value: 'y', label: 'y', is_system: true }, t).error.fields[0].code, 'UNKNOWN_FIELD');
});

test('update writes one record_history row per changed field and one audit row', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const { brand, region } = seedBasics(env, t);
  const region2 = ok(env, t, 'regions.create', { name: 'South Test' });
  const loc = ok(env, t, 'locations.create', { name: 'Alpha', location_type: 'Store', brand_id: brand.id, region_id: region.id });
  const upd = ok(env, t, 'locations.update', { id: loc.id, row_version: 1, patch: { name: 'Alpha 2', region_id: region2.id } });
  assert.equal(upd.row_version, 2);
  const hist = env.call('history.get', { entity: 'locations', id: loc.id }, t).data;
  assert.deepEqual(hist.map((h) => [h.field, h.old_value, h.new_value]).sort(),
    [['name', 'Alpha', 'Alpha 2'], ['region_id', region.id, region2.id]]);
  assert.equal(env.auditRows().filter((r) => r.event === 'LOCATION.UPDATED' && r.entity_id === loc.id).length, 1);
  // a patch that changes nothing writes nothing
  const before = env.auditRows().length;
  ok(env, t, 'locations.update', { id: loc.id, row_version: 2, patch: { name: 'Alpha 2' } });
  assert.equal(env.auditRows().length, before + 0);
});

test('stale row_version is CONFLICT with current, and audited', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const { region } = seedBasics(env, t);
  ok(env, t, 'regions.update', { id: region.id, row_version: 1, patch: { name: 'North 2' } });
  const r = env.call('regions.update', { id: region.id, row_version: 1, patch: { name: 'North 3' } }, t);
  assert.equal(r.error.code, 'CONFLICT');
  assert.equal(r.error.current.row_version, 2);
  assert.equal(r.error.current.updated_by_name, 'Ada Admin');
  assert.equal(env.call('regions.get', { id: region.id }, t).data.name, 'North 2');
  const row = env.auditRows().find((a) => a.event === 'API.CONFLICT');
  assert.ok(row);
  assert.equal(row.result, 'FAILED');
  assert.equal(row.entity_id, region.id);
});

test('deactivate and reactivate change is_active only and keep history', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const { region } = seedBasics(env, t);
  const off = ok(env, t, 'regions.deactivate', { id: region.id, row_version: 1 });
  assert.equal(off.is_active, false);
  assert.equal(off.name, 'North Test');
  assert.equal(off.row_version, 2);
  const on = ok(env, t, 'regions.reactivate', { id: region.id, row_version: 2 });
  assert.equal(on.is_active, true);
  assert.deepEqual(env.call('history.get', { entity: 'regions', id: region.id }, t).data.map((h) => [h.field, h.new_value]), [['is_active', 'false'], ['is_active', 'true']]);
  const events = env.auditRows().map((a) => a.event);
  assert.ok(events.includes('MASTER.REGION.DEACTIVATED') && events.includes('MASTER.REGION.REACTIVATED'));
  // deactivating twice is a no-op
  assert.equal(ok(env, t, 'regions.reactivate', { id: region.id, row_version: 3 }).row_version, 3);
});

test('Training Officer calling brands.create is FORBIDDEN, reading is allowed', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  seedBasics(env, admin);
  const t = env.signIn('officer');
  const r = env.call('brands.create', { name: 'X', code: 'X' }, t);
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.equal(env.call('brands.list', {}, t).ok, true);
  assert.equal(env.call('lookups.list', {}, t).ok, true);
  assert.equal(env.call('components.list', {}, t).error.code, 'FORBIDDEN');
  assert.equal(env.call('locations.update', { id: 'LOC-0001', row_version: 1, patch: {} }, t).error.code, 'FORBIDDEN');
  assert.equal(env.call('brands.list', {}, env.signIn('senior')).ok, true);
});

test('lists filter, search, sort and page', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  for (const n of ['Bravo', 'alpha', 'Charlie', 'Delta']) ok(env, t, 'regions.create', { name: n });
  ok(env, t, 'regions.deactivate', { id: 'REG-0004', row_version: 1 });
  const names = (p) => env.call('regions.list', p, t).data.map((r) => r.name);
  assert.deepEqual(names({}), ['alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(names({ sort: '-name' }), ['Delta', 'Charlie', 'Bravo', 'alpha']);
  assert.deepEqual(names({ filters: { is_active: true } }), ['alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(names({ q: 'LPH' }), ['alpha']);
  const p2 = env.call('regions.list', { page_size: 2, page: 2 }, t);
  assert.deepEqual(p2.data.map((r) => r.name), ['Charlie', 'Delta']);
  assert.deepEqual(p2.meta.page, { page: 2, page_size: 2, total: 4 });
  assert.equal(env.call('regions.list', { filters: { bogus: 1 } }, t).error.code, 'VALIDATION');
  assert.equal(env.call('regions.list', { page_size: 51 }, t).error.code, 'VALIDATION');
  assert.equal(env.call('regions.list', { sort: 'password' }, t).error.code, 'VALIDATION');
});

test('components: Admin lists and updates, the stage cannot change', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  env.g('Repository').transact((uow) => uow.insert('assessment_components', { name: 'Checklist', stage: 'certification', required: true }, env.actor));
  const c = ok(env, t, 'components.list', {})[0];
  assert.equal(c.stage, 'certification');
  assert.equal(ok(env, t, 'components.update', { id: c.id, row_version: 1, patch: { name: 'Checklist grade' } }).name, 'Checklist grade');
  assert.equal(env.call('components.update', { id: c.id, row_version: 2, patch: { stage: 'entry' } }, t).error.fields[0].code, 'IMMUTABLE');
  assert.ok(env.auditRows().some((a) => a.event === 'COMPONENT.UPDATED'));
  assert.equal(typeof env.g('Api').registry()['components.create'], 'undefined');
});

test('invalid values are VALIDATION and write nothing', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const before = env.auditRows().length;
  assert.equal(env.call('brands.create', { name: '', code: 'A' }, t).error.code, 'VALIDATION');
  assert.equal(env.call('brands.create', { name: 'A' }, t).error.code, 'VALIDATION');
  assert.equal(env.call('brands.create', { name: 'A', code: 'A', extra: 1 }, t).error.code, 'VALIDATION');
  assert.equal(env.call('brands.update', { id: 'BRD-0001', row_version: 1, patch: null }, t).error.code, 'VALIDATION');
  assert.equal(env.call('brands.list', {}, t).data.length, 0);
  assert.equal(env.auditRows().length, before);
});
