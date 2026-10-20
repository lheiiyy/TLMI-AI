'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

function addBrand(env, name, code) {
  const R = env.g('Repository');
  return env.plain(R.transact((uow) => uow.insert('brands', { name, code }, env.actor)));
}

test('ensureTables creates tabs and headers and leaves existing tabs alone', () => {
  const env = setupDb({ tables: false });
  const ss = env.google.sheets.get('fake-db-id');
  const pre = ss.insertSheet('brands');
  pre.getRange(1, 1, 1, 2).setValues([['mine', 'untouched']]);
  const created = env.plain(env.g('Repository').ensureTables());
  assert.ok(!created.includes('brands'));
  assert.ok(created.includes('locations'));
  assert.deepEqual(pre.getRange(1, 1, 1, 2).getValues()[0], ['mine', 'untouched']);
  assert.deepEqual(env.sheet('locations').getRange(1, 1, 1, 8).getValues()[0],
    ['id', 'name', 'location_type', 'brand_id', 'region_id', 'created_at', 'created_by', 'updated_at']);
  assert.deepEqual(env.plain(env.g('Repository').ensureTables()), []);
});

test('insert allocates BRD-0001 then BRD-0002', () => {
  const env = setupDb();
  assert.equal(addBrand(env, "Angel's Pizza", 'AP').id, 'BRD-0001');
  assert.equal(addBrand(env, 'Other', 'OT').id, 'BRD-0002');
  const all = env.plain(env.g('Repository').all('brands'));
  assert.equal(all.length, 2);
  assert.equal(all[0].row_version, 1);
  assert.equal(all[0].is_active, true);
  assert.equal(all[0].created_by, 'USR-0001');
});

test('two inserts in one transaction get distinct ids', () => {
  const env = setupDb();
  const ids = env.plain(env.g('Repository').transact((uow) => [
    uow.insert('regions', { name: 'NCR' }, env.actor).id,
    uow.insert('regions', { name: 'Cebu' }, env.actor).id,
  ]));
  assert.deepEqual(ids, ['REG-0001', 'REG-0002']);
  assert.equal(env.plain(env.g('Repository').all('regions')).length, 2);
});

test('a transaction sees its own pending rows', () => {
  const env = setupDb();
  const seen = env.g('Repository').transact((uow) => {
    uow.insert('regions', { name: 'NCR' }, env.actor);
    return uow.all('regions').length + ':' + (uow.get('regions', 'REG-0001') ? 'yes' : 'no');
  });
  assert.equal(seen, '1:yes');
});

test('a text that looks like a date survives write and read', () => {
  const env = setupDb();
  env.g('Repository').transact((uow) => uow.insert('lookups',
    { category: 'test', value: '2026-04-21', label: '2026-04-21', sort_order: 1 }, env.actor));
  const row = env.plain(env.g('Repository').all('lookups'))[0];
  assert.equal(row.value, '2026-04-21');
  assert.equal(row.label, '2026-04-21');
  assert.equal(row.sort_order, 1);
});

test('a text with leading zeros survives', () => {
  const env = setupDb();
  env.g('Repository').transact((uow) => uow.insert('users',
    { display_name: 'Test One', role: 'Training Officer', hr_employee_no: '00123' }, env.actor));
  assert.equal(env.plain(env.g('Repository').all('users'))[0].hr_employee_no, '00123');
});

test('update with a stale row_version throws CONFLICT carrying current', () => {
  const env = setupDb();
  env.g('Repository').transact((uow) => uow.insert('users',
    { display_name: 'Test One', role: 'Admin' }, env.actor));
  const b = addBrand(env, 'A', 'AA');
  const R = env.g('Repository');
  const upd = (name, v) => R.transact((uow) => uow.update('brands', b.id, { name }, { expectedVersion: v, actor: env.actor }));
  upd('B', 1);
  assert.throws(() => upd('C', 1), (e) => {
    assert.equal(e.code, 'CONFLICT');
    assert.equal(e.current.row_version, 2);
    assert.equal(e.current.updated_by_name, 'Test One');
    assert.equal(e.current.updated_at, '2026-10-20T04:00:00.000Z');
    return true;
  });
  assert.equal(env.plain(R.get('brands', b.id)).name, 'B');
});

