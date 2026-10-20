'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi, PIN } = require('../helpers/env');

const signIn = (env, key, pin) => env.call('auth.signIn', pin === undefined ? { user_id: env.users[key].id } : { user_id: env.users[key].id, pin });

test('listSignInUsers returns only id and display_name of active users', () => {
  const env = setupApi();
  env.g('Repository').transact((uow) => uow.update('users', env.users.supervisor.id, {}, { expectedVersion: 1, actor: env.actor, isActive: false }));
  const res = env.call('auth.listSignInUsers');
  assert.equal(res.ok, true);
  assert.equal(res.data.length, 4);
  for (const u of res.data) assert.deepEqual(Object.keys(u).sort(), ['display_name', 'id']);
  assert.ok(!JSON.stringify(res).includes('1001'));
  assert.ok(!res.data.some((u) => u.id === env.users.supervisor.id));
  assert.deepEqual(res.data.map((u) => u.display_name), res.data.map((u) => u.display_name).slice().sort());
});

test('a non-Admin signs in without a PIN and gets a token and the user', () => {
  const env = setupApi();
  const res = signIn(env, 'officer');
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.user, { id: env.users.officer.id, name: 'Olivia Tester', role: 'Training Officer' });
  assert.match(res.data.token, /^[0-9a-f-]{36}$/);
  const me = env.call('auth.me', {}, res.data.token);
  assert.equal(me.data.user.role, 'Training Officer');
  assert.ok(env.auditRows().some((r) => r.event === 'AUTH.SIGNIN' && r.result === 'OK' && r.user_id === env.users.officer.id));
});

test('a PIN given by a non-Admin is ignored, an unknown or inactive user gets the generic failure', () => {
  const env = setupApi();
  assert.equal(signIn(env, 'officer', 'whatever').ok, true);
  const unknown = env.call('auth.signIn', { user_id: 'USR-9999' });
  assert.equal(unknown.error.code, 'AUTH_FAILED');
  env.g('Repository').transact((uow) => uow.update('users', env.users.manager.id, {}, { expectedVersion: 1, actor: env.actor, isActive: false }));
  assert.equal(signIn(env, 'manager').error.code, 'AUTH_FAILED');
  assert.equal(unknown.error.message, signIn(env, 'manager').error.message);
});

test('Admin without PIN is AUTH_FAILED', () => {
  const env = setupApi();
  assert.equal(signIn(env, 'admin').error.code, 'AUTH_FAILED');
  assert.equal(signIn(env, 'admin', '').error.code, 'AUTH_FAILED');
  assert.equal(signIn(env, 'admin', 'wrong-pin-1').error.code, 'AUTH_FAILED');
  assert.equal(signIn(env, 'admin', PIN).ok, true);
});

test('5 wrong PINs give AUTH_LOCKED with retry_after 900', () => {
  const env = setupApi();
  for (let i = 1; i <= 4; i++) assert.equal(signIn(env, 'admin', 'wrong-' + i).error.code, 'AUTH_FAILED');
  const fifth = signIn(env, 'admin', 'wrong-5');
  assert.equal(fifth.error.code, 'AUTH_LOCKED');
  assert.equal(fifth.error.retry_after, 900);
  env.minutes(5);
  const during = signIn(env, 'admin', PIN);
  assert.equal(during.error.code, 'AUTH_LOCKED');
  assert.equal(during.error.retry_after, 600);
  const events = env.auditRows().map((r) => r.event);
  assert.equal(events.filter((e) => e === 'AUTH.SIGNIN.FAILED').length, 4);
  assert.ok(events.includes('AUTH.SIGNIN.LOCKED'));
});

test('correct PIN after the pause works and the counter resets', () => {
  const env = setupApi();
  for (let i = 1; i <= 5; i++) signIn(env, 'admin', 'wrong-' + i);
  env.minutes(16);
  assert.equal(signIn(env, 'admin', PIN).ok, true);
  // the counter is clear: four more wrong tries do not lock
  for (let i = 1; i <= 4; i++) assert.equal(signIn(env, 'admin', 'wrong-' + i).error.code, 'AUTH_FAILED');
  assert.equal(signIn(env, 'admin', PIN).ok, true);
  assert.equal(JSON.parse(env.g('Props').get('ADMIN_PIN_FAILS')).count, 0);
});

test('failures count until a correct PIN clears them', () => {
  const env = setupApi();
  for (let i = 1; i <= 3; i++) signIn(env, 'admin', 'wrong-' + i);
  env.minutes(120);
  assert.equal(signIn(env, 'admin', 'wrong-4').error.code, 'AUTH_FAILED');
  assert.equal(signIn(env, 'admin', 'wrong-5').error.code, 'AUTH_LOCKED');
});

test('clearing the whole cache does not reset the PIN failure counter', () => {
  const env = setupApi();
  for (let i = 1; i <= 4; i++) signIn(env, 'admin', 'wrong-' + i);
  env.google.clearCache();
  assert.equal(signIn(env, 'admin', 'wrong-5').error.code, 'AUTH_LOCKED');
  env.google.clearCache();
  assert.equal(signIn(env, 'admin', PIN).error.code, 'AUTH_LOCKED');
});

test('a locked account is refused before the hash is computed', () => {
  const env = setupApi();
  for (let i = 1; i <= 5; i++) signIn(env, 'admin', 'wrong-' + i);
  let calls = 0;
  env.g('Hasher').verify = () => { calls++; return true; };
  assert.equal(signIn(env, 'admin', PIN).error.code, 'AUTH_LOCKED');
  assert.equal(calls, 0);
});

test('the PIN never reaches the audit log', () => {
  const env = setupApi();
  signIn(env, 'admin', 'wrong-pin-77');
  signIn(env, 'admin', PIN);
  const all = JSON.stringify(env.auditRows());
  assert.ok(!all.includes('wrong-pin-77'));
  assert.ok(!all.includes(PIN));
});

test('Admin sign-in needs the PIN to be set up, reported by name only', () => {
  const env = setupApi();
  env.g('Props').remove('ADMIN_PIN_HASH');
  const res = signIn(env, 'admin', PIN);
  assert.equal(res.error.code, 'CONFIG_MISSING');
  assert.ok(res.error.message.includes('ADMIN_PIN_HASH'));
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
  assert.equal(signIn(env, 'admin', 'x1').error.code, 'AUTH_FAILED');
  const locked = signIn(env, 'admin', 'x2');
  assert.equal(locked.error.code, 'AUTH_LOCKED');
  assert.equal(locked.error.retry_after, 60);
});
