'use strict';
// Part 2B, Task 12: certification check, certify, extend, fail, quit, return to probation, promote. Invented names only.
// Today in the fake clock is 2026-10-20. Default check: checklist 95, exam 90, kitchen 92, course 95 -> final 92.1 (weights 30/40/30).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTl } = require('../helpers/tl-env');

const LOW = { checklist: 60, exam: 60, kitchen_feedback: 60 };
const rows = (env, t) => env.rows(t);

test('cert check before all entry grades is BLOCKED_BY_RULE RULE-101', () => {
  const env = setupTl();
  const id = env.enrollOk().enrollment.id;
  const r = env.cert(id);
  assert.deepEqual([r.error.code, r.error.rule_id], ['BLOCKED_BY_RULE', 'RULE-101']);
  // A record that is Probationary without every required entry grade (an imported open record) is refused too.
  const id2 = env.enrollOk({ person: { last_name: 'Reyes', first_name: 'Ana' } }).enrollment.id;
  env.g('Repository').transact((uow) => { uow.update('tl_enrollments', id2, { status: 'Probationary' }, { expectedVersion: env.rv(id2), actor: env.actor }); });
  env.grade(id2, 'CMP-0001', 90);
  assert.equal(env.cert(id2).error.rule_id, 'RULE-101');
  assert.equal(rows(env, 'assessments').filter((a) => a.retake_no > 0).length, 0);
});

test('cert check without any feedback is VALIDATION', () => {
  const env = setupTl();
  const id = env.probationary();
  const r = env.cert(id, { kitchen_feedback: undefined });
  assert.equal(r.error.code, 'VALIDATION');
  assert.ok(r.error.fields.some((f) => f.path === 'kitchen_feedback' || f.path === 'manager_feedback'));
  assert.equal(rows(env, 'assessments').filter((a) => a.retake_no > 0).length, 0);
  assert.equal(env.cert(id, { kitchen_feedback: undefined, manager_feedback: 80 }).ok, true);
});

test('cert check validates dates, scores and officers', () => {
  const env = setupTl();
  const id = env.probationary();
  const code = (over) => env.cert(id, over).error.code;
  assert.equal(code({ assessed_on: '2026-10-21' }), 'VALIDATION');
  assert.equal(code({ checklist: 101 }), 'VALIDATION');
  assert.equal(code({ exam: 80.123 }), 'VALIDATION');
  assert.equal(code({ officer_ids: [] }), 'VALIDATION');
  assert.equal(code({ officer_ids: undefined }), 'VALIDATION');
  assert.equal(code({ officer_ids: ['USR-9999'] }), 'VALIDATION');
  assert.equal(code({ officer_ids: [env.users.officer.id, env.users.officer.id] }), 'VALIDATION');
  assert.equal(code({ officer_ids: ['USR-0001', 'USR-0002', 'USR-0003', 'USR-0004', 'USR-0005', 'USR-0006'] }), 'VALIDATION');
  const e = env.enrollOk({ person: { last_name: 'Santos', first_name: 'Bea' }, entry_date: '2026-10-10' }).enrollment.id;
  env.allEntryGrades(e);
  assert.equal(env.cert(e, { assessed_on: '2026-10-09' }).error.code, 'VALIDATION');
  assert.equal(rows(env, 'assessments').filter((a) => a.retake_no > 0).length, 0);
});

test('the first attempt without course_program is VALIDATION; a later attempt may omit it and the earlier grade stays in force', () => {
  const env = setupTl();
  const id = env.probationary();
  const none = env.cert(id, { course_program: undefined });
  assert.equal(none.error.code, 'VALIDATION');
  assert.equal(none.error.fields[0].path, 'course_program');
  env.certOk(id, Object.assign({}, LOW));
  assert.equal(env.statusOf(id), 'Certification check');
  assert.equal(env.act('tl.extend', id, { reason: 'More time' }).ok, true);
  const second = env.cert(id);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.data.course_program.score, 95, 'the earlier course grade is still in force');
  assert.equal(second.data.course_program.retake_no, 1);
  // a later value for the course grade needs a correction reason and supersedes the earlier one
  const count = rows(env, 'assessments').length;
  assert.equal(env.cert(id, { course_program: 80 }).error.code, 'VALIDATION');
  assert.equal(rows(env, 'assessments').length, count, 'the refused call wrote nothing');
});

