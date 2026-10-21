'use strict';
// Part 2A bootstrap: initFirstAdmin (empty database) and initAdminPassword (an existing Admin, or one who is locked out).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

const P = (env) => env.g('Props');
const users = (env) => env.plain(env.g('Repository').all('users'));
const OLD_PIN_KEYS = ['ADMIN_PIN_HASH', 'ADMIN_PIN_SALT', 'ADMIN_PIN_FAILS', 'ADMIN_PIN_NEW'];

function ready() {
  const env = setupDb();
  env.g('initSecrets')();
  return env;
}

function firstAdminProps(env, o = {}) {
  P(env).set('FIRST_ADMIN_NAME', o.name === undefined ? '  Owen Owner ' : o.name);
  P(env).set('FIRST_ADMIN_EMPLOYEE_NO', o.no === undefined ? '3001' : o.no);
  P(env).set('FIRST_ADMIN_PASSWORD', o.password === undefined ? 'first-pass-12' : o.password);
}

function addUser(env, v, active) {
  return env.g('Repository').transact((uow) => {
    const u = uow.insert('users', v, env.actor);
    if (active === false) uow.update('users', u.id, {}, { expectedVersion: u.row_version, actor: env.actor, isActive: false });
    return env.plain(u);
  });
}

test('initFirstAdmin creates an Admin who must change the password, and removes its properties', () => {
  const env = ready();
  firstAdminProps(env);
  P(env).set('ADMIN_PIN_HASH', 'old'); P(env).set('ADMIN_PIN_SALT', 'old'); P(env).set('ADMIN_PIN_FAILS', '{}');
  env.g('initFirstAdmin')();
  const u = users(env);
  assert.equal(u.length, 1);
  assert.deepEqual([u[0].display_name, u[0].role, u[0].is_active, u[0].hr_employee_no, u[0].must_change_password], ['Owen Owner', 'Admin', true, '3001', true]);
  assert.match(u[0].password_hash, /^hmac-sha256\$\d+\$[0-9a-f]{64}$/);
  assert.ok(u[0].salt.length >= 32);
  for (const k of ['FIRST_ADMIN_NAME', 'FIRST_ADMIN_EMPLOYEE_NO', 'FIRST_ADMIN_PASSWORD', ...OLD_PIN_KEYS]) assert.equal(P(env).get(k), null, k);
  const audit = env.plain(env.g('Repository').all('audit_log'));
  assert.ok(audit.some((a) => a.event === 'USER.CREATED' && a.entity_id === u[0].id && JSON.parse(a.detail).source === 'initFirstAdmin'));
  const text = JSON.stringify([audit, env.google.logs]);
  assert.ok(!text.includes('first-pass-12') && !text.includes('Owen Owner') && !text.includes(u[0].password_hash));
});

test('initFirstAdmin refuses a password that fails FX-002 and keeps the properties', () => {
  for (const [pw, code] of [['short1a', 'TOO_SHORT'], ['lettersonly', 'NEEDS_DIGIT'], ['1234567890', 'NEEDS_LETTER']]) {
    const env = ready();
    firstAdminProps(env, { password: pw });
    assert.throws(() => env.g('initFirstAdmin')(), (e) => e.message.includes(code) && !e.message.includes(pw));
    assert.equal(users(env).length, 0);
    assert.equal(P(env).get('FIRST_ADMIN_PASSWORD'), pw, 'left in place so that it can be corrected');
    assert.equal(P(env).get('FIRST_ADMIN_NAME'), '  Owen Owner ');
  }
});

test('initFirstAdmin needs a name, a number and the pepper', () => {
  const env = setupDb();
  assert.throws(() => env.g('initFirstAdmin')(), /FIRST_ADMIN_NAME/);
  firstAdminProps(env, { name: '   ' });
  assert.throws(() => env.g('initFirstAdmin')(), /FIRST_ADMIN_NAME/);
  firstAdminProps(env, { no: 'abc' });
  assert.throws(() => env.g('initFirstAdmin')(), /FIRST_ADMIN_EMPLOYEE_NO/);
  firstAdminProps(env);
  assert.throws(() => env.g('initFirstAdmin')(), (e) => e.code === 'CONFIG_MISSING' && e.message.includes('PEPPER'));
  assert.equal(users(env).length, 0);
});

