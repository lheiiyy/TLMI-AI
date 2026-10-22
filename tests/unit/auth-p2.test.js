'use strict';
// Phase 2 part 2A: password sign-in failures, the pause per user, sessions with an epoch, the change-password gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

const user = (env, key) => env.plain(env.g('Repository').get('users', env.users[key].id));
const WRONG = 'wrong-pass-1';
const rowVersion = (env, key) => (uow) => uow.get('users', env.users[key].id).row_version;

test('a wrong password is AUTH_FAILED and counts on the user record', () => {
  const env = setupApi();
  assert.equal(env.signInRaw('officer', WRONG).error.code, 'AUTH_FAILED');
  assert.equal(user(env, 'officer').failed_attempts, 1);
  assert.equal(env.signInRaw('officer', WRONG).error.code, 'AUTH_FAILED');
  assert.equal(user(env, 'officer').failed_attempts, 2);
  // another user is not affected
  assert.ok(!user(env, 'manager').failed_attempts);
});

test('the fifth failure gives AUTH_LOCKED with retry_after 900, and the pause is per user', () => {
  const env = setupApi();
  for (let i = 1; i <= 4; i++) assert.equal(env.signInRaw('officer', WRONG).error.code, 'AUTH_FAILED');
  const fifth = env.signInRaw('officer', WRONG);
  assert.equal(fifth.error.code, 'AUTH_LOCKED');
  assert.equal(fifth.error.retry_after, 900);
  env.minutes(5);
  const during = env.signInRaw('officer');
  assert.equal(during.error.code, 'AUTH_LOCKED');
  assert.equal(during.error.retry_after, 600);
  assert.equal(env.signInRaw('manager').ok, true);
  const events = env.auditRows().map((r) => r.event);
  assert.equal(events.filter((e) => e === 'AUTH.SIGNIN.FAILED').length, 4);
  assert.ok(events.includes('AUTH.SIGNIN.LOCKED'));
});

test('after the pause the correct password works and the counters are clear', () => {
  const env = setupApi();
  for (let i = 1; i <= 5; i++) env.signInRaw('officer', WRONG);
  env.minutes(16);
  assert.equal(env.signInRaw('officer').ok, true);
  const u = user(env, 'officer');
  assert.ok(!u.failed_attempts && !u.cooldown_until);
  for (let i = 1; i <= 4; i++) assert.equal(env.signInRaw('officer', WRONG).error.code, 'AUTH_FAILED');
  assert.equal(env.signInRaw('officer').ok, true);
});

test('failures count until a correct password clears them, even after a long wait', () => {
  const env = setupApi();
  for (let i = 1; i <= 3; i++) env.signInRaw('officer', WRONG);
  env.minutes(120);
  assert.equal(env.signInRaw('officer', WRONG).error.code, 'AUTH_FAILED');
  assert.equal(env.signInRaw('officer', WRONG).error.code, 'AUTH_LOCKED');
});

test('clearing the whole cache does not reset the failure counter', () => {
  const env = setupApi();
  for (let i = 1; i <= 4; i++) env.signInRaw('officer', WRONG);
  env.google.clearCache();
  assert.equal(env.signInRaw('officer', WRONG).error.code, 'AUTH_LOCKED');
  env.google.clearCache();
  assert.equal(env.signInRaw('officer').error.code, 'AUTH_LOCKED');
});

test('a paused user is refused before any hash is computed', () => {
  const env = setupApi();
  for (let i = 1; i <= 5; i++) env.signInRaw('officer', WRONG);
  let calls = 0;
  const H = env.g('Hasher');
  const hash = H.hash;
  H.verify = () => { calls++; return true; };
  H.hash = (...a) => { calls++; return hash(...a); };
  assert.equal(env.signInRaw('officer').error.code, 'AUTH_LOCKED');
  assert.equal(calls, 0);
});

test('an unknown employee ID takes no lock and writes no row', () => {
  const env = setupApi();
  const rows = () => JSON.stringify([env.sheet('audit_log').getLastRow(), env.sheet('users').getLastRow(), env.sheet('record_history').getLastRow()]);
  const before = rows();
  env.google.lockHeld = true; // another execution holds the script lock
  const res = env.call('auth.signIn', { employee_id: '424242', password: 'whatever-1' });
  env.google.lockHeld = false;
  assert.equal(res.error.code, 'AUTH_FAILED');
  assert.equal(rows(), before);
});

test('an unknown id does equal hashing work to a known id (one hash call each)', () => {
  const env = setupApi();
  const H = env.g('Hasher');
  let n = 0;
  const hash = H.hash;
  H.hash = (...a) => { n++; return hash(...a); };
  env.call('auth.signIn', { employee_id: '424242', password: 'whatever-1' });
  const unknown = n;
  n = 0;
  env.signInRaw('officer', WRONG);
  assert.equal(unknown, 1);
  assert.equal(n, 1, 'verify hashes once');
});