test('a new attempt has the next retake_no and officer rows', () => {
  const env = setupTl();
  const id = env.probationary();
  const first = env.certOk(id, Object.assign({}, LOW));
  assert.equal(first.attempts.length, 1);
  assert.equal(first.attempts[0].retake_no, 1);
  assert.equal(first.enrollment.final_grade, 60);
  env.act('tl.extend', id, { reason: 'More time' });
  const two = env.users.supervisor.id;
  const second = env.certOk(id, { checklist: 80, exam: 80, kitchen_feedback: 80, manager_feedback: 80, officer_ids: [env.users.officer.id, two] });
  assert.deepEqual(second.attempts.map((a) => a.retake_no), [1, 2]);
  assert.equal(second.enrollment.final_grade, 80);
  const off = rows(env, 'tl_certifying_officers').map((o) => [o.retake_no, o.user_id]);
  assert.deepEqual(off, [[1, env.users.officer.id], [2, env.users.officer.id], [2, two]]);
  assert.equal(second.attempts[1].officers.length, 2);
  assert.equal(second.attempts[1].officers[0].name, 'Olivia Tester');
  assert.equal(second.enrollment.status, 'Certification check');
});

test('a correction in Certification check supersedes the attempt\'s rows and keeps the officers', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id);
  const before = rows(env, 'assessments').filter((a) => a.retake_no === 1);
  const officersBefore = JSON.stringify(rows(env, 'tl_certifying_officers'));
  const noReason = env.cert(id, { exam: 70 });
  assert.equal(noReason.error.code, 'VALIDATION');
  assert.equal(noReason.error.fields[0].path, 'correction_reason');
  const fixed = env.cert(id, { exam: 70, correction_reason: 'Exam re-marked', officer_ids: [env.users.admin.id] });
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  const after = rows(env, 'assessments').filter((a) => a.retake_no === 1);
  assert.equal(after.length, before.length + 1, 'only the changed score gets a new row');
  assert.deepEqual(after.slice(0, before.length), before, 'the old rows are untouched');
  const added = after[after.length - 1];
  assert.equal(added.score, 70);
  assert.equal(added.supersedes_id, before.find((a) => a.component_id === env.CERT.exam).id);
  assert.equal(added.correction_reason, 'Exam re-marked');
  assert.equal(JSON.stringify(rows(env, 'tl_certifying_officers')), officersBefore, 'the officers stay as recorded');
  assert.equal(fixed.data.attempts.length, 1);
  assert.equal(fixed.data.attempts[0].scores.exam, 70);
  assert.equal(fixed.data.enrollment.final_grade, 84.1);
  assert.equal(fixed.data.enrollment.status, 'Certification check');
  assert.equal(env.cert(id, { exam: 70, correction_reason: 'Nothing changed' }).error.code, 'VALIDATION', 'a correction that changes nothing is refused');
});

test('certify stamps pass mark, weights_version and certified_on = the check date', () => {
  const env = setupTl();
  const id = env.probationary({ entry_date: '2026-10-10' });
  env.certOk(id, { assessed_on: '2026-10-15' });
  const r = env.act('tl.certify', id);
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = r.data.enrollment;
  assert.deepEqual([e.status, e.certified_on, e.pass_mark_used, e.weights_version], ['Certified', '2026-10-15', 85, 'CFG-041@v1;CFG-044@v1;CFG-045@v1']);
  assert.equal(e.final_grade, 92.1);
  const h = rows(env, 'status_history').filter((x) => x.entity_id === id).pop();
  assert.deepEqual([h.from_status, h.to_status, h.effective_date], ['Certification check', 'Certified', '2026-10-15']);
});

test('certify uses the settings in force on the check date', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id);
  // A new pass mark from today does not change what applies to the check of today, but a check dated earlier keeps version 1.
  const cur = rows(env, 'settings').find((s) => s.setting_key === 'CFG-041');
  env.call('settings.set', { setting_key: 'CFG-041', value: '95', supersedes_id: cur.id, reason: 'Raised' }, env.t.admin);
  const r = env.act('tl.certify', id);
  assert.equal(r.ok, false, 'the check of today is judged by version 2 (95): 92.1 is below it');
  assert.equal(r.error.rule_id, 'RULE-102');
});

