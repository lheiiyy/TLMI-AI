'use strict';
// A signed-in environment with the seeded master data (stores, stations, components, settings), for the Team Leader tests.
// Invented names only. "Today" in the fake clock is 2026-10-20.
const { setupApi } = require('./env');
const { fillTab } = require('./sheets');
const F = require('../fixtures/legacy-copy');

const ENTRY = ['CMP-0001', 'CMP-0002', 'CMP-0003', 'CMP-0004', 'CMP-0005'];
const CERT = { checklist: 'CMP-0006', exam: 'CMP-0007', kitchen: 'CMP-0008', manager: 'CMP-0009', course: 'CMP-0010' };

function setupTl(opts = {}) {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(F.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', F.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', F.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', F.LEGACY_ID);
  env.t = {};
  for (const r of ['officer', 'supervisor', 'manager', 'senior', 'admin']) env.t[r] = env.signIn(r);
  const seeded = env.call('seed.run', {}, env.t.admin);
  if (!seeded.ok) throw new Error('seed failed: ' + JSON.stringify(seeded));
  env.rows = (t) => env.plain(env.g('Repository').all(t));
  env.ENTRY = ENTRY;
  env.CERT = CERT;
  if (opts.quitReason !== false) {
    const r = env.call('lookups.create', { category: 'tl_quit_reason', value: 'Resigned', label: 'Resigned', sort_order: 1 }, env.t.admin);
    if (!r.ok) throw new Error(JSON.stringify(r));
    env.quitReasonId = r.data.id;
  }
  if (opts.extensionLimit !== false) {
    const r = env.call('settings.set', { setting_key: 'CFG-047', value: String(opts.extensionLimit || 2), reason: 'test' }, env.t.admin);
    if (!r.ok) throw new Error(JSON.stringify(r));
  }
  env.closeReasonId = env.rows('lookups').find((l) => l.category === 'tl_close_reason').id;

  const person = (n) => ({ last_name: 'Dela Cruz' + (n || ''), first_name: 'Juan' + (n || '') });
  env.enrollParams = (over) => Object.assign({
    person: person(), mother_location_id: 'LOC-0001', station_id: 'STN-0001', batch_code: 'B-01', entry_date: '2026-10-20',
  }, over || {});
  env.enroll = (over, token) => env.call('tl.enroll', env.enrollParams(over), token || env.t.officer);
  env.enrollOk = (over, token) => {
    const r = env.enroll(over, token);
    if (!r.ok || r.data.requires_confirm) throw new Error('enroll failed: ' + JSON.stringify(r));
    return r.data;
  };
  env.get = (id, token) => env.call('tl.get', { id }, token || env.t.officer);
  env.rv = (id) => env.rows('tl_enrollments').find((e) => e.id === id).row_version;
  env.grade = (id, comp, score, extra, token) => env.call('tl.recordEntryGrade', Object.assign(
    { id, row_version: env.rv(id), component_id: comp, score, assessed_on: '2026-10-20' }, extra || {}), token || env.t.officer);
  env.allEntryGrades = (id, score) => ENTRY.forEach((c) => {
    const r = env.grade(id, c, score === undefined ? 90 : score);
    if (!r.ok) throw new Error('grade failed: ' + JSON.stringify(r));
  });
  // Enrolls, records all five entry grades (status Probationary) and returns the enrollment id.
  env.probationary = (over) => {
    const d = env.enrollOk(over);
    const id = d.enrollment.id;
    env.allEntryGrades(id);
    return id;
  };
  env.officerIds = () => [env.users.officer.id];
  // The course program grade is sent only while the record has none, as the first attempt needs it and a later one does not.
  env.cert = (id, over, token) => {
    const hasCourse = env.rows('assessments').some((a) => a.subject_id === id && a.component_id === CERT.course);
    const base = { id, row_version: env.rv(id), assessed_on: '2026-10-20', checklist: 95, exam: 90, kitchen_feedback: 92, officer_ids: env.officerIds() };
    if (!hasCourse) base.course_program = 95;
    return env.call('tl.recordCertCheck', Object.assign(base, over || {}), token || env.t.officer);
  };
  env.certOk = (id, over, token) => {
    const r = env.cert(id, over, token);
    if (!r.ok) throw new Error('cert failed: ' + JSON.stringify(r));
    return r.data;
  };
  env.act = (method, id, params, token) => env.call(method, Object.assign({ id, row_version: env.rv(id) }, params || {}), token || env.t.officer);
  env.statusOf = (id) => env.rows('tl_enrollments').find((e) => e.id === id).status;
  return env;
}

module.exports = { setupTl, ENTRY, CERT };