test('two wrong tries from stale reads count 2 (the counter is re-read inside the lock)', () => {
  const env = setupApi();
  const R = env.g('Repository');
  const realAll = R.all;
  const stale = realAll.call(R, 'users');
  let useStale = false;
  R.all = (name) => (name === 'users' && useStale ? stale : realAll.call(R, name));
  env.signInRaw('officer', WRONG);
  useStale = true; // the second execution looked the user up before the first one wrote
  env.signInRaw('officer', WRONG);
  R.all = realAll;
  assert.equal(user(env, 'officer').failed_attempts, 2);
});

test('the 51st failure of a day writes no audit row, but is still counted', () => {
  const env = setupApi();
  const setting = (k, v) => env.g('Repository').transact((uow) => uow.insert('settings', { setting_key: k, value: v, value_type: 'int', version: 1, effective_from: '2026-10-01' }, env.actor));
  setting('CFG-002', '20');
  setting('CFG-003', '1');
  for (let i = 1; i <= 55; i++) {
    env.signInRaw('officer', WRONG);
    if (i % 19 === 0) env.minutes(2);
  }
  const rows = env.auditRows().filter((r) => r.event === 'AUTH.SIGNIN.FAILED' || r.event === 'AUTH.SIGNIN.LOCKED');
  assert.equal(rows.length, 50);
});

test('a temporary password blocks every method except auth.me, auth.signOut and auth.changePassword', () => {
  const env = setupApi();
  env.g('Repository').transact((uow) => uow.update('users', env.users.officer.id, { must_change_password: true }, { expectedVersion: rowVersion(env, 'officer')(uow), actor: env.actor }));
  const res = env.signInRaw('officer');
  assert.equal(res.data.must_change_password, true);
  const token = res.data.token;
  const blocked = env.call('brands.list', {}, token);
  assert.equal(blocked.error.code, 'FORBIDDEN');
  assert.equal(blocked.error.message, 'Change your password first.');
  assert.equal(env.call('auth.me', {}, token).data.must_change_password, true);
  const changed = env.call('auth.changePassword', { current: env.PASSWORD, new: 'brand-new-pass-7' }, token);
  assert.equal(changed.ok, true);
  assert.equal(env.call('brands.list', {}, changed.data.token).ok, true);
});

test('changePassword enforces FX-002, returns a new token and ends the old one', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  const call = (p) => env.call('auth.changePassword', p, token);
  assert.equal(call({ current: 'wrong-current-1', new: 'brand-new-pass-7' }).error.code, 'AUTH_FAILED');
  for (const [pw, code] of [['short1a', 'TOO_SHORT'], ['lettersonly', 'NEEDS_DIGIT'], ['1234567890', 'NEEDS_LETTER'], [env.PASSWORD, 'SAME_AS_CURRENT']]) {
    const r = call({ current: env.PASSWORD, new: pw });
    assert.equal(r.error.code, 'VALIDATION');
    assert.equal(r.error.fields[0].code, code);
    assert.equal(r.error.fields[0].path, 'new');
  }
  const ok = call({ current: env.PASSWORD, new: 'brand-new-pass-7' });
  assert.equal(ok.ok, true);
  assert.notEqual(ok.data.token, token);
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
  assert.equal(env.call('auth.me', {}, ok.data.token).ok, true);
  assert.equal(env.signInRaw('officer').error.code, 'AUTH_FAILED');
  assert.equal(env.signInRaw('officer', 'brand-new-pass-7').ok, true);
  assert.ok(env.auditRows().some((r) => r.event === 'AUTH.PASSWORD_CHANGED'));
});

test('changePassword ends the same user\'s other sessions (epoch)', () => {
  const env = setupApi();
  const a = env.signIn('officer');
  const b = env.signIn('officer');
  assert.equal(env.call('auth.changePassword', { current: env.PASSWORD, new: 'brand-new-pass-7' }, a).ok, true);
  assert.equal(env.call('auth.me', {}, b).error.code, 'SESSION_EXPIRED');
});

test('a bumped epoch ends a session within the same call even when the epoch was cached', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  const A = env.g('AuthService');
  assert.equal(env.call('auth.me', {}, token).ok, true); // the epoch is now cached
  A.bumpEpoch(env.users.officer.id);
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
  assert.equal(A.epoch(env.users.officer.id), 1);
});

test('a stored hash with another iteration count is rehashed on sign-in', () => {
  const env = setupApi();
  const H = env.g('Hasher');
  const salt = H.newSalt();
  env.g('Repository').transact((uow) => uow.update('users', env.users.officer.id, { password_hash: H.hash(env.PASSWORD, salt, 'test-pepper', 500), salt: salt }, { expectedVersion: rowVersion(env, 'officer')(uow), actor: env.actor }));
  assert.match(user(env, 'officer').password_hash, /^hmac-sha256\$500\$/);
  assert.equal(env.signInRaw('officer').ok, true);
  assert.match(user(env, 'officer').password_hash, /^hmac-sha256\$1000\$/);
  assert.equal(env.signInRaw('officer').ok, true);
});

