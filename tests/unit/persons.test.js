'use strict';
// Part 2B, Task 10: PersonService (duplicate candidates, aliases) and persons.get / persons.matchCandidates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

function setup() {
  const env = setupApi();
  env.create = (p) => env.g('Repository').transact((uow) => env.plain(env.g('PersonService').create(uow, { userId: env.actor.userId, now: env.actor.now, today: '2026-10-20' }, p)));
  env.persons = () => env.plain(env.g('Repository').all('persons'));
  env.aliases = () => env.plain(env.g('Repository').all('person_aliases'));
  return env;
}

test('create stores trimmed names and an HR_NO alias', () => {
  const env = setup();
  const p = env.create({ last_name: '  Dela   Cruz ', first_name: ' Juan ', middle_name: ' Pablo', suffix: 'Jr.', hr_employee_no: '4001' });
  assert.match(p.id, /^PER-000001$/);
  assert.deepEqual([p.last_name, p.first_name, p.middle_name, p.suffix, p.hr_employee_no], ['Dela Cruz', 'Juan', 'Pablo', 'Jr.', '4001']);
  assert.equal(p.is_active, true);
  const a = env.aliases();
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].person_id, a[0].alias_type, a[0].value, a[0].valid_from], [p.id, 'HR_NO', '4001', '2026-10-20']);
  assert.equal(env.g('PersonService').displayName(p), 'Juan Pablo Dela Cruz Jr.');
  // no number: no alias
  env.create({ last_name: 'Reyes', first_name: 'Ana' });
  assert.equal(env.aliases().length, 1);
});

test('a same HR number is a VALIDATION error (DUPLICATE), and names are required', () => {
  const env = setup();
  env.create({ last_name: 'Reyes', first_name: 'Ana', hr_employee_no: '4002' });
  assert.throws(() => env.create({ last_name: 'Santos', first_name: 'Luis', hr_employee_no: '4002' }), (e) => e.code === 'VALIDATION' && e.fields[0].code === 'DUPLICATE');
  assert.throws(() => env.create({ last_name: '', first_name: 'Luis' }), (e) => e.code === 'VALIDATION');
  assert.throws(() => env.create({ last_name: 'Santos', first_name: 'Luis', hr_employee_no: '40x2' }), (e) => e.code === 'VALIDATION');
  assert.equal(env.persons().length, 1);
});

test('addAlias adds a name once and never a duplicate for one person', () => {
  const env = setup();
  const p = env.create({ last_name: 'Reyes', first_name: 'Ana' });
  const add = (type, v) => env.g('Repository').transact((uow) => env.plain(env.g('PersonService').addAlias(uow, { userId: 'USR-0001', now: env.actor.now }, p.id, type, v)));
  assert.ok(add('NAME', 'REYES, ANA M.'));
  assert.equal(add('NAME', 'reyes  ana m'), null, 'case, spaces and punctuation do not make a new alias');
  assert.ok(add('NAME', 'REYES ANA MARIE'));
  assert.equal(add('NAME', ''), null);
  assert.ok(add('TEMP', 'TMP-77'));
  assert.equal(env.aliases().filter((a) => a.alias_type === 'NAME').length, 2);
});

test('candidates finds the same name in another case and spacing', () => {
  const env = setup();
  env.create({ last_name: 'Dela Cruz', first_name: 'Juan' });
  env.create({ last_name: 'Reyes', first_name: 'Ana' });
  const C = (input) => env.plain(env.g('PersonService').candidates(env.persons(), env.aliases(), input));
  const c = C({ last_name: 'DELA  CRUZ', first_name: 'juan' });
  assert.deepEqual(c.map((x) => [x.name, x.reason]), [['Juan Dela Cruz', 'SAME_NAME']]);
  // the same words in another order are the same name
  assert.equal(C({ last_name: 'Juan', first_name: 'Dela Cruz' })[0].reason, 'SAME_NAME');
  assert.deepEqual(C({ last_name: 'Garcia', first_name: 'Pedro' }), []);
});

test('candidates finds a name with an extra middle initial as SIMILAR_NAME, and a spelling slip', () => {
  const env = setup();
  env.create({ last_name: 'Dela Cruz', first_name: 'Juan' });
  env.create({ last_name: 'Villanueva', first_name: 'Marites' });
  const C = (input) => env.plain(env.g('PersonService').candidates(env.persons(), env.aliases(), input));
  assert.deepEqual(C({ last_name: 'Dela Cruz', first_name: 'Juan', middle_name: 'P.' }).map((x) => x.reason), ['SIMILAR_NAME']);
  assert.deepEqual(C({ last_name: 'Villanueba', first_name: 'Marites' }).map((x) => [x.name, x.reason]), [['Marites Villanueva', 'SIMILAR_NAME']]);
});

test('candidates finds the same HR number first, also through an HR_NO alias, and a NAME alias', () => {
  const env = setup();
  const p = env.create({ last_name: 'Reyes', first_name: 'Ana', hr_employee_no: '4003' });
  env.g('Repository').transact((uow) => {
    env.g('PersonService').addAlias(uow, { userId: 'USR-0001', now: env.actor.now }, p.id, 'NAME', 'MARIA ANA REYES');
    env.g('PersonService').addAlias(uow, { userId: 'USR-0001', now: env.actor.now }, p.id, 'HR_NO', '4999');
  });
  const C = (input) => env.plain(env.g('PersonService').candidates(env.persons(), env.aliases(), input));
  assert.deepEqual(C({ last_name: 'Someone', first_name: 'Else', hr_employee_no: '4003' }).map((x) => x.reason), ['SAME_HR_NO']);
  assert.deepEqual(C({ last_name: 'Someone', first_name: 'Else', hr_employee_no: '4999' }).map((x) => x.reason), ['SAME_HR_NO']);
  assert.deepEqual(C({ last_name: 'Reyes', first_name: 'Maria Ana' }).map((x) => x.reason), ['SAME_NAME']);
  // the strongest reason wins: same number and same name is one entry, SAME_HR_NO
  assert.deepEqual(C({ last_name: 'Reyes', first_name: 'Ana', hr_employee_no: '4003' }).map((x) => x.reason), ['SAME_HR_NO']);
});

test('persons.matchCandidates and persons.get are open to every role and return aliases and enrollments', () => {
  const env = setup();
  const p = env.create({ last_name: 'Reyes', first_name: 'Ana', hr_employee_no: '4004' });
  env.g('Repository').transact((uow) => uow.insert('tl_enrollments', {
    person_id: p.id, mother_location_id: 'LOC-0001', entry_date: '2026-09-01', deadline: '2026-12-01', status: 'Entry',
  }, env.actor, 2026));
  for (const role of ['officer', 'supervisor', 'manager', 'senior', 'admin']) {
    const token = env.signIn(role);
    const got = env.call('persons.get', { id: p.id }, token);
    assert.equal(got.ok, true, role + JSON.stringify(got));
    assert.equal(got.data.person.display_name, 'Ana Reyes');
    assert.equal(got.data.aliases.length, 1);
    assert.deepEqual(got.data.enrollments.map((e) => [e.id, e.status]), [['TLE-2026-0001', 'Entry']]);
    const m = env.call('persons.matchCandidates', { last_name: 'REYES', first_name: 'ana' }, token);
    assert.deepEqual(m.data.map((x) => x.reason), ['SAME_NAME']);
  }
  assert.equal(env.call('persons.get', { id: 'PER-999999' }, env.signIn('officer')).error.code, 'NOT_FOUND');
  assert.equal(env.call('persons.get', { id: p.id }).error.code, 'AUTH_REQUIRED');
});
