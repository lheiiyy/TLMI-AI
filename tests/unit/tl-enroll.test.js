'use strict';
// Part 2B, Task 11: enroll, update, entry grades and the reads of a Team Leader record.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTl } = require('../helpers/tl-env');

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };

test('enroll a new person returns warnings with requires_confirm when a similar person exists, and writes nothing', () => {
  const env = setupTl();
  ok(env.enroll());
  const before = [env.rows('persons').length, env.rows('tl_enrollments').length, env.rows('status_history').length, env.rows('audit_log').length];
  // the first is still open, so use a similar new person: same name in another case, another store
  const r = env.enroll({ person: { last_name: 'DELA  CRUZ', first_name: 'juan' } });
  assert.equal(r.ok, true);
  assert.equal(r.data.requires_confirm, true);
  assert.equal(r.data.warnings[0].code, 'POSSIBLE_DUPLICATE');
  assert.equal(r.data.warnings[0].candidates[0].reason, 'SAME_NAME');
  const after = [env.rows('persons').length, env.rows('tl_enrollments').length, env.rows('status_history').length, env.rows('audit_log').length];
  assert.deepEqual(after, before);
});

test('enroll with confirm creates the person, the enrollment and one status_history row', () => {
  const env = setupTl();
  const d = ok(env.enroll());
  assert.match(d.enrollment.id, /^TLE-2026-0001$/);
  assert.equal(d.enrollment.status, 'Entry');
  assert.equal(d.enrollment.deadline, '2027-01-01');
  assert.equal(d.person.display_name, 'Juan Dela Cruz');
  assert.equal(env.rows('persons').length, 1);
  const hist = env.rows('status_history');
  assert.equal(hist.length, 1);
  assert.deepEqual([hist[0].entity, hist[0].entity_id, hist[0].from_status, hist[0].to_status, hist[0].effective_date, hist[0].user_id],
    ['tl_enrollments', d.enrollment.id, '', 'Entry', '2026-10-01', env.users.officer.id]);
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.ENROLLED' && a.entity_id === d.enrollment.id));
  // with confirm, a similar person is created too
  const dup = ok(env.enroll({ person: { last_name: 'Dela Cruz', first_name: 'Juan', middle_name: 'P.' }, confirm: true }));
  assert.match(dup.enrollment.id, /^TLE-2026-0002$/);
  assert.equal(env.rows('persons').length, 2);
});

test('a same HR number is a VALIDATION error, not a warning', () => {
  const env = setupTl();
  ok(env.enroll({ person: { last_name: 'Reyes', first_name: 'Ana', hr_employee_no: '4001' } }));
  const r = env.enroll({ person: { last_name: 'Other', first_name: 'Name', hr_employee_no: '4001' }, confirm: true });
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].path, 'person.hr_employee_no');
});

test('exactly one of person_id and person is given', () => {
  const env = setupTl();
  assert.equal(env.enroll({ person: undefined }).error.code, 'VALIDATION');
  assert.equal(env.enroll({ person_id: 'PER-000001' }).error.code, 'VALIDATION');
});

test('a second open enrollment for a person is BLOCKED_BY_RULE RULE-100', () => {
  const env = setupTl();
  const d = ok(env.enroll());
  const r = env.enroll({ person: undefined, person_id: d.person.id });
  assert.equal(r.error.code, 'BLOCKED_BY_RULE');
  assert.equal(r.error.rule_id, 'RULE-100');
  assert.equal(env.rows('tl_enrollments').length, 1);
});

test('re-enrollment after Quit is allowed', () => {
  const env = setupTl();
  const d = ok(env.enroll());
  env.force(d.enrollment.id, { status: 'Quit' });
  const again = ok(env.enroll({ person: undefined, person_id: d.person.id, entry_date: '2026-10-05' }));
  assert.match(again.enrollment.id, /^TLE-2026-0002$/);
  assert.equal(again.person.id, d.person.id);
  // a person with a Certified record has no open enrollment either
  env.force(again.enrollment.id, { status: 'Certified' });
  assert.equal(env.enroll({ person: undefined, person_id: d.person.id, entry_date: '2026-10-06' }).ok, true);
});

