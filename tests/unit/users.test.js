'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

function ok(env, token, method, params) {
  const r = env.call(method, params, token);
  assert.equal(r.ok, true, method + ' -> ' + JSON.stringify(r));
  return r.data;
}

// The current row_version of a user. Signing in notes the time on the user row, so a version is read, not assumed.
const rv = (env, id) => env.plain(env.g('Repository').get('users', id)).row_version;

test('create then list users: hash, salt and counters are never returned', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const created = ok(env, t, 'users.create', { display_name: 'New Person', role: 'Training Officer', hr_employee_no: '2001' });
  const u = created.user;
  assert.equal(u.id, 'USR-0006');
  assert.equal(u.is_active, true);
  assert.equal(u.must_change_password, true);
  const all = JSON.stringify([created.user, env.call('users.list', {}, t), env.call('users.get', { id: u.id }, t),
    env.call('users.update', { id: u.id, row_version: u.row_version, patch: { display_name: 'New Person 2' } }, t)]);
  assert.ok(!/password_hash|"salt"|failed_attempts|cooldown_until|hmac-sha256/.test(all));
  assert.equal(env.call('users.list', {}, t).data.length, 6);
  assert.equal(env.call('users.list', { filters: { role: 'Admin' } }, t).data.length, 1);
  assert.equal(env.call('users.list', { q: '2001' }, t).data.length, 1);
});

test('hash, salt, counters and other columns cannot be written through the API', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const id = env.users.officer.id;
  for (const field of ['password_hash', 'salt', 'must_change_password', 'failed_attempts', 'cooldown_until', 'last_login_at', 'is_active', 'row_version', 'id']) {
    const r = env.call('users.update', { id, row_version: rv(env, id), patch: { [field]: 'x' } }, t);
    assert.equal(r.error.code, 'VALIDATION', field);
  }
  assert.equal(ok(env, t, 'users.deactivate', { id: env.users.manager.id, row_version: rv(env, env.users.manager.id) }).is_active, false);
});

test('create needs a digits-only HR employee number and validates the fields', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  for (const p of [
    { display_name: 'A', role: 'Admin', hr_employee_no: '2001', password_hash: 'x' },
    { display_name: 'A', role: 'Boss', hr_employee_no: '2001' },
    { display_name: 'A', role: 'Training Officer' },
    { display_name: 'A', role: 'Training Officer', hr_employee_no: '' },
    { display_name: 'A', role: 'Training Officer', hr_employee_no: '12ab' },
  ]) {
    assert.equal(env.call('users.create', p, t).error.code, 'VALIDATION', JSON.stringify(p));
  }
});

test('last Admin cannot be deactivated or demoted', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const id = env.users.admin.id;
  const off = env.call('users.deactivate', { id, row_version: rv(env, id) }, t);
  assert.equal(off.error.code, 'VALIDATION');
  assert.equal(off.error.fields[0].code, 'LAST_ADMIN');
  assert.equal(env.plain(env.g('Repository').get('users', id)).is_active, true);
  // a second Admin: the first may now be demoted, by the second
  assert.equal(env.call('users.update', { id: env.users.officer.id, row_version: rv(env, env.users.officer.id), patch: { role: 'Admin' } }, t).ok, true);
  const second = env.signInRaw('officer');
  assert.equal(second.ok, true);
  assert.equal(env.call('users.update', { id, row_version: rv(env, id), patch: { role: 'Training Manager' } }, second.data.token).ok, true);
  // the second Admin is now the last one
  const self = env.call('users.deactivate', { id: env.users.officer.id, row_version: rv(env, env.users.officer.id) }, second.data.token);
  assert.equal(self.error.fields[0].code, 'LAST_ADMIN');
});

test('the last active Admin check ignores an inactive Admin', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const second = ok(env, t, 'users.create', { display_name: 'Second Admin', role: 'Admin', hr_employee_no: '2002' }).user;
  ok(env, t, 'users.deactivate', { id: second.id, row_version: second.row_version });
  assert.equal(env.call('users.deactivate', { id: env.users.admin.id, row_version: rv(env, env.users.admin.id) }, t).error.fields[0].code, 'LAST_ADMIN');
  ok(env, t, 'users.reactivate', { id: second.id, row_version: rv(env, second.id) });
  assert.equal(ok(env, t, 'users.deactivate', { id: env.users.admin.id, row_version: rv(env, env.users.admin.id) }).is_active, false);
});

