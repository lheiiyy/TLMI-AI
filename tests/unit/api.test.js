'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi, ROLES } = require('../helpers/env');

test('ping needs no token', () => {
  const env = setupApi();
  const res = env.call('system.ping');
  assert.equal(res.ok, true);
  assert.equal(res.data.pong, true);
  assert.equal(res.meta.rid, 'r1');
  assert.ok(res.meta.request_id);
  assert.match(res.meta.server_time, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(res.meta.server_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('unknown field is VALIDATION', () => {
  const env = setupApi();
  const res = env.call('system.ping', {}, undefined, { extra: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'VALIDATION');
  assert.equal(res.error.fields[0].path, 'extra');
  const res2 = env.call('system.ping', { junk: 1 });
  assert.equal(res2.error.code, 'VALIDATION');
});

test('unknown method is NOT_FOUND', () => {
  const env = setupApi();
  assert.equal(env.call('nope.nothing').error.code, 'NOT_FOUND');
});

test('bad envelope is VALIDATION', () => {
  const env = setupApi();
  const send = (r) => env.plain(env.g('tlmiApi')(r));
  assert.equal(send(null).error.code, 'VALIDATION');
  assert.equal(send('x').error.code, 'VALIDATION');
  assert.equal(send({ v: 2, method: 'system.ping' }).error.code, 'VALIDATION');
  assert.equal(send({ v: 1 }).error.code, 'VALIDATION');
});

test('no token on a protected method is AUTH_REQUIRED', () => {
  const env = setupApi();
  assert.equal(env.call('auth.me').error.code, 'AUTH_REQUIRED');
  assert.equal(env.call('auth.me', {}, 'not-a-real-token').error.code, 'SESSION_EXPIRED');
});

test('idle for 31 minutes is SESSION_EXPIRED, activity keeps it alive', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  env.minutes(29);
  assert.equal(env.call('auth.me', {}, token).ok, true);
  env.minutes(29);
  assert.equal(env.call('auth.me', {}, token).ok, true);
  env.minutes(31);
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
});

test('6 hours after issue is SESSION_EXPIRED even if active', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  for (let i = 0; i < 17; i++) {
    env.minutes(20);
    assert.equal(env.call('auth.me', {}, token).ok, true, 'step ' + i);
  }
  env.minutes(25);
  assert.equal(env.call('auth.me', {}, token).error.code, 'SESSION_EXPIRED');
});

test('deactivated user with a live token is refused', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  env.g('Repository').transact((uow) => uow.update('users', env.users.officer.id, {}, { expectedVersion: uow.get('users', env.users.officer.id).row_version, actor: env.actor, isActive: false }));
  env.minutes(2);
  assert.equal(env.call('auth.me', {}, token).error.code, 'AUTH_REQUIRED');
});

test('role change takes effect on the next call', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  assert.equal(env.call('audit.list', {}, token).error.code, 'FORBIDDEN');
  env.g('Repository').transact((uow) => uow.update('users', env.users.officer.id, { role: 'Senior Training Manager' }, { expectedVersion: uow.get('users', env.users.officer.id).row_version, actor: env.actor }));
  env.minutes(2);
  assert.equal(env.call('audit.list', {}, token).ok, true);
});

test('every method x every role matches the permission table', () => {
  const env = setupApi();
  const registry = env.plain(Object.fromEntries(Object.entries(env.g('Api').registry()).map(([k, v]) => [k, { auth: v.auth }])));
  const perms = env.plain(env.g('AuthService').PERMISSIONS);
  // auth.signOut ends the token used for the rest of the loop, so it goes last.
  const protectedMethods = Object.keys(registry).filter((m) => registry[m].auth !== false).sort()
    .sort((a, b) => (a === 'auth.signOut') - (b === 'auth.signOut'));
  assert.deepEqual(Object.keys(perms).sort(), protectedMethods.slice().sort(), 'every protected method has exactly one permission entry');
  for (const [role, label] of Object.entries(ROLES)) {
    const token = env.signIn(role);
    for (const m of protectedMethods) {
      const res = env.call(m, {}, token);
      const allowed = perms[m].includes(label);
      if (allowed) assert.notEqual(res.error && res.error.code, 'FORBIDDEN', label + ' should be allowed ' + m);
      else assert.equal(res.error && res.error.code, 'FORBIDDEN', label + ' should be refused ' + m);
    }
  }
});

test('a method missing from the permission table is denied', () => {
  const env = setupApi();
  const token = env.signIn('admin');
  const reg = env.g('Api').registry;
  const orig = reg();
  env.g('Api').registry = () => Object.assign({}, orig, { 'x.unlisted': { kind: 'R', params: {}, handler: () => ({ ok: 1 }) } });
  assert.equal(env.call('x.unlisted', {}, token).error.code, 'FORBIDDEN');
});

test('audit.list as Senior Training Manager returns rows without hr_employee_no', () => {
  const env = setupApi();
  env.signIn('officer');
  const seniorToken = env.signIn('senior');
  const rows = env.call('audit.list', {}, seniorToken).data;
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.ok(!('hr_employee_no' in r));
  assert.ok(!JSON.stringify(rows).includes('1001'));
  const adminRows = env.call('audit.list', {}, env.signIn('admin')).data;
  assert.ok(adminRows.some((r) => r.hr_employee_no === '1001'));
});

test('audit.list writes AUDIT.VIEWED and pages with meta.page', () => {
  const env = setupApi();
  env.signIn('officer');
  const token = env.signIn('admin');
  const res = env.call('audit.list', { page_size: 1 }, token);
  assert.equal(res.data.length, 1);
  assert.ok(res.meta.page.next_cursor);
  assert.ok(env.auditRows().some((r) => r.event === 'AUDIT.VIEWED'));
});

test('response never contains a sheet id or stack', () => {
  const env = setupApi();
  const token = env.signIn('admin');
  env.g('AuditService').list = () => { throw new Error('fake-db-id exploded at Repository.gs:12'); };
  const res = env.call('audit.list', {}, token);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'SERVER');
  const text = JSON.stringify(res);
  for (const bad of ['fake-db-id', 'exploded', 'Repository.gs', 'stack', ' at ']) assert.ok(!text.includes(bad), bad);
  assert.ok(res.meta.request_id);
});

test('FORBIDDEN is audited with result DENIED', () => {
  const env = setupApi();
  const token = env.signIn('officer');
  assert.equal(env.call('audit.list', {}, token).error.code, 'FORBIDDEN');
  const row = env.auditRows().find((r) => r.event === 'API.FORBIDDEN');
  assert.ok(row);
  assert.equal(row.result, 'DENIED');
  assert.equal(row.user_id, env.users.officer.id);
  assert.equal(row.entity, 'audit.list');
});

test('a VALIDATION failure is not audited', () => {
  const env = setupApi();
  const token = env.signIn('admin');
  const before = env.auditRows().length;
  assert.equal(env.call('audit.list', { page_size: 99 }, token).error.code, 'VALIDATION');
  assert.equal(env.auditRows().length, before);
});

test('doGet serves the index page', () => {
  const env = setupApi();
  const page = env.g('doGet')();
  assert.equal(page.name, 'index');
  assert.equal(page.meta.viewport, 'width=device-width, initial-scale=1');
});

test('list helpers: history.get is Admin only and returns change rows', () => {
  const env = setupApi();
  assert.equal(env.call('history.get', { entity: 'users', id: env.users.officer.id }, env.signIn('senior')).error.code, 'FORBIDDEN');
  const res = env.call('history.get', { entity: 'users', id: env.users.officer.id }, env.signIn('admin'));
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, []);
});