test('initFirstAdmin refuses when an active Admin exists, and changes nothing', () => {
  const env = ready();
  addUser(env, { display_name: 'Existing Admin', role: 'Admin' });
  firstAdminProps(env, { name: 'Second Person' });
  assert.throws(() => env.g('initFirstAdmin')(), /already exists/);
  assert.equal(users(env).length, 1);
  assert.equal(P(env).get('FIRST_ADMIN_NAME'), 'Second Person', 'left in place');
});

test('initFirstAdmin may run when the only Admin is inactive', () => {
  const env = ready();
  addUser(env, { display_name: 'Old Admin', role: 'Admin' }, false);
  firstAdminProps(env, { name: 'New Admin' });
  env.g('initFirstAdmin')();
  assert.equal(users(env).filter((u) => u.is_active && u.role === 'Admin').length, 1);
});

test('initFirstAdmin refuses an employee number that any user already has', () => {
  const env = ready();
  addUser(env, { display_name: 'Pat Retired', role: 'Training Officer', hr_employee_no: '3001' }, false);
  firstAdminProps(env);
  assert.throws(() => env.g('initFirstAdmin')(), /employee number/);
  assert.equal(users(env).length, 1);
});

test('the first Admin signs in with the number and the password, must change it, and can then run the seed', () => {
  const { fillTab } = require('../helpers/sheets');
  const L = require('../fixtures/legacy-copy');
  const env = ready();
  firstAdminProps(env);
  env.g('initFirstAdmin')();
  const ss = env.google.addSpreadsheet(L.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', L.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', L.SEED_OFFICERS);
  P(env).set('LEGACY_COPY_ID', L.LEGACY_ID);
  const call = (m, p, t) => env.plain(env.g('tlmiApi')({ v: 1, method: m, params: p || {}, token: t }));
  assert.equal(call('auth.signIn', { employee_id: '3001', password: 'wrong-pass-1' }).error.code, 'AUTH_FAILED');
  const signIn = call('auth.signIn', { employee_id: '3001', password: 'first-pass-12' });
  assert.equal(signIn.ok, true);
  assert.equal(signIn.data.must_change_password, true);
  assert.equal(call('seed.run', {}, signIn.data.token).error.code, 'FORBIDDEN');
  const changed = call('auth.changePassword', { current: 'first-pass-12', new: 'second-pass-34' }, signIn.data.token);
  const seeded = call('seed.run', {}, changed.data.token);
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  assert.equal(seeded.data.created.locations, 4);
});

// ---- initAdminPassword

function adminProps(env, no, password) {
  P(env).set('ADMIN_EMPLOYEE_NO', no);
  P(env).set('ADMIN_TEMP_PASSWORD', password === undefined ? 'temp-pass-12' : password);
}

test('initAdminPassword sets number and password on the only Admin, who must change it', () => {
  const env = ready();
  const admin = addUser(env, { display_name: 'Existing Admin', role: 'Admin' });
  P(env).set('ADMIN_PIN_HASH', 'old'); P(env).set('ADMIN_PIN_FAILS', '{}');
  adminProps(env, '3001');
  env.g('initAdminPassword')();
  const u = users(env)[0];
  assert.deepEqual([u.id, u.hr_employee_no, u.must_change_password], [admin.id, '3001', true]);
  assert.match(u.password_hash, /^hmac-sha256\$\d+\$/);
  for (const k of ['ADMIN_EMPLOYEE_NO', 'ADMIN_TEMP_PASSWORD', ...OLD_PIN_KEYS]) assert.equal(P(env).get(k), null, k);
  const audit = env.plain(env.g('Repository').all('audit_log'));
  assert.ok(audit.some((a) => a.event === 'USER.PASSWORD_RESET' && a.entity_id === admin.id && JSON.parse(a.detail).source === 'editor'));
  assert.ok(!JSON.stringify([audit, env.google.logs]).includes('temp-pass-12'));
  const call = (m, p) => env.plain(env.g('tlmiApi')({ v: 1, method: m, params: p }));
  assert.equal(call('auth.signIn', { employee_id: '3001', password: 'temp-pass-12' }).data.must_change_password, true);
});

