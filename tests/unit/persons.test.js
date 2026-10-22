'use strict';
// Part 2B, Task 10: the person service (spec section 9). Invented names only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

function create(env, fields) {
  return env.plain(env.g('Repository').transact((uow) => env.g('PersonService').create(uow, { userId: 'USR-0001', now: env.actor.now, requestId: 'r' }, fields)));
}
const rows = (env, t) => env.plain(env.g('Repository').all(t));

test('create stores trimmed names and an HR_NO alias', () => {
  const env = setupApi();
  const p = create(env, { last_name: '  Dela   Cruz ', first_name: ' Juan ', middle_name: ' Pedro', suffix: 'Jr.', hr_employee_no: ' 12345 ' });
  assert.equal(p.id, 'PER-000001');
  assert.deepEqual([p.last_name, p.first_name, p.middle_name, p.suffix, p.hr_employee_no], ['Dela Cruz', 'Juan', 'Pedro', 'Jr.', '12345']);
  const al = rows(env, 'person_aliases');
  assert.equal(al.length, 1);
  assert.deepEqual([al[0].person_id, al[0].alias_type, al[0].value, al[0].valid_from], [p.id, 'HR_NO', '12345', '2026-10-20']);
  assert.equal(env.g('PersonService').displayName(env.plain(p)), 'Juan Pedro Dela Cruz Jr.');
  const nobody = create(env, { last_name: 'Reyes', first_name: 'Ana' });
  assert.equal(nobody.hr_employee_no, '');
  assert.equal(rows(env, 'person_aliases').length, 1);
});

test('a same HR number is VALIDATION', () => {
  const env = setupApi();
  create(env, { last_name: 'Reyes', first_name: 'Ana', hr_employee_no: '777' });
  assert.throws(() => create(env, { last_name: 'Santos', first_name: 'Bea', hr_employee_no: '777' }),
    (e) => e.code === 'VALIDATION' && e.fields[0].path === 'hr_employee_no');
  assert.equal(rows(env, 'persons').length, 1);
});

test('addAlias adds no duplicate alias for one person', () => {
  const env = setupApi();
  const p = create(env, { last_name: 'Reyes', first_name: 'Ana' });
  const add = (type, value) => env.g('Repository').transact((uow) => env.g('PersonService').addAlias(uow, { userId: 'USR-0001', now: env.actor.now }, p.id, type, value, '2026-10-20'));
  assert.ok(add('NAME', 'REYES, ANA'));
  assert.equal(add('NAME', 'reyes,  ana'), null);
  assert.ok(add('NAME', 'ANA M REYES'));
  assert.equal(rows(env, 'person_aliases').length, 2);
});

function people(env) {
  create(env, { last_name: 'Dela Cruz', first_name: 'Juan', hr_employee_no: '5001' });
  create(env, { last_name: 'Reyes', first_name: 'Ana', middle_name: 'Maria' });
  create(env, { last_name: 'Santos', first_name: 'Bea' });
}
const cand = (env, input) => {
  const R = env.g('Repository');
  return env.plain(env.g('PersonService').candidates(R.all('persons'), R.all('person_aliases'), input));
};

test('candidates finds the same name in another case and spacing', () => {
  const env = setupApi();
  people(env);
  const res = cand(env, { last_name: 'DELA  CRUZ', first_name: 'juan' });
  assert.deepEqual(res.map((c) => [c.person_id, c.reason]), [['PER-000001', 'SAME_NAME']]);
  assert.equal(res[0].name, 'Juan Dela Cruz');
});

test('candidates finds the same HR number first', () => {
  const env = setupApi();
  people(env);
  const res = cand(env, { last_name: 'Other', first_name: 'Name', hr_employee_no: '5001' });
  assert.deepEqual(res.map((c) => [c.person_id, c.reason]), [['PER-000001', 'SAME_HR_NO']]);
});

test('candidates finds a name with an extra middle initial as SIMILAR_NAME', () => {
  const env = setupApi();
  people(env);
  const res = cand(env, { last_name: 'Dela Cruz', first_name: 'Juan', middle_name: 'P.' });
  assert.deepEqual(res.map((c) => [c.person_id, c.reason]), [['PER-000001', 'SIMILAR_NAME']]);
  assert.deepEqual(cand(env, { last_name: 'Nobody', first_name: 'Else' }), []);
});

test('candidates also finds a name held as a NAME alias', () => {
  const env = setupApi();
  people(env);
  env.g('Repository').transact((uow) => env.g('PersonService').addAlias(uow, { userId: 'USR-0001', now: env.actor.now }, 'PER-000003', 'NAME', 'BEA SANTOS-LIM', '2026-10-20'));
  const res = cand(env, { last_name: 'Santos Lim', first_name: 'Bea' });
  assert.deepEqual(res.map((c) => [c.person_id, c.reason]), [['PER-000003', 'SAME_NAME']]);
});

test('persons.get returns aliases and enrollments', () => {
  const env = setupApi();
  people(env);
  env.g('Repository').transact((uow) => {
    uow.insert('tl_enrollments', {
      person_id: 'PER-000001', mother_location_id: 'LOC-0001', station_id: 'STN-0001', entry_date: '2026-10-01', deadline: '2027-01-01', status: 'Entry',
    }, env.actor, 2026);
  });
  const t = env.signIn('officer');
  const res = env.call('persons.get', { id: 'PER-000001' }, t);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.person.last_name, 'Dela Cruz');
  assert.equal(res.data.name, 'Juan Dela Cruz');
  assert.deepEqual(res.data.aliases.map((a) => [a.alias_type, a.value]), [['HR_NO', '5001']]);
  assert.deepEqual(res.data.enrollments.map((e) => [e.id, e.status]), [['TLE-2026-0001', 'Entry']]);
  assert.equal(env.call('persons.get', { id: 'PER-009999' }, t).error.code, 'NOT_FOUND');
});

test('persons.matchCandidates is open to every role and returns proposals only', () => {
  const env = setupApi();
  people(env);
  for (const role of ['officer', 'supervisor', 'manager', 'senior', 'admin']) {
    const res = env.call('persons.matchCandidates', { last_name: 'Reyes', first_name: 'Ana', middle_name: 'Maria' }, env.signIn(role));
    assert.equal(res.ok, true, role);
    assert.deepEqual(res.data.map((c) => c.reason), ['SAME_NAME']);
  }
  assert.equal(rows(env, 'persons').length, 3);
});