test('certify below the pass mark is BLOCKED_BY_RULE RULE-102', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  const r = env.act('tl.certify', id);
  assert.deepEqual([r.error.code, r.error.rule_id], ['BLOCKED_BY_RULE', 'RULE-102']);
  assert.equal(env.statusOf(id), 'Certification check');
});

test('a course grade below TLMI-001 blocks certify, and the record can be extended (X-4)', () => {
  const env = setupTl();
  const id = env.probationary();
  const d = env.certOk(id, { course_program: 89 });
  assert.ok(d.enrollment.final_grade >= 85);
  assert.equal(env.act('tl.certify', id).error.rule_id, 'RULE-102');
  assert.ok(d.allowed_actions.includes('extend') && !d.allowed_actions.includes('certify'));
  assert.equal(env.act('tl.extend', id, { reason: 'Retake the course' }).ok, true);
  assert.equal(env.statusOf(id), 'Extended');
});

test('certify from the wrong state is BLOCKED_BY_RULE', () => {
  const env = setupTl();
  const id = env.probationary();
  assert.equal(env.act('tl.certify', id).error.code, 'BLOCKED_BY_RULE');
});

test('extend without CFG-047 is CONFIG_MISSING', () => {
  const env = setupTl({ extensionLimit: false });
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  const r = env.act('tl.extend', id, { reason: 'More time' });
  assert.equal(r.error.code, 'CONFIG_MISSING');
  assert.match(r.error.message, /CFG-047/);
  assert.equal(env.statusOf(id), 'Certification check');
});

test('extend writes extension 1 with deadline + 30 days and sets Extended', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  const old = env.rows('tl_enrollments')[0].deadline;
  assert.equal(old, '2027-01-20');
  const r = env.act('tl.extend', id, { reason: 'More time' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.enrollment.status, 'Extended');
  assert.equal(r.data.enrollment.deadline, '2027-02-19');
  const x = rows(env, 'tl_extensions');
  assert.equal(x.length, 1);
  assert.deepEqual([x[0].tl_enrollment_id, x[0].extension_no, x[0].old_deadline, x[0].new_deadline, x[0].reason], [id, 1, '2027-01-20', '2027-02-19', 'More time']);
  assert.ok(rows(env, 'record_history').some((h) => h.field === 'deadline' && h.new_value === '2027-02-19'));
  assert.equal(r.data.extensions.length, 1);
});

test('extend at the limit is BLOCKED_BY_RULE RULE-104', () => {
  const env = setupTl({ extensionLimit: 1 });
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  assert.equal(env.act('tl.extend', id, { reason: 'First' }).ok, true);
  env.certOk(id, Object.assign({}, LOW));
  const r = env.act('tl.extend', id, { reason: 'Second' });
  assert.deepEqual([r.error.code, r.error.rule_id], ['BLOCKED_BY_RULE', 'RULE-104']);
  assert.equal(rows(env, 'tl_extensions').length, 1);
});

test('after an extension the next check is a new attempt and returns to Certification check', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  env.act('tl.extend', id, { reason: 'More time' });
  assert.equal(env.statusOf(id), 'Extended');
  const r = env.cert(id, { checklist: 96, exam: 96, kitchen_feedback: 96 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.enrollment.status, 'Certification check');
  assert.equal(r.data.attempts.length, 2);
  const hist = rows(env, 'status_history').filter((x) => x.entity_id === id).map((x) => x.to_status);
  assert.deepEqual(hist, ['Entry', 'Probationary', 'Certification check', 'Extended', 'Certification check']);
  assert.equal(env.act('tl.certify', id).ok, true);
});

test('close needs a close reason', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  assert.equal(env.act('tl.close', id, {}).error.code, 'VALIDATION');
  assert.equal(env.act('tl.close', id, { close_reason_id: 'LKP-9999' }).error.code, 'VALIDATION');
  assert.equal(env.act('tl.close', id, { close_reason_id: env.quitReasonId }).error.code, 'VALIDATION', 'a quit reason is not a close reason');
  const r = env.act('tl.close', id, { close_reason_id: env.closeReasonId, remark: 'Did not reach the mark' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.enrollment.status, r.data.enrollment.close_reason_id], ['Failed', env.closeReasonId]);
  assert.ok(rows(env, 'audit_log').some((a) => a.event === 'TL.FAILED' && a.entity_id === id));
});

