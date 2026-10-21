'use strict';
// Part 2A: temporary passwords, reset, and clearing the pause (Phase 2 spec 4.3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

const rv = (env, id) => env.plain(env.g('Repository').get('users', id)).row_version;

function create(env, admin, no) {
  const r = env.call('users.create', { display_name: 'New Person', role: 'Training Officer', hr_employee_no: no || '2001' }, admin);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
}

test('create returns a temporary password once, and get and list never return it', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const data = create(env, admin);
  assert.match(data.temporary_password, /^[A-Za-z2-9]{12}$/);
  assert.ok(!/[IOl01]/.test(data.temporary_password), 'no look-alike characters');
  const later = JSON.stringify([env.call('users.get', { id: data.user.id }, admin), env.call('users.list', {}, admin)]);
  assert.ok(!later.includes(data.temporary_password));
  assert.ok(!later.includes('temporary_password'));
});

test('the new user must change the password at the first sign-in', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const data = create(env, admin);
  const res = env.call('auth.signIn', { employee_id: '2001', password: data.temporary_password });
  assert.equal(res.ok, true);
  assert.equal(res.data.must_change_password, true);
  assert.equal(env.call('brands.list', {}, res.data.token).error.code, 'FORBIDDEN');
  const changed = env.call('auth.changePassword', { current: data.temporary_password, new: 'my-own-pass-88' }, res.data.token);
  assert.equal(changed.ok, true);
  assert.equal(env.call('brands.list', {}, changed.data.token).ok, true);
  assert.equal(env.call('auth.me', {}, changed.data.token).data.must_change_password, false);
});

test('resetPassword gives a new temporary password and ends the user\'s sessions', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const officer = env.signIn('officer');
  const id = env.users.officer.id;
  const r = env.call('users.resetPassword', { id, row_version: rv(env, id) }, admin);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.data.temporary_password, /^[A-Za-z2-9]{12}$/);
  assert.equal(r.data.user.must_change_password, true);
  assert.equal(env.call('auth.me', {}, officer).error.code, 'SESSION_EXPIRED');
  assert.equal(env.signInRaw('officer').error.code, 'AUTH_FAILED');
  const again = env.call('auth.signIn', { employee_id: env.NUMBERS.officer, password: r.data.temporary_password });
  assert.equal(again.ok, true);
  assert.equal(again.data.must_change_password, true);
});

test('resetPassword clears the pause', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  for (let i = 1; i <= 5; i++) env.signInRaw('officer', 'wrong-pass-' + i);
  assert.equal(env.signInRaw('officer').error.code, 'AUTH_LOCKED');
  const id = env.users.officer.id;
  const r = env.call('users.resetPassword', { id, row_version: rv(env, id) }, admin);
  assert.equal(env.call('auth.signIn', { employee_id: env.NUMBERS.officer, password: r.data.temporary_password }).ok, true);
});

test('an Admin cannot reset their own password here', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const id = env.users.admin.id;
  const r = env.call('users.resetPassword', { id, row_version: rv(env, id) }, admin);
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.equal(env.signInRaw('admin').ok, true, 'the password is unchanged');
});

test('resetPassword needs the current row_version (CONFLICT) and a known user', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const id = env.users.officer.id;
  assert.equal(env.call('users.resetPassword', { id, row_version: rv(env, id) + 5 }, admin).error.code, 'CONFLICT');
  assert.equal(env.call('users.resetPassword', { id: 'USR-9999', row_version: 1 }, admin).error.code, 'NOT_FOUND');
});

test('clearCooldown lets a paused user sign in', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  for (let i = 1; i <= 5; i++) env.signInRaw('officer', 'wrong-pass-' + i);
  const id = env.users.officer.id;
  const listed = env.call('users.get', { id }, admin).data;
  assert.equal(listed.paused, true);
  const r = env.call('users.clearCooldown', { id, row_version: listed.row_version }, admin);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.user.paused, false);
  assert.equal(env.signInRaw('officer').ok, true);
  assert.ok(env.auditRows().some((a) => a.event === 'USER.COOLDOWN_CLEARED' && a.entity_id === id));
});

test('audit rows of create and reset hold no password and no hash', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const data = create(env, admin);
  const id = env.users.officer.id;
  const reset = env.call('users.resetPassword', { id, row_version: rv(env, id) }, admin);
  const stored = env.plain(env.g('Repository').all('users'));
  const all = JSON.stringify([env.auditRows(), env.plain(env.g('Repository').all('record_history')), env.google.logs]);
  for (const needle of [data.temporary_password, reset.data.temporary_password, ...stored.map((u) => u.password_hash), ...stored.map((u) => u.salt)]) {
    assert.ok(needle && !all.includes(needle));
  }
  assert.ok(env.auditRows().some((a) => a.event === 'USER.PASSWORD_RESET' && a.entity_id === id));
  const history = env.call('history.get', { entity: 'users', id }, admin).data;
  assert.ok(history.some((h) => h.field === 'password_hash' && h.new_value === '[changed]'));
  assert.ok(!history.some((h) => ['failed_attempts', 'cooldown_until', 'last_login_at'].includes(h.field)));
});

test('a role change and a deactivation raise the session epoch of that user only', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const A = env.g('AuthService');
  const id = env.users.supervisor.id;
  env.call('users.update', { id, row_version: rv(env, id), patch: { role: 'Training Manager' } }, admin);
  assert.equal(A.epoch(id), 1);
  env.call('users.deactivate', { id, row_version: rv(env, id) }, admin);
  assert.equal(A.epoch(id), 2);
  assert.equal(A.epoch(env.users.admin.id), 0);
});
