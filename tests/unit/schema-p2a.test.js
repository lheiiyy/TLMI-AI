'use strict';
// Part 2A, Task 1: the users fields, the pattern check, and noHistory columns.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');
const { setupDb } = require('../helpers/db');

test('users has the four new columns, before the profile columns', () => {
  const env = setupDb({ tables: false });
  const cols = env.plain(env.g('Schema').columns('users'));
  assert.deepEqual(cols, ['id', 'hr_employee_no', 'display_name', 'role', 'password_hash', 'salt', 'must_change_password',
    'failed_attempts', 'cooldown_until', 'last_login_at', 'created_at', 'created_by', 'updated_at', 'updated_by', 'is_active', 'row_version']);
  assert.equal(env.g('Schema').columnType(env.g('Schema').table('users'), 'cooldown_until'), 'timestamp');
});

test('hr_employee_no rejects letters and spaces (PATTERN) and more than 20 digits (TOO_LONG); digits pass', () => {
  const env = setupDb();
  const insert = (no) => env.g('Repository').transact((uow) => uow.insert('users', { display_name: 'T ' + no, role: 'Training Officer', hr_employee_no: no }, env.actor));
  for (const bad of ['12ab', '12 34', '1-2']) {
    assert.throws(() => insert(bad), (e) => e.code === 'VALIDATION' && e.fields[0].code === 'PATTERN' && e.fields[0].path === 'hr_employee_no', bad);
  }
  assert.throws(() => insert('123456789012345678901'), (e) => e.fields[0].code === 'TOO_LONG');
  assert.doesNotThrow(() => insert('0012345'));
});

test('the pattern applies to API parameters too, and an empty optional text is not checked', () => {
  const env = setupApi();
  const bad = env.call('auth.signIn', { employee_id: '12x', password: 'whatever-1' });
  assert.equal(bad.error.code, 'VALIDATION');
  assert.equal(bad.error.fields[0].code, 'PATTERN');
});

test('changes writes no row for failed_attempts, cooldown_until or last_login_at', () => {
  const env = setupApi();
  const R = env.g('Repository');
  const id = env.users.officer.id;
  env.g('Repository').transact((uow) => {
    const before = uow.get('users', id);
    const r = uow.update('users', id, { failed_attempts: 3, cooldown_until: '2026-10-21T01:00:00.000Z', last_login_at: '2026-10-21T00:00:00.000Z' },
      { expectedVersion: before.row_version, actor: env.actor });
    const rows = env.g('AuditService').changes(uow, { requestId: 'r', now: env.actor.now, userId: env.actor.userId }, 'users', id, r.before, r.after);
    assert.equal(rows.length, 0);
  });
  assert.equal(env.plain(R.all('record_history')).filter((h) => h.entity === 'users' && h.entity_id === id).length, 0);
});

test('changes writes [changed] for password_hash and salt, never their values, and still tracks other fields', () => {
  const env = setupApi();
  const id = env.users.officer.id;
  env.g('Repository').transact((uow) => {
    const before = uow.get('users', id);
    const r = uow.update('users', id, { password_hash: 'hmac-sha256$1$new', salt: 'new-salt', display_name: 'Olivia T.', must_change_password: true },
      { expectedVersion: before.row_version, actor: env.actor });
    const rows = env.plain(env.g('AuditService').changes(uow, { requestId: 'r', now: env.actor.now, userId: env.actor.userId }, 'users', id, r.before, r.after));
    const byField = Object.fromEntries(rows.map((h) => [h.field, h]));
    assert.deepEqual(Object.keys(byField).sort(), ['display_name', 'must_change_password', 'password_hash', 'salt']);
    assert.equal(byField.password_hash.new_value, '[changed]');
    assert.equal(byField.password_hash.old_value, '[changed]');
    assert.equal(byField.salt.new_value, '[changed]');
    assert.equal(byField.display_name.new_value, 'Olivia T.');
  });
});