test('close is not allowed from Probationary', () => {
  const env = setupTl();
  const id = env.probationary();
  assert.equal(env.act('tl.close', id, { close_reason_id: env.closeReasonId }).error.code, 'BLOCKED_BY_RULE');
});

test('quit with an empty quit reason list is CONFIG_MISSING CFG-018', () => {
  const env = setupTl({ quitReason: false });
  const id = env.probationary();
  const r = env.act('tl.quit', id, { quit_date: '2026-10-20', quit_reason_lookup_id: 'LKP-0007' });
  assert.equal(r.error.code, 'CONFIG_MISSING');
  assert.match(r.error.message, /CFG-018/);
});

test('quit closes as Quit, never Failed', () => {
  const env = setupTl();
  const id = env.probationary({ entry_date: '2026-10-10' });
  assert.equal(env.act('tl.quit', id, { quit_date: '2026-10-09', quit_reason_lookup_id: env.quitReasonId }).error.code, 'VALIDATION');
  assert.equal(env.act('tl.quit', id, { quit_date: '2026-10-21', quit_reason_lookup_id: env.quitReasonId }).error.code, 'VALIDATION');
  assert.equal(env.act('tl.quit', id, { quit_date: '2026-10-15', quit_reason_lookup_id: env.closeReasonId }).error.code, 'VALIDATION');
  const r = env.act('tl.quit', id, { quit_date: '2026-10-15', quit_reason_lookup_id: env.quitReasonId, remark: 'Moved away' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.enrollment.status, r.data.enrollment.quit_date, r.data.enrollment.quit_reason_lookup_id], ['Quit', '2026-10-15', env.quitReasonId]);
  assert.equal(r.data.open, false);
  const h = rows(env, 'status_history').filter((x) => x.entity_id === id).pop();
  assert.deepEqual([h.to_status, h.effective_date, h.remark], ['Quit', '2026-10-15', 'Moved away']);
  // closed records accept nothing more
  assert.equal(env.act('tl.quit', id, { quit_date: '2026-10-16', quit_reason_lookup_id: env.quitReasonId }).error.code, 'BLOCKED_BY_RULE');
  assert.equal(env.grade(id, 'CMP-0001', 80, { correction_reason: 'x' }).error.code, 'BLOCKED_BY_RULE');
});

test('return to probation needs a note and keeps the deadline', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  const deadline = env.rows('tl_enrollments')[0].deadline;
  assert.equal(env.act('tl.returnToProbation', id, {}, env.t.supervisor).error.code, 'VALIDATION');
  const r = env.act('tl.returnToProbation', id, { note: 'Needs more floor time' }, env.t.supervisor);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.enrollment.status, r.data.enrollment.deadline], ['Probationary', deadline]);
  const h = rows(env, 'status_history').filter((x) => x.entity_id === id).pop();
  assert.deepEqual([h.from_status, h.to_status, h.remark], ['Certification check', 'Probationary', 'Needs more floor time']);
  assert.ok(rows(env, 'audit_log').some((a) => a.event === 'TL.RETURNED_TO_PROBATION'));
  // not from Probationary
  assert.equal(env.act('tl.returnToProbation', id, { note: 'Again' }, env.t.manager).error.code, 'BLOCKED_BY_RULE');
});

test('an officer gets FORBIDDEN on promote and return to probation, and so does Admin', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id);
  env.act('tl.certify', id);
  for (const role of ['officer', 'admin']) {
    assert.equal(env.act('tl.promote', id, { promoted_on: '2026-10-20' }, env.t[role]).error.code, 'FORBIDDEN', role);
    assert.equal(env.act('tl.returnToProbation', id, { note: 'x' }, env.t[role]).error.code, 'FORBIDDEN', role);
  }
  assert.equal(env.statusOf(id), 'Certified');
});

