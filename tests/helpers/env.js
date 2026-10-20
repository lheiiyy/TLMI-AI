'use strict';
// A loaded server with TLMI_DB, one invented user per role and an Admin PIN, plus call helpers.
const { setupDb } = require('./db');

const PIN = 'test-pin-9';
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
  env.users = {};
  R.transact((uow) => {
    for (const key of Object.keys(ROLES)) {
      env.users[key] = env.plain(uow.insert('users',
        { display_name: NAMES[key], role: ROLES[key], hr_employee_no: NUMBERS[key] }, env.actor));
    }
  });
  const H = env.g('Hasher');
  const salt = H.newSalt();
  env.g('Props').set('PEPPER', PEPPER);
  env.g('Props').set('ADMIN_PIN_SALT', salt);
  env.g('Props').set('ADMIN_PIN_HASH', H.hash(PIN, salt, PEPPER, 1000));
  env.PIN = PIN;

  // Calls tlmiApi and returns plain data.
  env.call = (method, params, token, extra) => env.plain(env.g('tlmiApi')(Object.assign({ v: 1, rid: 'r1', method, params: params || {}, token }, extra || {})));
  env.signIn = (key) => {
    const res = env.call('auth.signIn', key === 'admin' ? { user_id: env.users[key].id, pin: PIN } : { user_id: env.users[key].id });
    if (!res.ok) throw new Error('sign-in failed in test: ' + JSON.stringify(res));
    return res.data.token;
  };
  env.minutes = (n) => { env.google.clock.now += n * 60000; };
  env.auditRows = () => env.plain(R.all('audit_log'));
  return env;
}

module.exports = { setupApi, PIN, ROLES };
