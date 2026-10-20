'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

function ctxOf(env, extra) {
  return Object.assign({ userId: 'USR-0001', hrEmployeeNo: '4471', requestId: 'req-1', now: '2026-10-20T04:00:00.000Z' }, extra || {});
}

test('changes writes one row per changed field only', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const before = { id: 'LOC-0001', name: 'A', location_type: 'Store', brand_id: 'BRD-0001', region_id: 'REG-0001', is_active: true, row_version: 1, updated_at: 'x' };
  const after = Object.assign({}, before, { name: 'B', is_active: false, row_version: 2, updated_at: 'y' });
  const rows = env.plain(env.g('Repository').transact((uow) => A.changes(uow, ctxOf(env), 'locations', 'LOC-0001', before, after)));
  assert.deepEqual(rows.map((r) => [r.field, r.old_value, r.new_value]), [['name', 'A', 'B'], ['is_active', 'true', 'false']]);
  assert.equal(rows[0].entity, 'locations');
  assert.equal(rows[0].entity_id, 'LOC-0001');
  assert.equal(rows[0].user_id, 'USR-0001');
  assert.equal(rows[0].request_id, 'req-1');
  assert.equal(rows[0].at, '2026-10-20T04:00:00.000Z');
  assert.equal(env.plain(env.g('Repository').all('record_history')).length, 2);
});

test('changes writes nothing when nothing changed', () => {
  const env = setupDb();
  const row = { id: 'REG-0001', name: 'NCR', is_active: true };
  const rows = env.g('Repository').transact((uow) => env.g('AuditService').changes(uow, ctxOf(env), 'regions', 'REG-0001', row, Object.assign({}, row)));
  assert.equal(rows.length, 0);
});

test('event strips pin, password, token and hr_employee_no from detail', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const row = env.plain(env.g('Repository').transact((uow) => A.event(uow, ctxOf(env),
    { event: 'AUTH.SIGNIN', entity: 'users', entityId: 'USR-0001', detail: { pin: '123456', ok: 1, nested: { password: 'p', token: 't', hr_employee_no: '9', keep: 'yes' } } })));
  const detail = JSON.parse(row.detail);
  assert.deepEqual(detail, { ok: 1, nested: { keep: 'yes' } });
  assert.equal(row.result, 'OK');
  assert.equal(row.hr_employee_no, '4471');
  assert.equal(row.event, 'AUTH.SIGNIN');
  assert.ok(!row.detail.includes('123456'));
});

test('list pages newest first with a cursor', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  env.g('Repository').transact((uow) => { for (let i = 1; i <= 7; i++) A.event(uow, ctxOf(env), { event: 'E' + i, entity: 'x', entityId: String(i) }); });
  const p1 = env.plain(A.list({ page_size: 3 }, 'Admin'));
  assert.deepEqual(p1.rows.map((r) => r.event), ['E7', 'E6', 'E5']);
  assert.equal(p1.nextCursor, p1.rows[2].id);
  const p2 = env.plain(A.list({ page_size: 3, cursor: p1.nextCursor }, 'Admin'));
  assert.deepEqual(p2.rows.map((r) => r.event), ['E4', 'E3', 'E2']);
  const p3 = env.plain(A.list({ page_size: 3, cursor: p2.nextCursor }, 'Admin'));
  assert.deepEqual(p3.rows.map((r) => r.event), ['E1']);
  assert.equal(p3.nextCursor, null);
});

test('list filters on event, entity, user and date range', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const R = env.g('Repository');
  R.transact((uow) => A.event(uow, ctxOf(env, { now: '2026-10-18T10:00:00.000Z' }), { event: 'A.ONE', entity: 'brands' }));
  R.transact((uow) => A.event(uow, ctxOf(env, { now: '2026-10-19T10:00:00.000Z', userId: 'USR-0002' }), { event: 'A.TWO', entity: 'regions' }));
  R.transact((uow) => A.event(uow, ctxOf(env, { now: '2026-10-20T10:00:00.000Z' }), { event: 'A.THREE', entity: 'brands' }));
  const ev = (f) => env.plain(A.list({ filters: f }, 'Admin')).rows.map((r) => r.event);
  assert.deepEqual(ev({ entity: 'brands' }), ['A.THREE', 'A.ONE']);
  assert.deepEqual(ev({ event: 'A.TWO' }), ['A.TWO']);
  assert.deepEqual(ev({ user_id: 'USR-0002' }), ['A.TWO']);
  assert.deepEqual(ev({ from: '2026-10-19', to: '2026-10-19' }), ['A.TWO']);
  assert.deepEqual(ev({ from: '2026-10-19' }), ['A.THREE', 'A.TWO']);
});

test('list rejects page_size 51 and unknown filters', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  assert.throws(() => A.list({ page_size: 51 }, 'Admin'), (e) => e.code === 'VALIDATION');
  assert.throws(() => A.list({ page_size: 0 }, 'Admin'), (e) => e.code === 'VALIDATION');
  assert.throws(() => A.list({ filters: { bogus: 1 } }, 'Admin'), (e) => e.code === 'VALIDATION');
  assert.equal(env.plain(A.list({}, 'Admin')).rows.length, 0);
});

test('list for a Senior Training Manager has no hr_employee_no key in any row', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  env.g('Repository').transact((uow) => A.event(uow, ctxOf(env), { event: 'X.Y' }));
  const senior = env.plain(A.list({}, 'Senior Training Manager')).rows;
  assert.equal(senior.length, 1);
  for (const r of senior) assert.ok(!('hr_employee_no' in r));
  assert.ok(!JSON.stringify(senior).includes('4471'));
  const manager = env.plain(A.list({}, 'Training Manager')).rows;
  for (const r of manager) assert.ok(!('hr_employee_no' in r));
  assert.ok(!('hr_employee_no' in env.plain(A.list({}, undefined)).rows[0]));
});

test('list for an Admin keeps hr_employee_no', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  env.g('Repository').transact((uow) => A.event(uow, ctxOf(env), { event: 'X.Y' }));
  assert.equal(env.plain(A.list({}, 'Admin')).rows[0].hr_employee_no, '4471');
});

test('history returns the change rows of one record, oldest first', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const R = env.g('Repository');
  R.transact((uow) => {
    A.changes(uow, ctxOf(env), 'regions', 'REG-0001', { name: 'A' }, { name: 'B' });
    A.changes(uow, ctxOf(env), 'regions', 'REG-0002', { name: 'X' }, { name: 'Y' });
    A.changes(uow, ctxOf(env), 'regions', 'REG-0001', { name: 'B' }, { name: 'C' });
  });
  const h = env.plain(A.history('regions', 'REG-0001'));
  assert.deepEqual(h.map((r) => [r.old_value, r.new_value]), [['A', 'B'], ['B', 'C']]);
});

test('logOutcome does not throw when the write fails', () => {
  const env = setupDb();
  env.g('Props').remove('TLMI_DB_ID');
  assert.doesNotThrow(() => env.g('AuditService').logOutcome(ctxOf(env), { event: 'X', result: 'DENIED' }));
});

test('logOutcome writes an audit row in its own transaction', () => {
  const env = setupDb();
  env.g('AuditService').logOutcome(ctxOf(env), { event: 'AUTH.SIGNIN.FAILED', entity: 'users', entityId: 'USR-0001', result: 'FAILED' });
  const rows = env.plain(env.g('Repository').all('audit_log'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'FAILED');
});