test('promote only from Certified, by S M Sr, with a valid date', () => {
  const env = setupTl();
  const id = env.probationary({ entry_date: '2026-10-10' });
  assert.equal(env.act('tl.promote', id, { promoted_on: '2026-10-20' }, env.t.supervisor).error.code, 'BLOCKED_BY_RULE');
  env.certOk(id, { assessed_on: '2026-10-18' });
  env.act('tl.certify', id);
  assert.equal(env.act('tl.promote', id, { promoted_on: '2026-10-17' }, env.t.supervisor).error.code, 'VALIDATION', 'before certified_on');
  assert.equal(env.act('tl.promote', id, { promoted_on: '2026-10-21' }, env.t.supervisor).error.code, 'VALIDATION', 'after today');
  for (const role of ['supervisor', 'manager', 'senior']) {
    const e = env.enrollOk({ person: { last_name: 'P' + role, first_name: 'Test' } }).enrollment.id;
    env.allEntryGrades(e);
    env.certOk(e);
    env.act('tl.certify', e);
    const r = env.act('tl.promote', e, { promoted_on: '2026-10-20' }, env.t[role]);
    assert.equal(r.ok, true, role + JSON.stringify(r));
    assert.deepEqual([r.data.enrollment.status, r.data.enrollment.promoted_on], ['Promoted', '2026-10-20']);
  }
});

test('two officers at once: the second gets CONFLICT and writes nothing', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  const rv = env.rv(id);
  const a = env.call('tl.extend', { id, row_version: rv, reason: 'First officer' }, env.t.officer);
  assert.equal(a.ok, true, JSON.stringify(a));
  const tables = ['tl_enrollments', 'tl_extensions', 'status_history', 'record_history', 'assessments'];
  const counters = () => JSON.stringify(rows(env, 'id_counters').filter((c) => c.prefix !== 'AUD-'));
  const snapshot = tables.map((t) => JSON.stringify(rows(env, t))).concat(counters());
  const auditBefore = rows(env, 'audit_log').filter((x) => x.event.startsWith('TL.')).length;
  const b = env.call('tl.close', { id, row_version: rv, close_reason_id: env.closeReasonId }, env.t.supervisor);
  assert.equal(b.error.code, 'CONFLICT');
  assert.ok(b.error.current.row_version > rv);
  assert.ok(b.error.current.updated_by_name);
  const after = tables.map((t) => JSON.stringify(rows(env, t))).concat(counters());
  assert.deepEqual(after, snapshot);
  assert.equal(rows(env, 'audit_log').filter((x) => x.event.startsWith('TL.')).length, auditBefore, 'no TL audit row for the refused call');
  assert.equal(env.statusOf(id), 'Extended');
});

test('a stale row_version on a certification check or an entry-grade call is CONFLICT when the record changed', () => {
  const env = setupTl();
  const id = env.probationary();
  const stale = env.rv(id);
  env.act('tl.update', id, { patch: { remarks: 'Changed' } });
  assert.equal(env.cert(id, { row_version: stale }).error.code, 'CONFLICT');
  assert.equal(env.call('tl.recordEntryGrade', { id, row_version: stale, component_id: 'CMP-0001', score: 70, assessed_on: '2026-10-20', correction_reason: 'x' }, env.t.officer).error.code, 'CONFLICT');
  assert.equal(rows(env, 'assessments').filter((a) => a.retake_no > 0).length, 0);
});

test('every action writes status_history and its audit event', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id, Object.assign({}, LOW));
  env.act('tl.extend', id, { reason: 'More time' });
  env.certOk(id);
  env.act('tl.certify', id);
  env.act('tl.promote', id, { promoted_on: '2026-10-20' }, env.t.manager);
  const events = rows(env, 'audit_log').filter((a) => a.entity_id === id).map((a) => a.event);
  for (const ev of ['TL.ENROLLED', 'TL.ENTRY_GRADE_RECORDED', 'TL.CERT_CHECK_RECORDED', 'TL.EXTENDED', 'TL.CERTIFIED', 'TL.PROMOTED']) {
    assert.ok(events.includes(ev), ev);
  }
  const path = rows(env, 'status_history').filter((x) => x.entity_id === id).map((x) => x.to_status);
  assert.deepEqual(path, ['Entry', 'Probationary', 'Certification check', 'Extended', 'Certification check', 'Certified', 'Promoted']);
  // history reads back all of it
  const h = env.call('tl.history', { id }, env.t.officer);
  assert.ok(h.data.some((x) => x.kind === 'EXTENSION') && h.data.some((x) => x.kind === 'OFFICER'));
});

