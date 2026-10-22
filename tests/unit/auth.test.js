'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

test('an officer signs in with employee ID and password and gets a token and the session block', () => {
  const env = setupApi();
  const res = env.signInRaw('officer');
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.user, { id: env.users.officer.id, name: 'Olivia Tester', role: 'Training Officer' });
  assert.match(res.data.token, /^[0-9a-f-]{36}$/);
  assert.equal(res.data.must_change_password, false);
  assert.ok(res.data.capabilities.includes('brands.list'));
  assert.ok(!res.data.capabilities.includes('users.create'));
  assert.deepEqual(res.data.scope, { brand_ids: [] });
  assert.deepEqual(res.data.flags, {});
  assert.deepEqual(res.data.settings_public, { idle_minutes: 30, page_size: 50 });
  const me = env.call('auth.me', {}, res.data.token);
  assert.equal(me.data.user.role, 'Training Officer');
  assert.equal(me.data.token, undefined);
  assert.deepEqual(me.data.capabilities, res.data.capabilities);
  assert.ok(env.auditRows().some((r) => r.event === 'AUTH.SIGNIN' && r.result === 'OK' && r.user_id === env.users.officer.id));
});

test('Admin has the Admin capabilities, and sign-in notes the time', () => {
  const env = setupApi();
  const res = env.signInRaw('admin');
  assert.ok(res.data.capabilities.includes('users.resetPassword'));
  assert.ok(res.data.capabilities.includes('users.clearCooldown'));
  const u = env.plain(env.g('Repository').get('users', env.users.admin.id));
  assert.match(u.last_login_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('an unknown or inactive employee ID, and a wrong password, give the same generic failure', () => {
  const env = setupApi();
  const unknown = env.call('auth.signIn', { employee_id: '999999', password: env.PASSWORD });
  assert.equal(unknown.error.code, 'AUTH_FAILED');
  env.g('Repository').transact((uow) => uow.update('users', env.users.manager.id, {}, { expectedVersion: uow.get('users', env.users.manager.id).row_version, actor: env.actor, isActive: false }));
  const inactive = env.signInRaw('manager');
  const wrong = env.signInRaw('officer', 'not-the-password-1');
  for (const r of [inactive, wrong]) {
    assert.equal(r.error.code, 'AUTH_FAILED');
    assert.equal(r.error.message, unknown.error.message);
  }
});

test('the employee ID must be digits and the fields are required', () => {
  const env = setupApi();
  assert.equal(env.call('auth.signIn', { employee_id: 'abc', password: 'x' }).error.code, 'VALIDATION');
  assert.equal(env.call('auth.signIn', { employee_id: '1001' }).error.code, 'VALIDATION');
  assert.equal(env.call('auth.signIn', { password: 'x' }).error.code, 'VALIDATION');
});

test('auth.listSignInUsers no longer exists', () => {
  const env = setupApi();
  assert.equal(env.call('auth.listSignInUsers').error.code, 'NOT_FOUND');
});

test('sign-in needs the pepper, reported by name only', () => {
  const env = setupApi();
  env.g('Props').remove('PEPPER');
  const res = env.signInRaw('officer');
  assert.equal(res.error.code, 'CONFIG_MISSING');
  assert.ok(res.error.message.includes('PEPPER'));
});

test('signOut ends the session and is audited', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  assert.equal(env.call('auth.signOut', {}, token).ok, true);
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
  assert.ok(env.auditRows().some((r) => r.event === 'AUTH.SIGNOUT'));
});

test('idle and pause lengths come from settings when they exist', () => {
  const env = setupApi();
  env.g('Repository').transact((uow) => {
    uow.insert('settings', { setting_key: 'CFG-001', value: '10', value_type: 'int', version: 1, effective_from: '2026-10-01' }, env.actor);
    uow.insert('settings', { setting_key: 'CFG-002', value: '2', value_type: 'int', version: 1, effective_from: '2026-10-01' }, env.actor);
    uow.insert('settings', { setting_key: 'CFG-003', value: '1', value_type: 'int', version: 1, effective_from: '2026-10-01' }, env.actor);
  });
  const token = env.signIn('officer');
  env.minutes(11);
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
  assert.equal(env.signInRaw('admin', 'x1abcdefg').error.code, 'AUTH_FAILED');
  const locked = env.signInRaw('admin', 'x2abcdefg');
  assert.equal(locked.error.code, 'AUTH_LOCKED');
  assert.equal(locked.error.retry_after, 60);
});