test('an entry date in the future is VALIDATION, and the store and station are checked', () => {
  const env = setupTl();
  const f = env.enroll({ entry_date: '2026-10-21' });
  assert.equal(f.error.code, 'VALIDATION');
  assert.equal(f.error.fields[0].path, 'entry_date');
  assert.equal(env.enroll({ entry_date: '2026-10-20' }).ok, true);
  assert.equal(env.enroll({ person: { last_name: 'A', first_name: 'B' }, mother_location_id: 'LOC-9999' }).error.fields[0].path, 'mother_location_id');
  assert.equal(env.enroll({ person: { last_name: 'A', first_name: 'B' }, station_id: undefined }).error.fields[0].path, 'station_id');
  assert.equal(env.enroll({ person: { last_name: 'A', first_name: 'B' }, station_id: 'STN-9999' }).error.fields[0].path, 'station_id');
  // an inactive store is refused
  const store = env.rows('locations').find((l) => l.id === env.store2);
  assert.equal(env.call('locations.deactivate', { id: store.id, row_version: store.row_version }, env.token('admin')).ok, true);
  assert.equal(env.enroll({ person: { last_name: 'A', first_name: 'B' }, mother_location_id: env.store2 }).error.fields[0].path, 'mother_location_id');
});

test('the deadline uses CFG-040 in force on the entry date', () => {
  const env = setupTl();
  const d1 = ok(env.enroll({ entry_date: '2026-10-01' }));
  assert.equal(d1.enrollment.deadline, '2027-01-01');
  // a new version of CFG-040 takes effect today; an earlier entry date still uses the first version
  env.setting('CFG-040', 4);
  const d2 = ok(env.enroll({ person: { last_name: 'Reyes', first_name: 'Ana' }, entry_date: '2026-10-20' }));
  assert.equal(d2.enrollment.deadline, '2027-02-20');
  const d3 = ok(env.enroll({ person: { last_name: 'Santos', first_name: 'Luis' }, entry_date: '2026-10-19' }));
  assert.equal(d3.enrollment.deadline, '2027-01-19', 'the entry date is before the new version, so the old rule applies');
  // 30 Nov + 3 months
  const d4 = ok(env.enroll({ person: { last_name: 'Garcia', first_name: 'Pedro' }, entry_date: '2026-10-19' }));
  assert.ok(d4.enrollment.deadline);
});

test('enrolling without CFG-040 set is CONFIG_MISSING, and the first version applies to an earlier entry date', () => {
  const env = setupTl();
  // the seed made version 1 effective today (2026-10-20); an entry date before it still gets that rule
  assert.equal(env.enroll({ entry_date: '2026-01-10' }).data.enrollment.deadline, '2026-04-10');
  const cols = env.plain(env.g('Schema').columns('settings'));
  const sheet = env.sheet('settings');
  const at = sheet.getDataRange().getValues().findIndex((r, i) => i > 0 && r[cols.indexOf('setting_key')] === 'CFG-040');
  sheet.deleteRows(at + 1, 1);
  const r = env.enroll({ person: { last_name: 'Reyes', first_name: 'Ana' } });
  assert.equal(r.error.code, 'CONFIG_MISSING');
  assert.ok(r.error.message.includes('CFG-040'));
  assert.equal(env.rows('persons').length, 1, 'nothing was written');
});

test('an entry grade dated before the entry date or after today is VALIDATION', () => {
  const env = setupTl();
  const d = ok(env.enroll({ entry_date: '2026-10-05' }));
  const id = d.enrollment.id;
  const comp = env.entryComps[0];
  const early = env.grade(id, comp, 90, { assessed_on: '2026-10-04' });
  assert.equal(early.error.code, 'VALIDATION');
  assert.equal(early.error.fields[0].path, 'assessed_on');
  const late = env.grade(id, comp, 90, { assessed_on: '2026-10-21' });
  assert.equal(late.error.fields[0].path, 'assessed_on');
  assert.equal(env.grade(id, comp, 90, { assessed_on: '2026-10-05' }).ok, true);
  assert.equal(env.rows('assessments').length, 1);
});

test('the fifth required entry grade moves Entry to Probationary in the same call, and not before', () => {
  const env = setupTl();
  const id = ok(env.enroll()).enrollment.id;
  for (let i = 0; i < 4; i++) {
    const r = ok(env.grade(id, env.entryComps[i], 80 + i));
    assert.equal(r.enrollment.status, 'Entry');
    assert.equal(r.entry.complete, false);
  }
  const last = ok(env.grade(id, env.entryComps[4], 100));
  assert.equal(last.enrollment.status, 'Probationary');
  assert.equal(last.entry.complete, true);
  assert.equal(last.entry.average, 85.2);
  assert.match(last.grade.id, /^ASM-2026-000005$/);
  const hist = env.rows('status_history').filter((h) => h.entity_id === id);
  assert.deepEqual(hist.map((h) => [h.from_status, h.to_status]), [['', 'Entry'], ['Entry', 'Probationary']]);
  const audit = env.rows('audit_log').filter((a) => a.event === 'TL.ENTRY_GRADE_RECORDED');
  assert.equal(audit.length, 5);
  // a sixth entry grade in Probationary is a correction of an existing one and changes no status
  const fix = ok(env.grade(id, env.entryComps[0], 95, { correction_reason: 'Typed wrongly' }));
  assert.equal(fix.enrollment.status, 'Probationary');
  assert.equal(fix.entry.average, 88.2);
});