test('exactly one of two updates with the same row_version succeeds', () => {
  const env = setupDb();
  const b = addBrand(env, 'A', 'AA');
  const R = env.g('Repository');
  const results = [1, 2].map((n) => {
    try { R.transact((uow) => uow.update('brands', b.id, { name: 'N' + n }, { expectedVersion: 1, actor: env.actor })); return 'ok'; } catch (e) { return e.code; }
  });
  assert.deepEqual(results, ['ok', 'CONFLICT']);
});

test('update bumps row_version and updated_at and reports the change', () => {
  const env = setupDb();
  const b = addBrand(env, 'A', 'AA');
  env.google.clock.now += 60000;
  const out = env.plain(env.g('Repository').transact((uow) =>
    uow.update('brands', b.id, { name: 'A2' }, { expectedVersion: 1, actor: { userId: 'USR-0002', now: '2026-10-20T05:00:00.000Z' } })));
  assert.equal(out.before.name, 'A');
  assert.equal(out.after.name, 'A2');
  assert.deepEqual(out.changed, ['name']);
  assert.equal(out.after.row_version, 2);
  assert.equal(out.after.updated_by, 'USR-0002');
  assert.equal(out.after.updated_at, '2026-10-20T05:00:00.000Z');
  assert.equal(out.after.created_at, '2026-10-20T04:00:00.000Z');
});

test('an update that changes nothing writes nothing', () => {
  const env = setupDb();
  const b = addBrand(env, 'A', 'AA');
  const out = env.plain(env.g('Repository').transact((uow) =>
    uow.update('brands', b.id, { name: 'A' }, { expectedVersion: 1, actor: env.actor })));
  assert.deepEqual(out.changed, []);
  assert.equal(env.plain(env.g('Repository').get('brands', b.id)).row_version, 1);
});

test('update needs an expected version and an existing row', () => {
  const env = setupDb();
  const b = addBrand(env, 'A', 'AA');
  const R = env.g('Repository');
  assert.throws(() => R.transact((uow) => uow.update('brands', b.id, { name: 'x' }, { actor: env.actor })), (e) => e.code === 'VALIDATION');
  assert.throws(() => R.transact((uow) => uow.update('brands', 'BRD-9999', { name: 'x' }, { expectedVersion: 1, actor: env.actor })), (e) => e.code === 'NOT_FOUND');
});

test('update on audit_log throws and append is allowed', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const row = env.plain(R.transact((uow) => uow.append('audit_log', { event: 'X.Y', result: 'OK' }, env.actor)));
  assert.equal(row.id, 'AUD-000001');
  assert.equal(row.at, '2026-10-20T04:00:00.000Z');
  assert.equal(row.user_id, 'USR-0001');
  assert.throws(() => R.transact((uow) => uow.update('audit_log', row.id, { event: 'Z' }, { expectedVersion: 1, actor: env.actor })), /append-only/);
  assert.throws(() => R.transact((uow) => uow.append('brands', { name: 'x', code: 'y' }, env.actor)), /append-only/);
  assert.equal(typeof R.delete, 'undefined');
});

test('transact releases the lock after a throw', () => {
  const env = setupDb();
  assert.throws(() => env.g('Repository').transact(() => { throw new Error('boom'); }), /boom/);
  assert.equal(env.google.lock.held, false);
});

test('transact throws BUSY when the lock is held', () => {
  const env = setupDb();
  env.google.lockHeld = true;
  assert.throws(() => env.g('Repository').transact(() => 1), (e) => e.code === 'BUSY');
});

test('a failed transaction leaves earlier rows and counters unchanged', () => {
  const env = setupDb();
  const R = env.g('Repository');
  assert.throws(() => R.transact((uow) => {
    uow.insert('regions', { name: 'NCR' }, env.actor);
    uow.insert('regions', { name: '' }, env.actor);
  }), (e) => e.code === 'VALIDATION');
  assert.equal(R.all('regions').length, 0);
  assert.equal(env.plain(R.transact((uow) => uow.insert('regions', { name: 'NCR' }, env.actor))).id, 'REG-0001');
});

