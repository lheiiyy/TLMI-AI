'use strict';
// Review round 2 of pull request A: detail handling, hidden credentials, truncation, Manila dates, commit order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

function ctxOf(extra) {
  return Object.assign({ userId: 'USR-0001', hrEmployeeNo: '4471', requestId: 'req-1', now: '2026-10-20T04:00:00.000Z' }, extra || {});
}

test('event strips sensitive keys from a detail that arrives as JSON text', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const row = env.plain(env.g('Repository').transact((uow) => A.event(uow, ctxOf(),
    { event: 'X', detail: JSON.stringify({ pin: '123456', ok: 1, list: [{ token: 't', keep: 2 }] }) })));
  assert.deepEqual(JSON.parse(row.detail), { ok: 1, list: [{ keep: 2 }] });
  assert.ok(!row.detail.includes('123456'));
});

test('event keeps a plain-text detail as {text}', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const row = env.plain(env.g('Repository').transact((uow) => A.event(uow, ctxOf(), { event: 'X', detail: 'free text, not json' })));
  assert.deepEqual(JSON.parse(row.detail), { text: 'free text, not json' });
  const num = env.plain(env.g('Repository').transact((uow) => A.event(uow, ctxOf(), { event: 'X', detail: '42' })));
  assert.deepEqual(JSON.parse(num.detail), { text: '42' });
});

test('changes hides the value of the users hash and salt columns', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const before = { id: 'USR-0001', display_name: 'A', role: 'Admin', password_hash: '', salt: '', is_active: true, hr_employee_no: '' };
  const after = Object.assign({}, before, { password_hash: 'hmac-sha256$1$abcd', salt: 'xyz', display_name: 'B' });
  const rows = env.plain(env.g('Repository').transact((uow) => A.changes(uow, ctxOf(), 'users', 'USR-0001', before, after)));
  const by = Object.fromEntries(rows.map((r) => [r.field, r]));
  assert.equal(by.password_hash.new_value, '[changed]');
  assert.equal(by.password_hash.old_value, '[changed]');
  assert.equal(by.salt.new_value, '[changed]');
  assert.equal(by.display_name.new_value, 'B');
  assert.ok(!JSON.stringify(rows).includes('abcd'));
  assert.ok(!JSON.stringify(rows).includes('xyz'));
});

test('event cuts a very long detail instead of failing the whole write', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const long = 'x'.repeat(60000);
  const row = env.plain(env.g('Repository').transact((uow) => A.event(uow, ctxOf(), { event: 'X', detail: { note: long } })));
  assert.ok(row.detail.length <= 50000);
  assert.equal(JSON.parse(row.detail).truncated, true);
  const escapes = env.plain(env.g('Repository').transact((uow) => A.event(uow, ctxOf(), { event: 'X', detail: { note: '"\n'.repeat(30000) } })));
  assert.ok(escapes.detail.length <= 50000);
  const small = env.plain(env.g('Repository').transact((uow) => A.event(uow, ctxOf(), { event: 'X', detail: { note: 'short' } })));
  assert.deepEqual(JSON.parse(small.detail), { note: 'short' });
});

test('list from and to use the Manila date, not the UTC date', () => {
  const env = setupDb();
  const A = env.g('AuditService');
  const R = env.g('Repository');
  R.transact((uow) => A.event(uow, ctxOf({ now: '2026-10-20T23:30:00.000Z' }), { event: 'LATE' }));
  R.transact((uow) => A.event(uow, ctxOf({ now: '2026-10-20T15:59:59.000Z' }), { event: 'BEFORE' }));
  const ev = (f) => env.plain(A.list({ filters: f }, 'Admin')).rows.map((r) => r.event);
  assert.deepEqual(ev({ from: '2026-10-21' }), ['LATE']);
  assert.deepEqual(ev({ to: '2026-10-20' }), ['BEFORE']);
  assert.deepEqual(ev({ from: '2026-10-21', to: '2026-10-21' }), ['LATE']);
});

test('Clock.dateOfIso gives the Manila date of an ISO timestamp', () => {
  const { g } = require('../helpers/loader').loadServer();
  assert.equal(g('Clock').dateOfIso('2026-10-20T15:59:59.000Z'), '2026-10-20');
  assert.equal(g('Clock').dateOfIso('2026-10-20T16:00:00.000Z'), '2026-10-21');
});

test('commit writes counters first, then data tables, record_history, and audit_log last', () => {
  const env = setupDb();
  const order = [];
  for (const tab of ['id_counters', 'regions', 'record_history', 'audit_log']) {
    const sh = env.sheet(tab);
    const orig = sh.getRange.bind(sh);
    sh.getRange = (...a) => {
      const r = orig(...a);
      const sv = r.setValues.bind(r);
      r.setValues = (v) => { order.push(tab); return sv(v); };
      return r;
    };
  }
  const A = env.g('AuditService');
  const c = { userId: 'USR-0001', now: env.actor.now };
  env.g('Repository').transact((uow) => {
    A.event(uow, c, { event: 'E' });
    A.changes(uow, c, 'regions', 'REG-0001', { name: 'a' }, { name: 'b' });
    uow.insert('regions', { name: 'NCR' }, env.actor);
  });
  assert.deepEqual(order, ['id_counters', 'regions', 'record_history', 'audit_log']);
});