test('initAdminPassword works with two Admins when the number names one', () => {
  const env = ready();
  const one = addUser(env, { display_name: 'Admin One', role: 'Admin', hr_employee_no: '3001' });
  const two = addUser(env, { display_name: 'Admin Two', role: 'Admin', hr_employee_no: '3002' });
  adminProps(env, '3002');
  env.g('initAdminPassword')();
  const byId = Object.fromEntries(users(env).map((u) => [u.id, u]));
  assert.equal(byId[two.id].must_change_password, true);
  assert.match(byId[two.id].password_hash, /^hmac-sha256\$/);
  assert.equal(byId[one.id].password_hash, '', 'the other Admin is untouched');
});

test('initAdminPassword refuses a free number when two active Admins exist, and changes nothing', () => {
  const env = ready();
  addUser(env, { display_name: 'Admin One', role: 'Admin', hr_employee_no: '3001' });
  addUser(env, { display_name: 'Admin Two', role: 'Admin', hr_employee_no: '3002' });
  adminProps(env, '3999');
  assert.throws(() => env.g('initAdminPassword')(), /not exactly one active Admin/);
  assert.ok(users(env).every((u) => !u.password_hash));
  assert.equal(P(env).get('ADMIN_TEMP_PASSWORD'), 'temp-pass-12', 'left in place');
});

test('initAdminPassword refuses a number that belongs to a user who is not an active Admin', () => {
  for (const [role, active] of [['Training Officer', true], ['Admin', false]]) {
    const env = ready();
    addUser(env, { display_name: 'The Admin', role: 'Admin', hr_employee_no: '3001' });
    addUser(env, { display_name: 'Other User', role, hr_employee_no: '3002' }, active);
    adminProps(env, '3002');
    assert.throws(() => env.g('initAdminPassword')(), /not an active Admin/);
    assert.ok(users(env).every((u) => !u.password_hash));
  }
});

test('initAdminPassword unlocks a paused Admin and ends the Admin\'s sessions', () => {
  const { setupApi } = require('../helpers/env');
  const env = setupApi();
  const token = env.signIn('admin');
  for (let i = 1; i <= 5; i++) env.signInRaw('admin', 'wrong-pass-' + i);
  assert.equal(env.signInRaw('admin').error.code, 'AUTH_LOCKED');
  adminProps(env, env.NUMBERS.admin, 'rescue-pass-56');
  env.g('initAdminPassword')();
  const u = env.plain(env.g('Repository').get('users', env.users.admin.id));
  assert.ok(!u.failed_attempts && !u.cooldown_until);
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
  const again = env.call('auth.signIn', { employee_id: env.NUMBERS.admin, password: 'rescue-pass-56' });
  assert.equal(again.ok, true);
  assert.equal(again.data.must_change_password, true);
});

test('initAdminPassword refuses a password that fails FX-002 and a missing number', () => {
  const env = ready();
  addUser(env, { display_name: 'Existing Admin', role: 'Admin' });
  assert.throws(() => env.g('initAdminPassword')(), /ADMIN_EMPLOYEE_NO/);
  adminProps(env, '3001', 'short');
  assert.throws(() => env.g('initAdminPassword')(), /TOO_SHORT/);
  assert.ok(users(env).every((u) => !u.password_hash));
});

test('initAdminPin no longer exists', () => {
  const env = setupDb();
  assert.throws(() => env.g('initAdminPin'), /not defined/);
});
