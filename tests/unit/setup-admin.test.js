'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

test('initFirstAdmin makes the first Admin from a temporary property and removes it', () => {
  const env = setupDb();
  env.g('Props').set('FIRST_ADMIN_NAME', '  Owen Owner ');
  env.g('initFirstAdmin')();
  const users = env.plain(env.g('Repository').all('users'));
  assert.equal(users.length, 1);
  assert.deepEqual([users[0].display_name, users[0].role, users[0].is_active], ['Owen Owner', 'Admin', true]);
  assert.equal(users[0].password_hash, '');
  assert.equal(env.g('Props').get('FIRST_ADMIN_NAME'), null);
  const audit = env.plain(env.g('Repository').all('audit_log'));
  assert.ok(audit.some((a) => a.event === 'USER.CREATED' && a.entity_id === users[0].id && JSON.parse(a.detail).source === 'initFirstAdmin'));
  assert.ok(env.google.logs.some((l) => l.includes('initFirstAdmin')));
  assert.ok(!env.google.logs.join('\n').includes('Owen Owner'));
});

test('initFirstAdmin refuses when an active Admin exists, and changes nothing', () => {
  const env = setupDb();
  env.g('Repository').transact((uow) => uow.insert('users', { display_name: 'Existing Admin', role: 'Admin' }, env.actor));
  env.g('Props').set('FIRST_ADMIN_NAME', 'Second Person');
  assert.throws(() => env.g('initFirstAdmin')(), /already exists/);
  assert.equal(env.plain(env.g('Repository').all('users')).length, 1);
  assert.equal(env.g('Props').get('FIRST_ADMIN_NAME'), 'Second Person', 'left in place');
});

test('initFirstAdmin may run when the only Admin is inactive', () => {
  const env = setupDb();
  env.g('Repository').transact((uow) => {
    const u = uow.insert('users', { display_name: 'Old Admin', role: 'Admin' }, env.actor);
    uow.update('users', u.id, {}, { expectedVersion: 1, actor: env.actor, isActive: false });
  });
  env.g('Props').set('FIRST_ADMIN_NAME', 'New Admin');
  env.g('initFirstAdmin')();
  assert.equal(env.plain(env.g('Repository').all('users')).filter((u) => u.is_active && u.role === 'Admin').length, 1);
});

test('initFirstAdmin needs a name', () => {
  const env = setupDb();
  assert.throws(() => env.g('initFirstAdmin')(), /FIRST_ADMIN_NAME/);
  env.g('Props').set('FIRST_ADMIN_NAME', '   ');
  assert.throws(() => env.g('initFirstAdmin')(), /FIRST_ADMIN_NAME/);
  assert.equal(env.plain(env.g('Repository').all('users')).length, 0);
});

test('the first Admin can sign in with the PIN and run the seed', () => {
  const { setupApi } = require('../helpers/env');
  const { fillTab } = require('../helpers/sheets');
  const L = require('../fixtures/legacy-copy');
  const env = setupDb({ tables: true });
  env.g('Props').set('PEPPER', 'test-pepper');
  env.g('Props').set('ADMIN_PIN_NEW', 'test-pin-12');
  env.g('initAdminPin')();
  env.g('Props').set('FIRST_ADMIN_NAME', 'Owen Owner');
  env.g('initFirstAdmin')();
  const ss = env.google.addSpreadsheet(L.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', L.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', L.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', L.LEGACY_ID);
  const call = (m, p, t) => env.plain(env.g('tlmiApi')({ v: 1, method: m, params: p || {}, token: t }));
  const list = call('auth.listSignInUsers').data;
  assert.deepEqual(list.map((u) => u.display_name), ['Owen Owner']);
  assert.equal(call('auth.signIn', { user_id: list[0].id }).error.code, 'AUTH_FAILED');
  const signIn = call('auth.signIn', { user_id: list[0].id, pin: 'test-pin-12' });
  assert.equal(signIn.ok, true);
  const seeded = call('seed.run', {}, signIn.data.token);
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  assert.equal(seeded.data.created.locations, 4);
  assert.ok(setupApi);
});
