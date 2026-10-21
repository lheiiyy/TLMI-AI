'use strict';
// The real server code (src/server/*.gs) over fake Google services, with invented data. Used by the dev server
// (localhost, mock transport) and by the browser tests. No Google account and no real sheet is involved.
const { loadServer } = require('../tests/helpers/loader');
const { fillTab } = require('../tests/helpers/sheets');
const legacy = require('../tests/fixtures/legacy-copy');
const master = require('../tests/fixtures/master-log');

// Test code only. This invented password protects an in-memory fake and nothing else.
const TEST_PASSWORD = 'TEST-ONLY-Pass-1';
const TEST_ADMIN_NO = '9105';
// name, role, employee number, must change the password at the first sign-in
const USERS = [
  ['Olivia Tester', 'Training Officer', '9101', false],
  ['Sam Supervisor', 'Training Supervisor', '9102', false],
  ['Mia Manager', 'Training Manager', '9103', false],
  ['Sean Senior', 'Senior Training Manager', '9104', false],
  ['Ada Admin', 'Admin', TEST_ADMIN_NO, false],
  ['Tina Temporary', 'Training Officer', '9106', true],
];

function createEnv() {
  const env = loadServer();
  const { g, google } = env;
  google.addSpreadsheet('dev-db', 'TLMI_DB (fake)');
  const copy = google.addSpreadsheet(legacy.LEGACY_ID, 'legacy copy (fake)');
  fillTab(copy, 'SETTINGS', legacy.SETTINGS);
  fillTab(copy, 'SEED_OFFICERS', legacy.SEED_OFFICERS);
  fillTab(copy, 'MASTER_LOG', [master.MASTER_LOG_HEADER].concat(master.MASTER_LOG_ROWS));
  fillTab(copy, 'UNIFORM_LOG', [master.UNIFORM_LOG_HEADER].concat(master.UNIFORM_LOG_ROWS));
  google.addSpreadsheet('dev-review', 'review (fake)');
  const P = g('Props');
  P.set('ENV', 'DEV');
  P.set('TLMI_DB_ID', 'dev-db');
  P.set('LEGACY_COPY_ID', legacy.LEGACY_ID);
  P.set('REVIEW_SHEET_ID', 'dev-review');

  // What the owner does once, in the editor: setup, initSecrets.
  g('setup')();
  g('initSecrets')();

  // One invented user per role, with the test password (the low iteration count keeps the dev server quick).
  const H = g('Hasher');
  H.DEFAULT_ITERATIONS = 1000;
  g('Repository').transact((uow) => {
    USERS.forEach(([name, role, no, must]) => {
      const salt = H.newSalt();
      uow.insert('users', {
        display_name: name, role: role, hr_employee_no: no, password_hash: H.hash(TEST_PASSWORD, salt, P.get('PEPPER')), salt: salt, must_change_password: must,
      }, { userId: 'USR-0000', now: '2026-10-20T04:00:00.000Z' });
    });
  });

  env.handle = (request) => env.plain(g('tlmiApi')(request));
  // The seed, through the API as Admin.
  const signIn = env.handle({ v: 1, method: 'auth.signIn', params: { employee_id: TEST_ADMIN_NO, password: TEST_PASSWORD } });
  if (!signIn.ok) throw new Error('dev environment: Admin sign-in failed');
  const seeded = env.handle({ v: 1, method: 'seed.run', params: {}, token: signIn.data.token });
  if (!seeded.ok) throw new Error('dev environment: seed failed: ' + JSON.stringify(seeded.error));
  env.handle({ v: 1, method: 'auth.signOut', params: {}, token: signIn.data.token });
  return env;
}

module.exports = { createEnv, TEST_PASSWORD, TEST_ADMIN_NO, USERS };
