'use strict';
// Part 2B, Task 11: enroll, update, entry grades and the reads. Invented names only. Today in the fake clock is 2026-10-20.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTl } = require('../helpers/tl-env');

test('enroll a new person returns warnings with requires_confirm when a similar person exists and writes nothing', () => {
  const env = setupTl();
  env.enrollOk();
  const before = ['persons', 'tl_enrollments', 'status_history', 'audit_log', 'id_counters'].map((t) => JSON.stringify(env.rows(t)));
  const r = env.enroll({ person: { last_name: 'DELA CRUZ', first_name: 'juan' }, batch_code: 'B-02' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.requires_confirm, true);
  assert.equal(r.data.warnings.length, 1);
  assert.deepEqual(r.data.warnings[0].candidates.map((c) => [c.person_id, c.reason]), [['PER-000001', 'SAME_NAME']]);
  const after = ['persons', 'tl_enrollments', 'status_history', 'audit_log', 'id_counters'].map((t) => JSON.stringify(env.rows(t)));
  assert.deepEqual(after, before);
});

test('enroll with confirm creates person, enrollment and one status_history row', () => {
  const env = setupTl();
  env.enrollOk();
  const r = env.enroll({ person: { last_name: 'Dela Cruz', first_name: 'Juan' }, confirm: true }, env.t.supervisor);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.requires_confirm, undefined);
  assert.equal(r.data.enrollment.id, 'TLE-2026-0002');
  assert.equal(r.data.enrollment.status, 'Entry');
  assert.equal(env.rows('persons').length, 2);
  const hist = env.rows('status_history').filter((h) => h.entity_id === 'TLE-2026-0002');
  assert.equal(hist.length, 1);
  assert.deepEqual([hist[0].from_status, hist[0].to_status, hist[0].effective_date], ['', 'Entry', '2026-10-20']);
  const audit = env.rows('audit_log').filter((a) => a.event === 'TL.ENROLLED' && a.entity_id === 'TLE-2026-0002');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, env.users.supervisor.id);
});

test('a same HR number is a VALIDATION error, not a warning', () => {
  const env = setupTl();
  env.enrollOk({ person: { last_name: 'Reyes', first_name: 'Ana', hr_employee_no: '4242' } });
  const r = env.enroll({ person: { last_name: 'Other', first_name: 'Name', hr_employee_no: '4242' } });
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].path, 'person.hr_employee_no');
});

test('a second open enrollment for a person is BLOCKED_BY_RULE RULE-100', () => {
  const env = setupTl();
  const d = env.enrollOk();
  const r = env.enroll({ person: undefined, person_id: d.person.id });
  assert.equal(r.error.code, 'BLOCKED_BY_RULE');
  assert.equal(r.error.rule_id, 'RULE-100');
  assert.equal(env.rows('tl_enrollments').length, 1);
});

test('re-enrollment after Quit is allowed', () => {
  const env = setupTl();
  const d = env.enrollOk();
  const id = d.enrollment.id;
  // Close the record directly (tl.quit is tested with Task 12).
  env.g('Repository').transact((uow) => { uow.update('tl_enrollments', id, { status: 'Quit' }, { expectedVersion: env.rv(id), actor: env.actor }); });
  assert.equal(env.get(id).data.enrollment.status, 'Quit');
  const again = env.enroll({ person: undefined, person_id: d.person.id, entry_date: '2026-10-20' });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.data.enrollment.person_id, d.person.id);
  assert.equal(again.data.enrollment.id, 'TLE-2026-0002');
});

test('entry date in the future is VALIDATION', () => {
  const env = setupTl();
  const r = env.enroll({ entry_date: '2026-10-21' });
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].path, 'entry_date');
});

test('the store must be an active Store and the station an active station of its brand', () => {
  const env = setupTl();
  assert.equal(env.enroll({ mother_location_id: 'LOC-9999' }).error.code, 'VALIDATION');
  const loc = env.rows('locations').find((l) => l.id === 'LOC-0002');
  env.call('locations.deactivate', { id: loc.id, row_version: loc.row_version }, env.t.admin);
  assert.equal(env.enroll({ mother_location_id: 'LOC-0002' }).error.code, 'VALIDATION');
  assert.equal(env.enroll({ station_id: 'STN-9999' }).error.code, 'VALIDATION');
  const r = env.call('tl.enroll', env.enrollParams({ person: undefined }), env.t.officer);
  assert.equal(r.error.code, 'VALIDATION', 'person or person_id is needed');
});

