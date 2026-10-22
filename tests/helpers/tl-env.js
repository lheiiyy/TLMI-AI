'use strict';
// A server with the master data seeded from the invented legacy copy (stores, stations, components, settings), one signed-in
// user of every role, and helpers for the Team Leader methods.
const { setupApi } = require('./env');
const { fillTab } = require('./sheets');
const L = require('../fixtures/legacy-copy');

function setupTl() {
  const env = setupApi();
  const ss = env.google.addSpreadsheet(L.LEGACY_ID, 'legacy copy');
  fillTab(ss, 'SETTINGS', L.SETTINGS);
  fillTab(ss, 'SEED_OFFICERS', L.SEED_OFFICERS);
  env.g('Props').set('LEGACY_COPY_ID', L.LEGACY_ID);
  const admin = env.signIn('admin');
  const seeded = env.call('seed.run', {}, admin);
  if (!seeded.ok) throw new Error('seed failed in test: ' + JSON.stringify(seeded));
  const R = env.g('Repository');
  const rows = (t) => env.plain(R.all(t));
  env.rows = rows;
  env.tokens = { admin: admin };
  env.token = (role) => { if (!env.tokens[role]) env.tokens[role] = env.signIn(role); return env.tokens[role]; };
  env.store = rows('locations').find((l) => l.name === 'TEST STORE ONE').id;
  env.store2 = rows('locations').find((l) => l.name === 'SECOND TEST STORE').id;
  env.station = rows('stations').find((s) => s.name === 'Food Prep').id;
  env.station2 = rows('stations').find((s) => s.name === 'Pizza Maker').id;
  const comps = rows('assessment_components');
  env.entryComps = comps.filter((c) => c.stage === 'entry').map((c) => c.id);
  env.comp = (name) => comps.find((c) => c.name === name).id;
  env.today = '2026-10-20';
  env.enrollParams = (o) => Object.assign({
    person: { last_name: 'Dela Cruz', first_name: 'Juan' }, mother_location_id: env.store, station_id: env.station, entry_date: '2026-10-01',
  }, o || {});
  // The role of the caller is by name: 'officer', 'supervisor', 'manager', 'senior', 'admin'.
  env.tl = (role, method, params) => env.call(method, params, env.token(role));
  env.enroll = (o, role) => env.tl(role || 'officer', 'tl.enroll', env.enrollParams(o));
  env.get = (id, role) => env.tl(role || 'officer', 'tl.get', { id });
  env.version = (id) => rows('tl_enrollments').find((e) => e.id === id).row_version;
  env.grade = (id, comp, score, o, role) => env.tl(role || 'officer', 'tl.recordEntryGrade',
    Object.assign({ id, row_version: env.version(id), component_id: comp, score, assessed_on: '2026-10-10' }, o || {}));
  // Records every required entry grade (all five at 90).
  env.allEntryGrades = (id, role) => env.entryComps.map((c) => env.grade(id, c, 90, {}, role));
  // A certification check with the usual scores: final 83.3, course program 95.
  env.check = (id, o, role) => env.tl(role || 'officer', 'tl.recordCertCheck', Object.assign({
    id, row_version: env.version(id), assessed_on: '2026-10-15', checklist: 90, exam: 80, kitchen_feedback: 85, manager_feedback: 75,
    course_program: 95, officer_ids: [env.users.officer.id],
  }, o || {}));
  // An enrollment that has all its entry grades (Probationary), entered on 2026-10-01.
  env.probationary = (o) => {
    const d = env.enroll(o);
    if (!d.ok) throw new Error('enroll failed in test: ' + JSON.stringify(d));
    env.allEntryGrades(d.data.enrollment.id);
    return d.data.enrollment.id;
  };
  env.act = (id, method, params, role) => env.tl(role || 'officer', method, Object.assign({ id, row_version: env.version(id) }, params || {}));
  // Sets a setting for Admin's choice (a new version, effective today).
  env.setting = (key, value) => {
    const versions = rows('settings').filter((x) => x.setting_key === key).sort((a, b) => a.version - b.version);
    const params = { setting_key: key, value: String(value), reason: 'test' };
    if (versions.length) params.supersedes_id = versions[versions.length - 1].id;
    const r = env.call('settings.set', params, admin);
    if (!r.ok) throw new Error('setting failed in test: ' + JSON.stringify(r));
  };
  // Puts a record in a status directly, as an earlier action would have.
  env.force = (id, patch) => R.transact((uow) => uow.update('tl_enrollments', id, patch, { expectedVersion: uow.get('tl_enrollments', id).row_version, actor: env.actor }));
  return env;
}

module.exports = { setupTl };
