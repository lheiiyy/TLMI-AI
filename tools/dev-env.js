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
  seedTeamLeaders(env);
  return env;
}

// Invented Team Leader records, one in every state, written through the real API as the real roles. "Today" in the
// fake clock is 2026-10-20. Extension limit (CFG-047) is left unset on purpose: the first extension is refused until Admin sets it.
function seedTeamLeaders(env) {
  const { g } = env;
  const token = {};
  const user = {};
  ['officer', 'supervisor', 'admin'].forEach((r) => {
    const no = { officer: '9101', supervisor: '9102', admin: TEST_ADMIN_NO }[r];
    const res = env.handle({ v: 1, method: 'auth.signIn', params: { employee_id: no, password: TEST_PASSWORD } });
    if (!res.ok) throw new Error('dev environment: sign-in failed for ' + r);
    token[r] = res.data.token;
    user[r] = res.data.user;
  });
  const call = (who, method, params) => {
    const res = env.handle({ v: 1, method: method, params: params, token: token[who] });
    if (!res.ok) throw new Error('dev environment: ' + method + ' failed: ' + JSON.stringify(res.error));
    return res.data;
  };
  const rv = (id) => g('Repository').all('tl_enrollments').find((e) => e.id === id).row_version;
  const ENTRY = ['CMP-0001', 'CMP-0002', 'CMP-0003', 'CMP-0004', 'CMP-0005'];
  const enroll = (last, first, entry, over) => call('officer', 'tl.enroll', Object.assign({
    person: { last_name: last, first_name: first }, mother_location_id: 'LOC-0001', station_id: 'STN-0001', batch_code: 'B-01', entry_date: entry,
  }, over || {})).enrollment.id;
  const grades = (id, entry, score) => ENTRY.forEach((c) => call('officer', 'tl.recordEntryGrade', { id: id, row_version: rv(id), component_id: c, score: score, assessed_on: entry }));
  const check = (id, date, scores) => call('officer', 'tl.recordCertCheck', Object.assign({
    id: id, row_version: rv(id), assessed_on: date, checklist: 95, exam: 90, kitchen_feedback: 92, course_program: 95, officer_ids: [user.officer.id],
  }, scores || {}));

  // Lookups for the quit and the close forms. (Extension limit CFG-047 stays unset.)
  call('admin', 'lookups.create', { category: 'tl_quit_reason', value: 'Resigned', label: 'Resigned', sort_order: 1 });
  call('admin', 'lookups.create', { category: 'tl_quit_reason', value: 'Relocated', label: 'Relocated', sort_order: 2 });
  const quitReason = g('Repository').all('lookups').find((l) => l.category === 'tl_quit_reason' && l.value === 'Resigned').id;

  enroll('Reyes', 'Ana', '2026-10-15');                                   // Entry
  const santos = enroll('Santos', 'Ben', '2026-09-10', { batch_code: 'B-02' });    // Probationary, with a corrected grade
  call('officer', 'tl.recordEntryGrade', { id: santos, row_version: rv(santos), component_id: ENTRY[0], score: 80, assessed_on: '2026-09-12' });
  call('officer', 'tl.recordEntryGrade', { id: santos, row_version: rv(santos), component_id: ENTRY[0], score: 88, assessed_on: '2026-09-12', correction_reason: 'Typed 80, the sheet says 88' });
  ENTRY.slice(1).forEach((c) => call('officer', 'tl.recordEntryGrade', { id: santos, row_version: rv(santos), component_id: c, score: 88, assessed_on: '2026-09-12' }));
  const cruz = enroll('Cruz', 'Carla', '2026-08-20');                     // Certification check, passing
  grades(cruz, '2026-08-21', 90);
  check(cruz, '2026-10-10');
  const lim = enroll('Lim', 'Dino', '2026-08-10');                        // Certified
  grades(lim, '2026-08-11', 90);
  check(lim, '2026-10-05');
  call('officer', 'tl.certify', { id: lim, row_version: rv(lim) });
  const tan = enroll('Tan', 'Elena', '2026-07-15');                       // Promoted
  grades(tan, '2026-07-16', 92);
  check(tan, '2026-09-20');
  call('officer', 'tl.certify', { id: tan, row_version: rv(tan) });
  call('supervisor', 'tl.promote', { id: tan, row_version: rv(tan), promoted_on: '2026-10-19' });
  const ocampo = enroll('Ocampo', 'Felix', '2026-08-01');                 // Failed
  grades(ocampo, '2026-08-02', 70);
  check(ocampo, '2026-10-01', { checklist: 50, exam: 50, kitchen_feedback: 50 });
  const closeReason = g('Repository').all('lookups').find((l) => l.category === 'tl_close_reason').id;
  call('officer', 'tl.close', { id: ocampo, row_version: rv(ocampo), close_reason_id: closeReason, remark: 'Failed the second check' });
  const ramos = enroll('Ramos', 'Gina', '2026-09-01');                    // Quit
  call('officer', 'tl.quit', { id: ramos, row_version: rv(ramos), quit_date: '2026-10-01', quit_reason_lookup_id: quitReason });
  const villanueva = enroll('Villanueva', 'Hector', '2026-06-01');        // Probationary and overdue (deadline 2026-09-01)
  grades(villanueva, '2026-06-02', 75);
  const mendoza = enroll('Mendoza', 'Iris', '2026-07-01', { mother_location_id: 'LOC-0002' }); // Extended (written directly: CFG-047 is unset)
  grades(mendoza, '2026-07-02', 80);
  check(mendoza, '2026-10-01', { checklist: 60, exam: 60, kitchen_feedback: 60 });
  g('Repository').transact((uow) => {
    const e0 = uow.get('tl_enrollments', mendoza);
    const actor = { userId: user.officer.id, now: '2026-10-20T04:00:00.000Z' };
    const ctx = { userId: actor.userId, now: actor.now, role: 'Training Officer' };
    const next = '2026-11-15';
    uow.append('tl_extensions', { tl_enrollment_id: mendoza, extension_no: 1, old_deadline: e0.deadline, new_deadline: next, reason: 'Needs a second course program' }, actor);
    uow.update('tl_enrollments', mendoza, { status: 'Extended', deadline: next }, { expectedVersion: e0.row_version, actor: actor });
    g('TlService').statusChange(uow, ctx, e0, 'Extended', '2026-10-20', 'Needs a second course program');
  });
  Object.keys(token).forEach((r) => env.handle({ v: 1, method: 'auth.signOut', params: {}, token: token[r] }));
}

module.exports = { createEnv, TEST_PASSWORD, TEST_ADMIN_NO, USERS };