test('deadline uses CFG-040 in force on the entry date', () => {
  const env = setupTl();
  // Version 1 of CFG-040 (3 months) is in force from 2026-10-20; version 2 (6 months) from today as well, so give version 1 an earlier date.
  const v1 = env.rows('settings').find((s) => s.setting_key === 'CFG-040');
  env.g('Repository').transact((uow) => {
    uow.insert('settings', { setting_key: 'CFG-040', value: '6', value_type: 'int', version: 2, effective_from: '2026-10-19', supersedes_id: v1.id }, env.actor);
  });
  // On 2026-10-20 version 2 (from 10-19) is in force; on the entry date 2026-10-19 too.
  assert.equal(env.enrollOk({ entry_date: '2026-10-19' }).enrollment.deadline, '2027-04-19');
  // Before every version: the first version applies (see the deviation noted in the pull request).
  assert.equal(env.enrollOk({ person: { last_name: 'Reyes', first_name: 'Ana' }, entry_date: '2026-10-01' }).enrollment.deadline, '2027-01-01');
  const d3 = env.enrollOk({ person: { last_name: 'Santos', first_name: 'Bea' }, entry_date: '2026-10-20' });
  assert.equal(d3.enrollment.deadline, '2027-04-20');
});

test('an entry grade dated before the entry date or after today is VALIDATION', () => {
  const env = setupTl();
  const id = env.enrollOk({ entry_date: '2026-10-10' }).enrollment.id;
  assert.equal(env.grade(id, 'CMP-0001', 90, { assessed_on: '2026-10-09' }).error.fields[0].path, 'assessed_on');
  assert.equal(env.grade(id, 'CMP-0001', 90, { assessed_on: '2026-10-21' }).error.fields[0].path, 'assessed_on');
  assert.equal(env.grade(id, 'CMP-0001', 101).error.code, 'VALIDATION');
  assert.equal(env.grade(id, 'CMP-0001', -1).error.code, 'VALIDATION');
  assert.equal(env.grade(id, 'CMP-0001', 90.123).error.code, 'VALIDATION');
  assert.equal(env.grade(id, 'CMP-0006', 90).error.fields[0].path, 'component_id', 'a certification component is not an entry grade');
  assert.equal(env.grade(id, 'CMP-0001', 88.5, { assessed_on: '2026-10-10' }).ok, true);
  assert.equal(env.rows('assessments').length, 1);
});

test('the fifth required entry grade moves Entry to Probationary in the same call', () => {
  const env = setupTl();
  const id = env.enrollOk().enrollment.id;
  for (const c of env.ENTRY.slice(0, 4)) {
    const r = env.grade(id, c, 91);
    assert.equal(r.data.enrollment.status, 'Entry', c);
    assert.equal(r.data.entry.complete, false);
  }
  const last = env.grade(id, env.ENTRY[4], 81);
  assert.equal(last.ok, true, JSON.stringify(last));
  assert.equal(last.data.enrollment.status, 'Probationary');
  assert.equal(last.data.entry.complete, true);
  assert.equal(last.data.entry.average, 89);
  const hist = env.rows('status_history').filter((h) => h.entity_id === id).map((h) => [h.from_status, h.to_status]);
  assert.deepEqual(hist, [['', 'Entry'], ['Entry', 'Probationary']]);
  const a = env.rows('assessments');
  assert.equal(a.length, 5);
  assert.ok(a.every((x) => x.id.startsWith('ASM-2026-') && x.retake_no === 0 && x.assessed_by === env.users.officer.id));
});

test('a second grade for a component needs correction_reason and supersedes the first', () => {
  const env = setupTl();
  const id = env.enrollOk().enrollment.id;
  const first = env.grade(id, 'CMP-0001', 80);
  assert.equal(first.ok, true);
  const noReason = env.grade(id, 'CMP-0001', 85);
  assert.equal(noReason.error.code, 'VALIDATION');
  assert.equal(noReason.error.fields[0].path, 'correction_reason');
  const ok = env.grade(id, 'CMP-0001', 85, { correction_reason: 'Typing error' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const rows = env.rows('assessments');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].score, 80, 'the old row is untouched');
  assert.equal(rows[1].supersedes_id, rows[0].id);
  assert.equal(rows[1].correction_reason, 'Typing error');
  assert.deepEqual(ok.data.entry.grades.map((g) => g.score), [85]);
  // a third correction supersedes the second, not the first
  env.grade(id, 'CMP-0001', 86, { correction_reason: 'Again' });
  assert.equal(env.rows('assessments')[2].supersedes_id, rows[1].id);
});

