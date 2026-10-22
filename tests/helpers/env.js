'use strict';
// A loaded server with TLMI_DB, one invented user per role (employee number and a test-only password), plus call helpers.
const { setupDb } = require('./db');

// Test code only: this password protects an in-memory fake and nothing else.
const PASSWORD = 'test-pass-9';
const PEPPER = 'test-pepper';
const ROLES = {
  officer: 'Training Officer',
  supervisor: 'Training Supervisor',
  manager: 'Training Manager',
  senior: 'Senior Training Manager',
  admin: 'Admin',
};
const NAMES = { officer: 'Olivia Tester', supervisor: 'Sam Supervisor', manager: 'Mia Manager', senior: 'Sean Senior', admin: 'Ada Admin' };
const NUMBERS = { officer: '1001', supervisor: '1002', manager: '1003', senior: '1004', admin: '1005' };

function setupApi(opts = {}) {
  const env = setupDb(opts);
  const R = env.g('Repository');
  const H = env.g('Hasher');
  // A low iteration count keeps the suite fast; the count is stored in every hash, so sign-in works the same.
  H.DEFAULT_ITERATIONS = 1000;
  env.g('Props').set('PEPPER', PEPPER);
  env.users = {};
  R.transact((uow) => {
    for (const key of Object.keys(ROLES)) {
      const salt = H.newSalt();
      env.users[key] = env.plain(uow.insert('users', {
        display_name: NAMES[key], role: ROLES[key], hr_employee_no: NUMBERS[key],
        password_hash: H.hash(PASSWORD, salt, PEPPER), salt: salt, must_change_password: false,
      }, env.actor));
    }
  });
  env.PASSWORD = PASSWORD;
  env.NUMBERS = NUMBERS;

  // Calls tlmiApi and returns plain data.
  env.call = (method, params, token, extra) => env.plain(env.g('tlmiApi')(Object.assign({ v: 1, rid: 'r1', method, params: params || {}, token }, extra || {})));
  env.signInRaw = (key, password) => env.call('auth.signIn', { employee_id: NUMBERS[key], password: password === undefined ? PASSWORD : password });
  env.signIn = (key) => {
    const res = env.signInRaw(key);
    if (!res.ok) throw new Error('sign-in failed in test: ' + JSON.stringify(res));
    return res.data.token;
  };
  env.minutes = (n) => { env.google.clock.now += n * 60000; };
  env.auditRows = () => env.plain(R.all('audit_log'));
  return env;
}

module.exports = { setupApi, PASSWORD, NUMBERS, ROLES, NAMES };
