'use strict';
// The real server code (src/server/*.gs) over fake Google services, with invented data. Used by the dev server
// (localhost, mock transport) and by the browser tests. No Google account and no real sheet is involved.
const { loadServer } = require('../tests/helpers/loader');
const { fillTab } = require('../tests/helpers/sheets');
const legacy = require('../tests/fixtures/legacy-copy');
const master = require('../tests/fixtures/master-log');

// Test code only. This PIN protects an in-memory fake and nothing else.
const TEST_ADMIN_PIN = 'TEST-ONLY-PIN-1';
const USERS = [
  ['Olivia Tester', 'Training Officer', '9101'],
  ['Sam Supervisor', 'Training Supervisor', '9102'],
  ['Mia Manager', 'Training Manager', '9103'],
  ['Sean Senior', 'Senior Training Manager', '9104'],
  ['Ada Admin', 'Admin', '9105'],
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

  // What the owner does once, in the editor: setup, initSecrets, initAdminPin.
  g('setup')();
  g('initSecrets')();
  P.set('ADMIN_PIN_NEW', TEST_ADMIN_PIN);
  g('initAdminPin')();

  // One invented user per role, as the owner would add the first Admin.
  g('Repository').transact((uow) => {
    USERS.forEach(([name, role, no]) => uow.insert('users', { display_name: name, role: role, hr_employee_no: no }, { userId: 'USR-0000', now: '2026-10-20T04:00:00.000Z' }));
  });

  env.handle = (request) => env.plain(g('tlmiApi')(request));
  // The seed, through the API as Admin.
  const adminId = env.plain(g('Repository').all('users')).find((u) => u.role === 'Admin').id;
  const signIn = env.handle({ v: 1, method: 'auth.signIn', params: { user_id: adminId, pin: TEST_ADMIN_PIN } });
  if (!signIn.ok) throw new Error('dev environment: Admin sign-in failed');
  const seeded = env.handle({ v: 1, method: 'seed.run', params: {}, token: signIn.data.token });
  if (!seeded.ok) throw new Error('dev environment: seed failed: ' + JSON.stringify(seeded.error));
  env.handle({ v: 1, method: 'auth.signOut', params: {}, token: signIn.data.token });
  return env;
}

module.exports = { createEnv, TEST_ADMIN_PIN, USERS };
