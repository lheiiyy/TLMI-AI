'use strict';
// Pins the whole permission table (the PERMISSIONS object in src/server/AuthService.gs). Every change of the table must change
// this map in the same commit, so that the change is a visible line in the diff: an added line must equal a row of the merged
// spec (docs/COLLABORATION.md, 'Merge rule', halt path 5). O = Training Officer, S = Training Supervisor, M = Training Manager,
// Sr = Senior Training Manager, A = Admin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

const ROLE = { O: 'Training Officer', S: 'Training Supervisor', M: 'Training Manager', Sr: 'Senior Training Manager', A: 'Admin' };

const EXPECTED = {
  'audit.list': ['Sr', 'A'],
  'auth.changePassword': ['O', 'S', 'M', 'Sr', 'A'],
  'auth.me': ['O', 'S', 'M', 'Sr', 'A'],
  'auth.signOut': ['O', 'S', 'M', 'Sr', 'A'],
  'brands.create': ['A'],
  'brands.deactivate': ['A'],
  'brands.get': ['O', 'S', 'M', 'Sr', 'A'],
  'brands.list': ['O', 'S', 'M', 'Sr', 'A'],
  'brands.reactivate': ['A'],
  'brands.update': ['A'],
  'components.get': ['A'],
  'components.list': ['A'],
  'components.update': ['A'],
  'history.get': ['A'],
  'importReview.get': ['A'],
  'importReview.run': ['A'],
  'locations.create': ['A'],
  'locations.deactivate': ['A'],
  'locations.get': ['O', 'S', 'M', 'Sr', 'A'],
  'locations.list': ['O', 'S', 'M', 'Sr', 'A'],
  'locations.reactivate': ['A'],
  'locations.update': ['A'],
  'lookups.create': ['A'],
  'lookups.deactivate': ['A'],
  'lookups.get': ['O', 'S', 'M', 'Sr', 'A'],
  'lookups.list': ['O', 'S', 'M', 'Sr', 'A'],
  'lookups.reactivate': ['A'],
  'lookups.update': ['A'],
  'persons.get': ['O', 'S', 'M', 'Sr', 'A'],
  'persons.matchCandidates': ['O', 'S', 'M', 'Sr', 'A'],
  'regions.create': ['A'],
  'regions.deactivate': ['A'],
  'regions.get': ['O', 'S', 'M', 'Sr', 'A'],
  'regions.list': ['O', 'S', 'M', 'Sr', 'A'],
  'regions.reactivate': ['A'],
  'regions.update': ['A'],
  'seed.run': ['A'],
  'settings.get': ['M', 'Sr', 'A'],
  'settings.list': ['M', 'Sr', 'A'],
  'settings.set': ['A'],
  'stations.create': ['A'],
  'stations.deactivate': ['A'],
  'stations.get': ['O', 'S', 'M', 'Sr', 'A'],
  'stations.list': ['O', 'S', 'M', 'Sr', 'A'],
  'stations.reactivate': ['A'],
  'stations.update': ['A'],
  'tl.enroll': ['O', 'S', 'M', 'Sr', 'A'],
  'tl.get': ['O', 'S', 'M', 'Sr', 'A'],
  'tl.history': ['O', 'S', 'M', 'Sr', 'A'],
  'tl.list': ['O', 'S', 'M', 'Sr', 'A'],
  'tl.recordEntryGrade': ['O', 'S', 'M', 'Sr', 'A'],
  'tl.update': ['O', 'S', 'M', 'Sr', 'A'],
  'users.clearCooldown': ['A'],
  'users.create': ['A'],
  'users.deactivate': ['A'],
  'users.get': ['A'],
  'users.list': ['A'],
  'users.reactivate': ['A'],
  'users.resetPassword': ['A'],
  'users.update': ['A'],
};

test('PERMISSIONS equals the expected map', () => {
  const env = setupDb({ tables: false });
  const actual = env.plain(env.g('AuthService').PERMISSIONS);
  const expected = {};
  Object.keys(EXPECTED).forEach((m) => { expected[m] = EXPECTED[m].map((r) => ROLE[r]); });
  const differ = [];
  Object.keys(Object.assign({}, expected, actual)).sort().forEach((m) => {
    const a = JSON.stringify(actual[m]);
    const e = JSON.stringify(expected[m]);
    if (a !== e) differ.push(m + ': table ' + (a || 'missing') + ', expected ' + (e || 'missing'));
  });
  assert.deepEqual(differ, [], 'these methods differ between the table and the pin');
});

test('a method that is not in the table is denied', () => {
  const env = setupDb({ tables: false });
  assert.equal(env.plain(env.g('AuthService').PERMISSIONS)['nothing.here'], undefined);
});
