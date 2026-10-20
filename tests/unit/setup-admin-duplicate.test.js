'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

function addUser(env, name, role, active) {
  env.g('Repository').transact((uow) => {
    const u = uow.insert('users', { display_name: name, role: role }, env.actor);
    if (active === false) uow.update('users', u.id, {}, { expectedVersion: 1, actor: env.actor, isActive: false });
  });
}

test('initFirstAdmin refuses a name that any user already has, active or not, as the seed compares names', () => {
  for (const [existing, typed, active] of [
    ['Olivia Tester', 'olivia   tester', true],
    ['Olivia Tester', '  Olivia Tester ', false],
    ['Pat Retired', 'PAT RETIRED', false],
  ]) {
    const env = setupDb();
    addUser(env, existing, 'Training Officer', active);
    env.g('Props').set('FIRST_ADMIN_NAME', typed);
    assert.throws(() => env.g('initFirstAdmin')(), /already has that name/, existing + ' / ' + typed);
    assert.equal(env.plain(env.g('Repository').all('users')).length, 1, 'no second user');
    assert.equal(env.g('Props').get('FIRST_ADMIN_NAME'), typed, 'left in place so that it can be corrected');
  }
});

test('initFirstAdmin accepts a name that is different from every user', () => {
  const env = setupDb();
  addUser(env, 'Olivia Tester', 'Training Officer', true);
  env.g('Props').set('FIRST_ADMIN_NAME', 'Olivia T. Tester');
  env.g('initFirstAdmin')();
  assert.equal(env.plain(env.g('Repository').all('users')).length, 2);
});