test('user cannot change own role, and the refusal is audited', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const id = env.users.admin.id;
  const r = env.call('users.update', { id, row_version: rv(env, id), patch: { role: 'Training Officer' } }, t);
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.ok(env.auditRows().some((a) => a.event === 'API.FORBIDDEN' && a.entity === 'users.update'));
  assert.equal(ok(env, t, 'users.update', { id, row_version: rv(env, id), patch: { display_name: 'Ada A. Admin' } }).display_name, 'Ada A. Admin');
});

test('a role change and a deactivation take effect at once', () => {
  const env = setupApi();
  const admin = env.signIn('admin');
  const sup = env.signIn('supervisor');
  const id = env.users.supervisor.id;
  assert.equal(env.call('audit.list', {}, sup).error.code, 'FORBIDDEN');
  ok(env, admin, 'users.update', { id, row_version: rv(env, id), patch: { role: 'Senior Training Manager' } });
  // the role change ended the old session; signing in again gives the new role
  assert.equal(env.call('audit.list', {}, sup).error.code, 'SESSION_EXPIRED');
  const again = env.signIn('supervisor');
  assert.equal(env.call('audit.list', {}, again).ok, true);
  ok(env, admin, 'users.deactivate', { id, row_version: rv(env, id) });
  assert.ok(['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(env.call('audit.list', {}, again).error.code));
  assert.equal(env.signInRaw('supervisor').error.code, 'AUTH_FAILED');
  ok(env, admin, 'users.reactivate', { id, row_version: rv(env, id) });
  assert.equal(env.signInRaw('supervisor').ok, true);
});

test('hr_employee_no is unique, and once set it cannot be removed', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const dup = env.call('users.create', { display_name: 'Twin', role: 'Training Officer', hr_employee_no: '1001' }, t);
  assert.equal(dup.error.code, 'VALIDATION');
  assert.equal(dup.error.fields[0].code, 'DUPLICATE');
  const mid = env.users.manager.id;
  assert.equal(env.call('users.update', { id: mid, row_version: rv(env, mid), patch: { hr_employee_no: '1001' } }, t).error.code, 'VALIDATION');
  const clear = env.call('users.update', { id: mid, row_version: rv(env, mid), patch: { hr_employee_no: '' } }, t);
  assert.equal(clear.error.code, 'VALIDATION');
  assert.equal(clear.error.fields[0].path, 'patch.hr_employee_no');
  assert.equal(env.plain(env.g('Repository').get('users', mid)).hr_employee_no, '1003');
});

test('user changes are written to record_history and the audit log, without the counters', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const id = env.users.manager.id;
  ok(env, t, 'users.update', { id, row_version: rv(env, id), patch: { role: 'Senior Training Manager', display_name: 'Mia M.' } });
  const hist = env.call('history.get', { entity: 'users', id }, t).data;
  assert.deepEqual(hist.map((h) => h.field).sort(), ['display_name', 'role']);
  const row = env.auditRows().find((a) => a.event === 'USER.UPDATED');
  assert.deepEqual(JSON.parse(row.detail).changed.sort(), ['display_name', 'role']);
  assert.ok(env.auditRows().some((a) => a.event === 'USER.CREATED') === false);
  ok(env, t, 'users.create', { display_name: 'Created Now', role: 'Training Officer', hr_employee_no: '2003' });
  assert.ok(env.auditRows().some((a) => a.event === 'USER.CREATED'));
});

test('non-Admin roles are FORBIDDEN on every users method, stale versions CONFLICT', () => {
  const env = setupApi();
  const sen = env.signIn('senior');
  for (const m of ['users.list', 'users.get', 'users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.resetPassword', 'users.clearCooldown']) {
    assert.equal(env.call(m, {}, sen).error.code, 'FORBIDDEN', m);
  }
  const t = env.signIn('admin');
  const id = env.users.manager.id;
  const v = rv(env, id);
  ok(env, t, 'users.update', { id, row_version: v, patch: { display_name: 'M2' } });
  const r = env.call('users.update', { id, row_version: v, patch: { display_name: 'M3' } }, t);
  assert.equal(r.error.code, 'CONFLICT');
  assert.equal(r.error.current.row_version, v + 1);
});