test('no response, audit row, history row or log line contains a password or a hash', () => {
  const env = setupApi();
  env.signInRaw('officer', 'guess-attempt-77');
  const token = env.signIn('admin');
  const changed = env.call('auth.changePassword', { current: env.PASSWORD, new: 'brand-new-pass-7' }, token);
  const created = env.call('users.create', { display_name: 'New Person', role: 'Training Officer', hr_employee_no: '2001' }, changed.data.token);
  assert.equal(created.ok, true);
  const hash = user(env, 'officer').password_hash;
  const salt = user(env, 'officer').salt;
  const all = JSON.stringify([env.auditRows(), env.plain(env.g('Repository').all('record_history')), env.google.logs]);
  for (const needle of ['guess-attempt-77', env.PASSWORD, 'brand-new-pass-7', hash, salt, created.data.temporary_password]) {
    assert.ok(needle && !all.includes(needle), 'found a value that must not be stored: ' + String(needle).slice(0, 6));
  }
});

// ---- auth.changePassword shares the per-user counter and the pause of sign-in (Reviewer decision on PR #20)

test('five wrong current passwords pause the user: the fifth is AUTH_LOCKED, and sign-in is locked too', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  const change = (current) => env.call('auth.changePassword', { current: current, new: 'brand-new-pass-7' }, token);
  for (let i = 1; i <= 4; i++) assert.equal(change(WRONG).error.code, 'AUTH_FAILED');
  assert.equal(user(env, 'officer').failed_attempts, 4);
  const fifth = change(WRONG);
  assert.equal(fifth.error.code, 'AUTH_LOCKED');
  assert.equal(fifth.error.retry_after, 900);
  assert.equal(env.signInRaw('officer').error.code, 'AUTH_LOCKED');
  // the open session stays valid for other calls
  assert.equal(env.call('auth.me', {}, token).ok, true);
});

test('while paused, changePassword is AUTH_LOCKED with retry_after and computes no hash', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  for (let i = 1; i <= 5; i++) env.signInRaw('officer', WRONG);
  env.minutes(5);
  let calls = 0;
  const H = env.g('Hasher');
  const hash = H.hash;
  const verify = H.verify;
  H.verify = (...a) => { calls++; return verify(...a); };
  H.hash = (...a) => { calls++; return hash(...a); };
  const res = env.call('auth.changePassword', { current: env.PASSWORD, new: 'brand-new-pass-7' }, token);
  assert.equal(res.error.code, 'AUTH_LOCKED');
  assert.equal(res.error.retry_after, 600);
  assert.equal(calls, 0);
  assert.ok(env.auditRows().some((r) => r.event === 'AUTH.PASSWORD_CHANGE.FAILED' && r.result === 'DENIED'));
});

test('wrong sign-in passwords and wrong current passwords share one count', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  const change = (current) => env.call('auth.changePassword', { current: current, new: 'brand-new-pass-7' }, token);
  env.signInRaw('officer', WRONG);
  env.signInRaw('officer', WRONG);
  assert.equal(change(WRONG).error.code, 'AUTH_FAILED');
  assert.equal(user(env, 'officer').failed_attempts, 3);
  env.signInRaw('officer', WRONG);
  assert.equal(change(WRONG).error.code, 'AUTH_LOCKED');
});

test('a successful change clears the counters', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  const change = (current, next) => env.call('auth.changePassword', { current: current, new: next }, token);
  for (let i = 1; i <= 3; i++) assert.equal(change(WRONG, 'brand-new-pass-7').error.code, 'AUTH_FAILED');
  assert.equal(user(env, 'officer').failed_attempts, 3);
  assert.equal(change(env.PASSWORD, 'brand-new-pass-7').ok, true);
  const u = user(env, 'officer');
  assert.ok(!u.failed_attempts && !u.cooldown_until);
});

test('a new password that fails FX-002 is a validation error and is not counted', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  const r = env.call('auth.changePassword', { current: env.PASSWORD, new: 'short1a' }, token);
  assert.equal(r.error.code, 'VALIDATION');
  assert.ok(!user(env, 'officer').failed_attempts);
});

test('the audit cap of 50 per user and day is shared by sign-in and change-password failures', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  const setting = (k, v) => env.g('Repository').transact((uow) => uow.insert('settings', { setting_key: k, value: v, value_type: 'int', version: 1, effective_from: '2026-10-01' }, env.actor));
  setting('CFG-002', '1000');
  for (let i = 1; i <= 30; i++) env.signInRaw('officer', WRONG);
  for (let i = 1; i <= 30; i++) env.call('auth.changePassword', { current: WRONG, new: 'brand-new-pass-7' }, token);
  const events = env.auditRows().map((r) => r.event);
  assert.equal(events.filter((e) => e === 'AUTH.SIGNIN.FAILED').length, 30);
  assert.equal(events.filter((e) => e === 'AUTH.PASSWORD_CHANGE.FAILED').length, 20);
  assert.equal(user(env, 'officer').failed_attempts, 60);
});
