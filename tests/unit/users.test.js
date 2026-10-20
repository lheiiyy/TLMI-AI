'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

function ok(env, token, method, params) {
  const r = env.call(method, params, token);
  assert.equal(r.ok, true, method + ' -> ' + JSON.stringify(r));
  return r.data;
}

test('create then list users, hash and salt are never returned', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const u = ok(env, t, 'users.create', { display_name: 'New Person', role: 'Training Officer', hr_employee_no: '2001' });
  assert.equal(u.id, 'USR-0006');
  assert.equal(u.is_active, true);
  env.g('Repository').transact((uow) => uow.update('users', u.id, {}, { expectedVersion: 1, actor: env.actor }));
  env.sheet('users');
  // put a hash on a row directly, as Phase 2 will, and check no method returns it
  const sheet = env.sheet('users');
  const cols = env.plain(env.g('Schema').columns('users'));
  const row = 2 + 5;
  sheet.getRange(row, cols.indexOf('password_hash') + 1).setValues([['hmac-sha256$1$abcd']]);
  sheet.getRange(row, cols.indexOf('salt') + 1).setValues([['salt-value-77']]);
  const all = JSON.stringify([env.call('users.list', {}, t), env.call('users.get', { id: u.id }, t), env.call('users.update', { id: u.id, row_version: 1, patch: { display_name: 'New Person 2' } }, t)]);
  assert.ok(!all.includes('abcd') && !all.includes('salt-value-77') && !all.includes('password_hash'));
  assert.equal(env.call('users.list', {}, t).data.length, 6);
  assert.equal(env.call('users.list', { filters: { role: 'Admin' } }, t).data.length, 1);
  assert.equal(env.call('users.list', { q: '2001' }, t).data.length, 1);
});

test('hash, salt and other columns cannot be written through the API', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const id = env.users.officer.id;
  for (const field of ['password_hash', 'salt', 'is_active', 'row_version', 'id']) {
    const r = env.call('users.update', { id, row_version: 1, patch: { [field]: 'x' } }, t);
    assert.equal(r.error.code, 'VALIDATION', field);
  }
  assert.equal(env.call('users.create', { display_name: 'A', role: 'Admin', password_hash: 'x' }, t).error.code, 'VALIDATION');
  assert.equal(env.call('users.create', { display_name: 'A', role: 'Boss' }, t).error.code, 'VALIDATION');
});

test('last Admin cannot be deactivated or demoted', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const id = env.users.admin.id;
  const off = env.call('users.deactivate', { id, row_version: 1 }, t);
  assert.equal(off.error.code, 'VALIDATION');
  assert.equal(off.error.fields[0].code, 'LAST_ADMIN');
  assert.equal(env.plain(env.g('Repository').get('users', id)).is_active, true);
  // a second Admin: the first may now be demoted, by the second
  assert.equal(env.call('users.update', { id: env.users.officer.id, row_version: 1, patch: { role: 'Admin' } }, t).ok, true);
  const second = env.call('auth.signIn', { user_id: env.users.officer.id, pin: env.PIN });
  assert.equal(second.ok, true);
  assert.equal(env.call('users.update', { id, row_version: 1, patch: { role: 'Training Manager' } }, second.data.token).ok, true);
  // the second Admin is now the last one
  const self = env.call('users.deactivate', { id: env.users.officer.id, row_version: 2 }, second.data.token);
  assert.equal(self.error.fields[0].code, 'LAST_ADMIN');
});

test('the last active Admin check ignores an inactive Admin', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const second = ok(env, t, 'users.create', { display_name: 'Second Admin', role: 'Admin' });
  ok(env, t, 'users.deactivate', { id: second.id, row_version: 1 });
  assert.equal(env.call('users.deactivate', { id: env.users.admin.id, row_version: 1 }, t).error.fields[0].code, 'LAST_ADMIN');
  ok(env, t, 'users.reactivate', { id: second.id, row_version: 2 });
  assert.equal(ok(env, t, 'users.deactivate', { id: env.users.admin.id, row_version: 1 }).is_active, false);
});