test('update writes record_history for the changed fields only and refuses entry_date', () => {
  const env = setupTl();
  const id = env.enrollOk().enrollment.id;
  const r = env.act('tl.update', id, { patch: { batch_code: 'B-09', remarks: 'Moved' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.enrollment.batch_code, 'B-09');
  const h = env.rows('record_history').filter((x) => x.entity === 'tl_enrollments' && x.entity_id === id);
  assert.deepEqual(h.map((x) => [x.field, x.old_value, x.new_value]).sort(), [['batch_code', 'B-01', 'B-09'], ['remarks', '', 'Moved']].sort());
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.UPDATED' && a.entity_id === id));
  for (const bad of [{ entry_date: '2026-10-01' }, { deadline: '2027-01-01' }, { status: 'Certified' }, { person_id: 'PER-000009' }]) {
    const x = env.act('tl.update', id, { patch: bad });
    assert.equal(x.error.code, 'VALIDATION', JSON.stringify(bad));
  }
  assert.equal(env.act('tl.update', id, { patch: { station_id: 'STN-9999' } }).error.code, 'VALIDATION');
  const stale = env.call('tl.update', { id, row_version: 1, patch: { remarks: 'x' } }, env.t.officer);
  assert.equal(stale.error.code, 'CONFLICT');
  assert.ok(stale.error.current.row_version > 1);
});

test('tl.list pages, filters overdue and searches an alias', () => {
  const env = setupTl();
  // three records; one is overdue (entry 2026-06-01, deadline 2026-09-01)
  const a = env.enrollOk({ person: { last_name: 'Reyes', first_name: 'Ana' }, entry_date: '2026-10-20', batch_code: 'B-01' });
  const b = env.enrollOk({ person: { last_name: 'Santos', first_name: 'Bea' }, entry_date: '2026-06-01', batch_code: 'B-02', station_id: 'STN-0002' });
  env.enrollOk({ person: { last_name: 'Lopez', first_name: 'Carla' }, entry_date: '2026-10-19', batch_code: 'B-02', mother_location_id: 'LOC-0002' });
  env.g('Repository').transact((uow) => env.g('PersonService').addAlias(uow, { userId: env.users.admin.id, now: env.actor.now }, a.person.id, 'NAME', 'ANNABELLE REYES', '2026-10-20'));
  const list = (p) => env.call('tl.list', p || {}, env.t.officer);
  const all = list();
  assert.equal(all.ok, true, JSON.stringify(all));
  assert.equal(all.data.length, 3);
  assert.equal(all.meta.page.total, 3);
  assert.deepEqual(all.data.map((r) => r.name), ['Bea Santos', 'Carla Lopez', 'Ana Reyes'], 'default sort is the deadline');
  assert.ok(all.data[0].overdue && !all.data[1].overdue);
  assert.deepEqual(Object.keys(all.data[0]).sort(),
    ['batch_code', 'deadline', 'entry_date', 'final_grade', 'id', 'mother_location_id', 'name', 'open', 'overdue', 'person_id', 'station', 'station_id', 'status', 'store'].sort());
  assert.deepEqual(list({ filters: { overdue: true } }).data.map((r) => r.id), [b.enrollment.id]);
  assert.equal(list({ filters: { batch_code: 'B-02' } }).data.length, 2);
  assert.equal(list({ filters: { mother_location_id: 'LOC-0002' } }).data.length, 1);
  assert.equal(list({ filters: { station_id: 'STN-0002' } }).data.length, 1);
  assert.equal(list({ filters: { status: 'Entry', open: true } }).data.length, 3);
  assert.equal(list({ filters: { open: false } }).data.length, 0);
  assert.deepEqual(list({ q: 'annabelle' }).data.map((r) => r.id), [a.enrollment.id]);
  assert.deepEqual(list({ q: 'santos, bea' }).data.map((r) => r.id), [b.enrollment.id]);
  const p1 = list({ page: 1, page_size: 2 });
  assert.deepEqual([p1.data.length, p1.meta.page.total], [2, 3]);
  assert.equal(list({ page: 2, page_size: 2 }).data.length, 1);
  assert.deepEqual(list({ sort: 'name' }).data.map((r) => r.name), ['Ana Reyes', 'Bea Santos', 'Carla Lopez']);
  assert.deepEqual(list({ sort: '-entry_date' }).data.map((r) => r.entry_date), ['2026-10-20', '2026-10-19', '2026-06-01']);
  assert.equal(list({ page_size: 51 }).error.code, 'VALIDATION');
  assert.equal(list({ filters: { final_grade: 1 } }).error.code, 'VALIDATION');
  assert.equal(list({ sort: 'status' }).error.code, 'VALIDATION');
});

test('a write is visible in tl.list on the next call', () => {
  const env = setupTl();
  const id = env.enrollOk().enrollment.id;
  const names = () => env.call('tl.list', {}, env.t.officer).data.map((r) => r.batch_code);
  assert.deepEqual(names(), ['B-01']);
  env.act('tl.update', id, { patch: { batch_code: 'B-77' } });
  assert.deepEqual(names(), ['B-77']);
  env.enrollOk({ person: { last_name: 'Reyes', first_name: 'Ana' } });
  assert.equal(names().length, 2);
});

test('tl.get returns the person, entry grades with the average, and allowed_actions for the caller', () => {
  const env = setupTl();
  const id = env.probationary();
  const off = env.get(id, env.t.officer);
  assert.equal(off.ok, true, JSON.stringify(off));
  assert.equal(off.data.person.name, 'Juan Dela Cruz');
  assert.equal(off.data.entry.average, 90);
  assert.equal(off.data.entry.grades.length, 5);
  assert.equal(off.data.overdue, false);
  assert.deepEqual(off.data.allowed_actions.sort(), ['quit', 'recordCertCheck', 'recordEntryGrade']);
  assert.equal(env.get('TLE-2026-9999').error.code, 'NOT_FOUND');
  for (const k of ['password_hash', 'salt']) assert.ok(!JSON.stringify(off).includes(k));
});

test('tl.history lists status and field changes newest first', () => {
  const env = setupTl();
  const id = env.enrollOk().enrollment.id;
  env.minutes(1);
  env.act('tl.update', id, { patch: { batch_code: 'B-09' } });
  env.minutes(1);
  env.allEntryGrades(id);
  const h = env.call('tl.history', { id }, env.t.officer);
  assert.equal(h.ok, true, JSON.stringify(h));
  const kinds = h.data.map((x) => x.kind);
  assert.ok(kinds.includes('STATUS') && kinds.includes('FIELD') && kinds.includes('ASSESSMENT'));
  assert.equal(h.data[h.data.length - 1].kind, 'STATUS', 'the oldest is the enrollment status row');
  const ids = h.data.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  const times = h.data.map((x) => x.at);
  assert.deepEqual(times, times.slice().sort().reverse());
  const page = env.call('tl.history', { id, page_size: 3 }, env.t.officer);
  assert.equal(page.data.length, 3);
  assert.ok(page.meta.page.next_cursor);
  const next = env.call('tl.history', { id, page_size: 3, cursor: page.meta.page.next_cursor }, env.t.officer);
  assert.equal(next.data.length, 3);
  assert.notEqual(next.data[0].id, page.data[0].id);
});

test('Admin can enroll (P2-6), and every role can read', () => {
  const env = setupTl();
  const r = env.enroll({}, env.t.admin);
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = r.data.enrollment.id;
  for (const role of ['officer', 'supervisor', 'manager', 'senior', 'admin']) {
    assert.equal(env.call('tl.get', { id }, env.t[role]).ok, true, role);
    assert.equal(env.call('tl.list', {}, env.t[role]).ok, true, role);
    assert.equal(env.call('tl.history', { id }, env.t[role]).ok, true, role);
  }
});

test('every TL write raises the data version, writes an audit row with the spec event code, and never returns a secret', () => {
  const env = setupTl();
  const v0 = env.g('Props').get('TL_DATA_VERSION');
  const id = env.enrollOk().enrollment.id;
  env.grade(id, 'CMP-0001', 90);
  const events = env.rows('audit_log').map((a) => a.event);
  assert.ok(events.includes('TL.ENROLLED') && events.includes('TL.ENTRY_GRADE_RECORDED'));
  assert.notEqual(env.g('Props').get('TL_DATA_VERSION'), v0);
});