test('a second grade for a component needs correction_reason and supersedes the first', () => {
  const env = setupTl();
  const id = ok(env.enroll()).enrollment.id;
  const comp = env.entryComps[0];
  const first = ok(env.grade(id, comp, 70)).grade;
  const noReason = env.grade(id, comp, 80);
  assert.equal(noReason.error.code, 'VALIDATION');
  assert.equal(noReason.error.fields[0].path, 'correction_reason');
  assert.equal(env.rows('assessments').length, 1);
  const second = ok(env.grade(id, comp, 80, { correction_reason: 'Re-marked' })).grade;
  assert.equal(second.supersedes_id, first.id);
  assert.equal(second.correction_reason, 'Re-marked');
  // the old row is unchanged and still there
  const rows = env.rows('assessments');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((a) => a.id === first.id).score, 70);
  const view = ok(env.get(id));
  assert.equal(view.entry.components.find((c) => c.component_id === comp).grade.score, 80);
  assert.equal(view.entry.history.length, 2);
  // the third correction supersedes the second
  const third = ok(env.grade(id, comp, 85, { correction_reason: 'Again' })).grade;
  assert.equal(third.supersedes_id, second.id);
});

test('entry grades: only an active entry component, a score from 0 to 100, in an open status', () => {
  const env = setupTl();
  const id = ok(env.enroll()).enrollment.id;
  assert.equal(env.grade(id, env.comp('Checklist'), 90).error.fields[0].path, 'component_id');
  assert.equal(env.grade(id, 'CMP-9999', 90).error.fields[0].path, 'component_id');
  assert.equal(env.grade(id, env.entryComps[0], 101).error.code, 'VALIDATION');
  assert.equal(env.grade(id, env.entryComps[0], -1).error.code, 'VALIDATION');
  assert.equal(env.grade(id, env.entryComps[0], 85.123).error.code, 'VALIDATION');
  env.force(id, { status: 'Certified' });
  const r = env.grade(id, env.entryComps[0], 90);
  assert.equal(r.error.code, 'BLOCKED_BY_RULE');
  assert.equal(r.error.rule_id, 'WF-002');
  assert.equal(env.rows('assessments').length, 0);
});

test('a stale row_version is CONFLICT and writes nothing', () => {
  const env = setupTl();
  const id = ok(env.enroll()).enrollment.id;
  const v = env.version(id);
  env.force(id, { remarks: 'changed meanwhile' });
  const r = env.tl('officer', 'tl.recordEntryGrade', { id, row_version: v, component_id: env.entryComps[0], score: 90, assessed_on: '2026-10-10' });
  assert.equal(r.error.code, 'CONFLICT');
  assert.equal(r.error.current.row_version, v + 1);
  assert.equal(env.rows('assessments').length, 0);
});

test('update writes record_history for the changed fields only and refuses entry_date, deadline and status', () => {
  const env = setupTl();
  const id = ok(env.enroll({ batch_code: 'B-1' })).enrollment.id;
  const v = env.version(id);
  const r = ok(env.tl('manager', 'tl.update', { id, row_version: v, patch: { batch_code: 'B-2', remarks: 'Transferred', station_id: env.station2 } }));
  assert.equal(r.enrollment.batch_code, 'B-2');
  assert.equal(r.enrollment.row_version, v + 1);
  const hist = env.rows('record_history').filter((h) => h.entity === 'tl_enrollments' && h.entity_id === id);
  assert.deepEqual(hist.map((h) => h.field).sort(), ['batch_code', 'remarks', 'station_id']);
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.UPDATED' && a.entity_id === id));
  for (const f of ['entry_date', 'deadline', 'status', 'final_grade', 'person_id', 'row_version']) {
    const x = env.tl('officer', 'tl.update', { id, row_version: env.version(id), patch: { [f]: 'x' } });
    assert.equal(x.error.code, 'VALIDATION', f);
    assert.equal(x.error.fields[0].code, 'UNKNOWN_FIELD', f);
  }
  // an unchanged patch writes nothing and does not raise the version
  const same = ok(env.tl('officer', 'tl.update', { id, row_version: env.version(id), patch: { batch_code: 'B-2' } }));
  assert.equal(same.enrollment.row_version, v + 1);
  assert.equal(env.rows('record_history').filter((h) => h.entity === 'tl_enrollments').length, 3);
  // links are checked: another brand's station or a non-store is refused
  assert.equal(env.tl('officer', 'tl.update', { id, row_version: env.version(id), patch: { station_id: 'STN-9999' } }).error.fields[0].path, 'station_id');
  assert.equal(env.tl('officer', 'tl.update', { id, row_version: env.version(id), patch: { mother_location_id: 'LOC-9999' } }).error.fields[0].path, 'mother_location_id');
  assert.equal(env.tl('officer', 'tl.update', { id, row_version: env.version(id), patch: { mother_location_id: '' } }).error.code, 'VALIDATION');
});