test('user cannot change own role, and the refusal is audited', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const r = env.call('users.update', { id: env.users.admin.id, row_version: 1, patch: { role: 'Training Officer' } }, t);
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.ok(env.auditRows().some((a) => a.event === 'API.FORBIDDEN' && a.entity === 'users.update'));
  assert.equal(ok(env, t, 'users.update', { id: env.users.admin.id, row_version: 1, patch: { display_name: 'Ada A. Admin' } }).display_name, 'Ada A. Admin');
});

test('a role change and a deactivation take effect at once', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const sup = env.signIn('supervisor');
  assert.equal(env.call('audit.list', {}, sup).error.code, 'FORBIDDEN');
  ok(env, admin, 'users.update', { id: env.users.supervisor.id, row_version: 1, patch: { role: 'Senior Training Manager' } });
  assert.equal(env.call('audit.list', {}, sup).ok, true);
  ok(env, admin, 'users.deactivate', { id: env.users.supervisor.id, row_version: 2 });
  assert.equal(env.call('audit.list', {}, sup).error.code, 'AUTH_REQUIRED');
  assert.equal(env.call('auth.signIn', { user_id: env.users.supervisor.id }).error.code, 'AUTH_FAILED');
  ok(env, admin, 'users.reactivate', { id: env.users.supervisor.id, row_version: 3 });
  assert.equal(env.call('auth.signIn', { user_id: env.users.supervisor.id }).ok, true);
});

test('hr_employee_no is unique when present', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const dup = env.call('users.create', { display_name: 'Twin', role: 'Training Officer', hr_employee_no: '1001' }, t);
  assert.equal(dup.error.code, 'VALIDATION');
  assert.equal(dup.error.fields[0].code, 'DUPLICATE');
  ok(env, t, 'users.create', { display_name: 'No Number One', role: 'Training Officer' });
  ok(env, t, 'users.create', { display_name: 'No Number Two', role: 'Training Officer' });
  assert.equal(env.call('users.update', { id: env.users.manager.id, row_version: 1, patch: { hr_employee_no: '1001' } }, t).error.code, 'VALIDATION');
});

test('user changes are written to record_history and the audit log', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  ok(env, t, 'users.update', { id: env.users.manager.id, row_version: 1, patch: { role: 'Senior Training Manager', display_name: 'Mia M.' } });
  const hist = env.call('history.get', { entity: 'users', id: env.users.manager.id }, t).data;
  assert.deepEqual(hist.map((h) => h.field).sort(), ['display_name', 'role']);
  const row = env.auditRows().find((a) => a.event === 'USER.UPDATED');
  assert.deepEqual(JSON.parse(row.detail).changed.sort(), ['display_name', 'role']);
  assert.ok(env.auditRows().some((a) => a.event === 'USER.CREATED') === false);
  ok(env, t, 'users.create', { display_name: 'Created Now', role: 'Training Officer' });
  assert.ok(env.auditRows().some((a) => a.event === 'USER.CREATED'));
});

test('non-Admin roles are FORBIDDEN on every users method, stale versions CONFLICT', () => {
  const env = setupApi();
  const sen = env.signIn('senior');
  for (const m of ['users.list', 'users.get', 'users.create', 'users.update', 'users.deactivate', 'users.reactivate']) {
    assert.equal(env.call(m, {}, sen).error.code, 'FORBIDDEN', m);
  }
  const t = env.signIn('admin');
  ok(env, t, 'users.update', { id: env.users.manager.id, row_version: 1, patch: { display_name: 'M2' } });
  const r = env.call('users.update', { id: env.users.manager.id, row_version: 1, patch: { display_name: 'M3' } }, t);
  assert.equal(r.error.code, 'CONFLICT');
  assert.equal(r.error.current.row_version, 2);
});