test('computed values are never accepted from the caller', () => {
  const env = setupTl();
  const id = env.probationary();
  for (const extra of [{ final_grade: 100 }, { deadline: '2030-01-01' }, { pass_mark_used: 1 }, { weights_version: 'x' }, { status: 'Certified' }]) {
    const r = env.cert(id, extra);
    assert.equal(r.error.code, 'VALIDATION', JSON.stringify(extra));
  }
  assert.equal(env.enroll({ deadline: '2030-01-01' }).error.code, 'VALIDATION');
  assert.equal(env.act('tl.certify', id, { certified_on: '2026-01-01' }).error.code, 'VALIDATION');
  assert.equal(rows(env, 'assessments').filter((a) => a.retake_no > 0).length, 0);
});

test('a correction never changes or deletes the row it corrects (entry grade and certification check)', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id);
  const snapshot = rows(env, 'assessments');
  env.grade(id, 'CMP-0002', 70, { correction_reason: 'Typing error' });
  env.cert(id, { checklist: 99, correction_reason: 'Re-scored' });
  env.cert(id, { checklist: 98, course_program: 91, correction_reason: 'Re-scored again' });
  const after = rows(env, 'assessments');
  assert.deepEqual(after.slice(0, snapshot.length), snapshot);
  assert.equal(after.length, snapshot.length + 4);
  const d = env.get(id).data;
  assert.equal(d.entry.grades.find((g) => g.component_id === 'CMP-0002').score, 70);
  assert.equal(d.attempts[0].scores.checklist, 98);
  assert.equal(d.course_program.score, 91);
  assert.equal(d.course_program.retake_no, 1);
});

test('every role against every new method matches the permission table', () => {
  const env = setupTl();
  const table = env.plain(env.g('AuthService').PERMISSIONS);
  const methods = Object.keys(table).filter((m) => m.startsWith('tl.') || m.startsWith('persons.'));
  assert.equal(methods.length, 15);
  const ROLE = { 'Training Officer': 'officer', 'Training Supervisor': 'supervisor', 'Training Manager': 'manager', 'Senior Training Manager': 'senior', Admin: 'admin' };
  for (const m of methods) {
    for (const [roleName, key] of Object.entries(ROLE)) {
      const res = env.call(m, { id: 'X-1', row_version: 1 }, env.t[key]);
      const allowed = table[m].includes(roleName);
      if (allowed) assert.notEqual(res.error && res.error.code, 'FORBIDDEN', m + ' ' + key);
      else assert.equal(res.error.code, 'FORBIDDEN', m + ' ' + key);
    }
  }
  assert.deepEqual(table['tl.promote'].slice().sort(), ['Senior Training Manager', 'Training Manager', 'Training Supervisor']);
  assert.deepEqual(table['tl.returnToProbation'].slice().sort(), ['Senior Training Manager', 'Training Manager', 'Training Supervisor']);
});

test('tl.get returns allowed_actions from the same TlRules.decide for each role', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id);
  const act = (role) => env.get(id, env.t[role]).data.allowed_actions.slice().sort();
  assert.deepEqual(act('officer'), ['certify', 'close', 'quit', 'recordCertCheck', 'recordEntryGrade']);
  assert.deepEqual(act('admin'), ['certify', 'close', 'quit', 'recordCertCheck', 'recordEntryGrade']);
  assert.deepEqual(act('supervisor'), ['certify', 'close', 'quit', 'recordCertCheck', 'recordEntryGrade', 'returnToProbation']);
  env.act('tl.certify', id);
  assert.deepEqual(act('officer'), []);
  assert.deepEqual(act('manager'), ['promote']);
});

test('no password, hash, salt or token appears in a Team Leader response or audit row', () => {
  const env = setupTl();
  const id = env.probationary();
  env.certOk(id);
  const out = JSON.stringify([env.get(id), env.call('tl.list', {}, env.t.officer), env.call('tl.history', { id }, env.t.officer)]);
  for (const k of ['password_hash', 'salt', 'hmac-sha256', env.PASSWORD]) assert.ok(!out.includes(k), k);
  assert.ok(!JSON.stringify(rows(env, 'audit_log').filter((a) => a.event.startsWith('TL.'))).includes('hmac-sha256'));
});