test('tl.get returns the record with the entry grades, the average, allowed actions and the overdue flag', () => {
  const env = setupTl();
  const id = ok(env.enroll({ entry_date: '2026-09-01' })).enrollment.id;
  ok(env.grade(id, env.entryComps[0], 90, { assessed_on: '2026-09-02' }));
  const v = ok(env.get(id));
  assert.equal(v.person.display_name, 'Juan Dela Cruz');
  assert.equal(v.entry.complete, false);
  assert.equal(v.entry.average, 90);
  assert.equal(v.entry.components.length, 5);
  assert.deepEqual(v.entry.missing.length, 4);
  assert.equal(v.entry.components[0].grade.assessed_by_name, 'Olivia Tester');
  assert.equal(v.overdue, false);
  assert.deepEqual(v.allowed_actions.sort(), ['quit', 'recordEntryGrade']);
  assert.deepEqual(v.checks, []);
  assert.equal(v.course_program, null);
  // an open record past its deadline is overdue
  env.force(id, { deadline: '2026-10-19' });
  assert.equal(ok(env.get(id)).overdue, true);
  assert.equal(env.get('TLE-2026-9999').error.code, 'NOT_FOUND');
});

test('tl.list pages, filters overdue and open, and searches a name and an alias', () => {
  const env = setupTl();
  const names = [['Aquino', 'Ben'], ['Bautista', 'Cora'], ['Castro', 'Dan'], ['Diaz', 'Eva']];
  const ids = names.map(([l, f], i) => ok(env.enroll({ person: { last_name: l, first_name: f }, entry_date: '2026-09-0' + (i + 1), batch_code: i < 2 ? 'B-1' : 'B-2' })).enrollment.id);
  env.force(ids[0], { deadline: '2026-10-01' });
  env.force(ids[1], { status: 'Quit' });
  const list = (p) => ok(env.tl('senior', 'tl.list', p || {}));
  const all = env.tl('senior', 'tl.list', {});
  assert.equal(all.data.length, 4);
  assert.equal(all.meta.page.total, 4);
  assert.deepEqual(all.data.map((r) => r.id)[0], ids[0], 'the default sort is the deadline, earliest first');
  assert.deepEqual(list({ filters: { overdue: true } }).map((r) => r.id), [ids[0]]);
  assert.deepEqual(list({ filters: { open: false } }).map((r) => r.id), [ids[1]]);
  assert.equal(list({ filters: { open: true } }).length, 3);
  assert.equal(list({ filters: { batch_code: 'B-2' } }).length, 2);
  assert.equal(list({ filters: { status: 'Quit' } }).length, 1);
  assert.equal(list({ filters: { mother_location_id: env.store2 } }).length, 0);
  assert.deepEqual(list({ q: 'cora' }).map((r) => r.id), [ids[1]]);
  const paged = env.tl('senior', 'tl.list', { page: 2, page_size: 3 });
  assert.equal(paged.data.length, 1);
  assert.equal(paged.meta.page.total, 4);
  assert.deepEqual(list({ sort: '-name' }).map((r) => r.name), ['Eva Diaz', 'Dan Castro', 'Cora Bautista', 'Ben Aquino']);
  assert.equal(env.tl('senior', 'tl.list', { page_size: 51 }).error.code, 'VALIDATION');
  // a NAME alias is searched too
  env.g('Repository').transact((uow) => env.g('PersonService').addAlias(uow, { userId: 'USR-0001', now: env.actor.now }, env.rows('tl_enrollments').find((e) => e.id === ids[2]).person_id, 'NAME', 'KASTRO, DANIEL'));
  env.g('Props').set('TL_DATA_VERSION', '99'); // as a write would
  assert.deepEqual(list({ q: 'kastro' }).map((r) => r.id), [ids[2]]);
  const row = list({ q: 'cora' })[0];
  assert.deepEqual(Object.keys(row).sort(), ['batch_code', 'deadline', 'entry_date', 'final_grade', 'id', 'mother_location_id', 'name', 'open', 'overdue', 'person_id', 'station', 'station_id', 'status', 'store']);
});