test('unique fields are checked ignoring case and spacing, within their scope', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const b = addBrand(env, 'Brand', 'BR');
  const b2 = addBrand(env, 'Brand Two', 'B2');
  const loc = (brand, name) => R.transact((uow) => uow.insert('locations',
    { name, location_type: 'Store', brand_id: brand }, env.actor));
  loc(b.id, 'Doña  Soledad');
  assert.throws(() => loc(b.id, ' doña soledad '), (e) => e.code === 'VALIDATION' && e.fields[0].code === 'DUPLICATE');
  loc(b2.id, 'Doña Soledad');
  assert.throws(() => addBrand(env, 'BRAND', 'XX'), (e) => e.code === 'VALIDATION');
  assert.throws(() => addBrand(env, 'Fresh', 'br'), (e) => e.code === 'VALIDATION');
});

test('unique blank values are not compared', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const add = (n) => R.transact((uow) => uow.insert('users', { display_name: n, role: 'Training Officer' }, env.actor));
  add('One'); add('Two');
  assert.equal(R.all('users').length, 2);
});

test('rows come back typed', () => {
  const env = setupDb();
  const R = env.g('Repository');
  R.transact((uow) => uow.insert('assessment_components', { name: 'Checklist', stage: 'certification', required: true, weight: 12.5 }, env.actor));
  const row = env.plain(R.all('assessment_components'))[0];
  assert.equal(row.required, true);
  assert.equal(row.weight, 12.5);
  assert.equal(row.is_active, true);
  assert.equal(row.row_version, 1);
  R.transact((uow) => uow.update('assessment_components', row.id, { weight: null, required: false }, { expectedVersion: 1, actor: env.actor }));
  const row2 = env.plain(R.get('assessment_components', row.id));
  assert.equal(row2.weight, null);
  assert.equal(row2.required, false);
});

test('settings are versioned rows with effective_from and supersedes_id', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const s1 = env.plain(R.transact((uow) => uow.insert('settings',
    { setting_key: 'CFG-041', value: '85', value_type: 'int', version: 1, effective_from: '2026-10-20' }, env.actor)));
  const s2 = env.plain(R.transact((uow) => uow.insert('settings',
    { setting_key: 'CFG-041', value: '80', value_type: 'int', version: 2, effective_from: '2026-11-01', supersedes_id: s1.id }, env.actor)));
  assert.equal(s2.supersedes_id, s1.id);
  assert.equal(R.all('settings').length, 2);
  assert.throws(() => R.transact((uow) => uow.update('settings', s1.id, { value: '1' }, { expectedVersion: 1, actor: env.actor })), /not mutable/);
});

test('many rows are appended in one setValues call and the sheet grows', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const sheet = env.sheet('regions');
  let calls = 0;
  const orig = sheet.getRange.bind(sheet);
  sheet.getRange = (...a) => {
    const r = orig(...a);
    const sv = r.setValues.bind(r);
    r.setValues = (v) => { if (v.length > 1) calls++; return sv(v); };
    return r;
  };
  R.transact((uow) => { for (let i = 1; i <= 1100; i++) uow.insert('regions', { name: 'R' + i }, env.actor); });
  assert.equal(calls, 1);
  assert.equal(R.all('regions').length, 1100);
  assert.equal(R.get('regions', 'REG-1100').name, 'R1100');
});

test('a header that does not match the schema is a server error', () => {
  const env = setupDb();
  env.sheet('regions').getRange(1, 2).setValues([['wrong']]);
  assert.throws(() => env.g('Repository').all('regions'), (e) => e.code === 'SERVER');
});

test('a missing database id is CONFIG_MISSING', () => {
  const env = setupDb();
  env.g('Props').remove('TLMI_DB_ID');
  assert.throws(() => env.g('Repository').all('brands'), (e) => e.code === 'CONFIG_MISSING');
});