test('a write is visible in tl.list on the next call, although the list is cached', () => {
  const env = setupTl();
  assert.equal(ok(env.tl('officer', 'tl.list', {})).length, 0);
  const id = ok(env.enroll()).enrollment.id;
  assert.equal(ok(env.tl('officer', 'tl.list', {})).length, 1);
  assert.equal(ok(env.tl('officer', 'tl.list', {}))[0].status, 'Entry');
  ok(env.tl('officer', 'tl.update', { id, row_version: env.version(id), patch: { batch_code: 'NEW' } }));
  assert.equal(ok(env.tl('officer', 'tl.list', {}))[0].batch_code, 'NEW');
  env.allEntryGrades(id);
  assert.equal(ok(env.tl('officer', 'tl.list', {}))[0].status, 'Probationary');
});

test('the list is cached for a minute under the data version', () => {
  const env = setupTl();
  ok(env.enroll());
  ok(env.tl('officer', 'tl.list', {}));
  let reads = 0;
  const R = env.g('Repository');
  const all = R.all;
  R.all = (n) => { if (n === 'tl_enrollments') reads++; return all.call(R, n); };
  ok(env.tl('officer', 'tl.list', {}));
  ok(env.tl('officer', 'tl.list', {}));
  assert.equal(reads, 0, 'served from the cache');
  env.minutes(2);
  ok(env.tl('officer', 'tl.list', {}));
  assert.equal(reads, 1, 'read again after the cache expired');
  R.all = all;
});

test('tl.history lists status and field changes newest first, with the grades, and pages with a cursor', () => {
  const env = setupTl();
  const id = ok(env.enroll()).enrollment.id;
  env.minutes(1);
  ok(env.tl('officer', 'tl.update', { id, row_version: env.version(id), patch: { batch_code: 'B-9' } }));
  env.minutes(1);
  env.allEntryGrades(id);
  const h = env.tl('officer', 'tl.history', { id });
  assert.equal(h.ok, true);
  const kinds = h.data.map((e) => e.kind);
  assert.equal(kinds[0], 'STATUS', 'the move to Probationary is the newest');
  assert.deepEqual(h.data[0].to_status, 'Probationary');
  assert.equal(h.data.filter((e) => e.kind === 'GRADE').length, 5);
  assert.deepEqual(h.data.filter((e) => e.kind === 'FIELD').map((e) => [e.field, e.old_value, e.new_value]), [['batch_code', '', 'B-9']]);
  assert.equal(h.data[h.data.length - 1].kind, 'STATUS');
  assert.equal(h.data[h.data.length - 1].to_status, 'Entry');
  assert.equal(h.data[0].user_name, 'Olivia Tester');
  const ats = h.data.map((e) => e.at);
  assert.deepEqual(ats, ats.slice().sort().reverse());
  // paging by cursor gives every event once
  const seen = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const page = env.tl('officer', 'tl.history', { id, page_size: 3, cursor });
    page.data.forEach((e) => seen.push(e.id));
    cursor = page.meta.page.next_cursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, h.data.map((e) => e.id));
  assert.equal(env.tl('officer', 'tl.history', { id: 'TLE-2026-9999' }).error.code, 'NOT_FOUND');
});

test('Admin can enroll and record entry grades (P2-6), and every role can read', () => {
  const env = setupTl();
  const d = ok(env.enroll({}, 'admin'));
  assert.equal(d.enrollment.status, 'Entry');
  ok(env.grade(d.enrollment.id, env.entryComps[0], 90, {}, 'admin'));
  for (const role of ['officer', 'supervisor', 'manager', 'senior', 'admin']) {
    assert.equal(env.tl(role, 'tl.get', { id: d.enrollment.id }).ok, true, role);
    assert.equal(env.tl(role, 'tl.list', {}).ok, true, role);
    assert.equal(env.tl(role, 'tl.history', { id: d.enrollment.id }).ok, true, role);
  }
  assert.equal(env.call('tl.list', {}).error.code, 'AUTH_REQUIRED');
});
