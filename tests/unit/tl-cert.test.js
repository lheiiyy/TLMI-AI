'use strict';
// Part 2B, Task 12: the certification check, certify, extend, fail, quit, return to probation and promote.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTl } = require('../helpers/tl-env');

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const status = (env, id) => env.rows('tl_enrollments').find((e) => e.id === id).status;

// A record in Certification check with final 83.3 (below the pass mark 85) and course grade 95.
function inCheck(env, o) {
  const id = env.probationary(o);
  ok(env.check(id));
  return id;
}

// A record in Certification check with a passing final (90) and a passing course grade.
function passing(env, o) {
  const id = env.probationary(o);
  ok(env.check(id, { checklist: 95, exam: 90, kitchen_feedback: 90, manager_feedback: 90, course_program: 92 }));
  return id;
}

test('a certification check before all entry grades is BLOCKED_BY_RULE RULE-101', () => {
  const env = setupTl();
  const id = ok(env.enroll()).enrollment.id;
  const r = env.check(id);
  assert.equal(r.error.code, 'BLOCKED_BY_RULE');
  assert.equal(r.error.rule_id, 'RULE-101');
  env.grade(id, env.entryComps[0], 90);
  assert.equal(env.check(id).error.rule_id, 'RULE-101');
  assert.equal(env.rows('assessments').filter((a) => a.retake_no >= 1).length, 0);
});

test('a certification check without any feedback is VALIDATION', () => {
  const env = setupTl();
  const id = env.probationary();
  const r = env.check(id, { kitchen_feedback: undefined, manager_feedback: undefined });
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].path, 'kitchen_feedback');
  // one form is enough
  assert.equal(ok(env.check(id, { manager_feedback: undefined })).final_grade, 84.5);
});

test('the first attempt without course_program is VALIDATION; a later attempt may omit it and the earlier grade stays in force', () => {
  const env = setupTl();
  env.setting('CFG-047', 2);
  const id = env.probationary();
  const no = env.check(id, { course_program: undefined });
  assert.equal(no.error.code, 'VALIDATION');
  assert.equal(no.error.fields[0].path, 'course_program');
  assert.equal(env.rows('assessments').filter((a) => a.retake_no >= 1).length, 0);
  ok(env.check(id));
  ok(env.act(id, 'tl.extend', { reason: 'More practice' }));
  const second = ok(env.check(id, { assessed_on: '2026-10-18', checklist: 100, course_program: undefined }));
  assert.equal(second.retake_no, 2);
  const view = ok(env.get(id));
  assert.equal(view.course_program.score, 95);
  assert.equal(view.course_program.retake_no, 1, 'recorded once, by the attempt that recorded it');
  assert.equal(view.checks.length, 2);
});

test('a new attempt has the next retake_no and officer rows, and moves the status to Certification check', () => {
  const env = setupTl();
  env.setting('CFG-047', 2);
  const id = env.probationary();
  const first = ok(env.check(id, { officer_ids: [env.users.officer.id, env.users.supervisor.id] }));
  assert.equal(first.retake_no, 1);
  assert.equal(first.final_grade, 83.3);
  assert.equal(first.enrollment.status, 'Certification check');
  assert.equal(first.enrollment.final_grade, 83.3);
  const rows = env.rows('assessments').filter((a) => a.retake_no >= 1);
  assert.deepEqual(rows.map((a) => a.score).sort((x, y) => x - y), [75, 80, 85, 90, 95]);
  assert.ok(rows.every((a) => a.assessed_on === '2026-10-15' && a.assessed_by === env.users.officer.id));
  assert.deepEqual(env.rows('tl_certifying_officers').map((o) => [o.user_id, o.retake_no]), [[env.users.officer.id, 1], [env.users.supervisor.id, 1]]);
  ok(env.act(id, 'tl.extend', { reason: 'Again' }));
  const second = ok(env.check(id, { assessed_on: '2026-10-19', checklist: 99, officer_ids: [env.users.manager.id] }));
  assert.equal(second.retake_no, 2);
  assert.equal(env.rows('tl_certifying_officers').filter((o) => o.retake_no === 2).length, 1);
  const view = ok(env.get(id));
  assert.deepEqual(view.checks.map((c) => c.retake_no), [1, 2]);
  assert.deepEqual(view.checks[0].officers.map((o) => o.name), ['Olivia Tester', 'Sam Supervisor']);
});

test('the officers must be 1 to 5 distinct active users whose role may certify', () => {
  const env = setupTl();
  const id = env.probationary();
  for (const officer_ids of [[], ['USR-9999'], [env.users.officer.id, env.users.officer.id], ['a', 'b', 'c', 'd', 'e', 'f']]) {
    assert.equal(env.check(id, { officer_ids }).error.code, 'VALIDATION', JSON.stringify(officer_ids));
  }
  assert.equal(env.check(id, { officer_ids: undefined }).error.fields[0].path, 'officer_ids');
  assert.equal(env.rows('assessments').filter((a) => a.retake_no >= 1).length, 0);
  assert.equal(ok(env.check(id, { officer_ids: [env.users.admin.id] })).retake_no, 1, 'Admin may be a certifying officer (P2-6)');
});

test('the check date is not before the entry date and not after today', () => {
  const env = setupTl();
  const id = env.probationary();
  assert.equal(env.check(id, { assessed_on: '2026-09-30' }).error.fields[0].path, 'assessed_on');
  assert.equal(env.check(id, { assessed_on: '2026-10-21' }).error.fields[0].path, 'assessed_on');
  assert.equal(env.check(id, { checklist: 101 }).error.code, 'VALIDATION');
});

test('a correction in Certification check supersedes the attempt\'s rows, keeps the officers, and recomputes the final', () => {
  const env = setupTl();
  const id = inCheck(env);
  const before = env.rows('assessments').filter((a) => a.retake_no === 1);
  const noReason = env.check(id, { checklist: 100 });
  assert.equal(noReason.error.code, 'VALIDATION');
  assert.equal(noReason.error.fields[0].path, 'correction_reason');
  const r = ok(env.check(id, { checklist: 100, correction_reason: 'Checklist added up wrongly' }));
  assert.equal(r.retake_no, 1);
  assert.equal(r.final_grade, 86.3);
  assert.equal(r.enrollment.status, 'Certification check');
  const after = env.rows('assessments').filter((a) => a.retake_no === 1);
  assert.equal(after.length, before.length + 1, 'only the changed score is a new row');
  const old = before.find((a) => a.component_id === env.comp('Checklist'));
  const fresh = after.find((a) => a.supersedes_id === old.id);
  assert.equal(fresh.score, 100);
  assert.equal(fresh.correction_reason, 'Checklist added up wrongly');
  assert.equal(env.rows('assessments').find((a) => a.id === old.id).score, 90, 'the old row is untouched');
  assert.equal(env.rows('tl_certifying_officers').length, 1);
  assert.equal(env.rows('status_history').filter((h) => h.to_status === 'Certification check').length, 1, 'no new status row');
  // nothing changed is refused
  const same = env.check(id, { checklist: 100, correction_reason: 'x' });
  assert.equal(same.error.code, 'VALIDATION');
  assert.equal(same.error.fields[0].code, 'NO_CHANGE');
  // a feedback form that was missing can be added, and the course program grade corrected with a reason
  const added = ok(env.check(id, { checklist: 100, manager_feedback: 80, course_program: 88, correction_reason: 'Late form' }));
  assert.equal(added.final_grade, 86.9);
  assert.equal(ok(env.get(id)).course_program.score, 88);
});

test('certify stamps the pass mark, the weights version and certified_on = the check date', () => {
  const env = setupTl();
  const id = passing(env);
  const r = ok(env.act(id, 'tl.certify'));
  const e = r.enrollment;
  assert.deepEqual([e.status, e.certified_on, e.pass_mark_used, e.weights_version], ['Certified', '2026-10-15', 85, 'CFG-041@v1;CFG-044@v1;CFG-045@v1']);
  // a later change of the pass mark never changes the stamped record
  env.setting('CFG-041', 95);
  assert.equal(env.rows('tl_enrollments').find((x) => x.id === id).pass_mark_used, 85);
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.CERTIFIED' && a.entity_id === id));
});

test('certify below the pass mark is BLOCKED_BY_RULE RULE-102, and from another status WF-002', () => {
  const env = setupTl();
  const id = inCheck(env);
  const r = env.act(id, 'tl.certify');
  assert.equal(r.error.code, 'BLOCKED_BY_RULE');
  assert.equal(r.error.rule_id, 'RULE-102');
  assert.equal(status(env, id), 'Certification check');
  const p = env.probationary({ person: { last_name: 'Reyes', first_name: 'Ana' } });
  assert.equal(env.act(p, 'tl.certify').error.rule_id, 'WF-002');
});

test('the course program grade must reach TLMI-001 (90): 89.99 blocks certify, 90 passes; a change of the mark is used', () => {
  const env = setupTl();
  const id = env.probationary();
  ok(env.check(id, { checklist: 95, exam: 90, kitchen_feedback: 90, manager_feedback: 90, course_program: 89.99 }));
  const r = env.act(id, 'tl.certify');
  assert.equal(r.error.rule_id, 'RULE-102');
  assert.match(r.error.message, /course program/);
  ok(env.check(id, { checklist: 95, exam: 90, kitchen_feedback: 90, manager_feedback: 90, course_program: 90, correction_reason: 'Re-marked' }));
  env.setting('TLMI-001', 95);
  // the mark in force on the check date (the seed version) still applies to a check made on that date
  assert.equal(ok(env.act(id, 'tl.certify')).enrollment.status, 'Certified');
});

test('extend without CFG-047 is CONFIG_MISSING, with it extension 1 moves the deadline by CFG-042 days and sets Extended', () => {
  const env = setupTl();
  const id = inCheck(env);
  const none = env.act(id, 'tl.extend', { reason: 'Needs practice' });
  assert.equal(none.error.code, 'CONFIG_MISSING');
  assert.ok(none.error.message.includes('CFG-047'));
  assert.equal(status(env, id), 'Certification check');
  env.setting('CFG-047', 2);
  const deadline = env.rows('tl_enrollments').find((e) => e.id === id).deadline;
  assert.equal(deadline, '2027-01-01');
  const r = ok(env.act(id, 'tl.extend', { reason: 'Needs practice' }));
  assert.equal(r.enrollment.status, 'Extended');
  assert.equal(r.enrollment.deadline, '2027-01-31');
  assert.deepEqual([r.extension.extension_no, r.extension.old_deadline, r.extension.new_deadline, r.extension.reason], [1, '2027-01-01', '2027-01-31', 'Needs practice']);
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.EXTENDED'));
  const view = ok(env.get(id));
  assert.equal(view.extensions.length, 1);
});

test('extend at the limit is BLOCKED_BY_RULE RULE-104', () => {
  const env = setupTl();
  env.setting('CFG-047', 1);
  const id = inCheck(env);
  ok(env.act(id, 'tl.extend', { reason: 'One' }));
  ok(env.check(id, { assessed_on: '2026-10-18' }));
  const r = env.act(id, 'tl.extend', { reason: 'Two' });
  assert.equal(r.error.code, 'BLOCKED_BY_RULE');
  assert.equal(r.error.rule_id, 'RULE-104');
  assert.equal(status(env, id), 'Certification check');
  assert.equal(env.rows('tl_extensions').length, 1);
});

test('interim X-4: a passing final with a course grade below TLMI-001 may be extended but not certified', () => {
  const env = setupTl();
  env.setting('CFG-047', 2);
  const id = env.probationary();
  ok(env.check(id, { checklist: 95, exam: 90, kitchen_feedback: 90, manager_feedback: 90, course_program: 85 }));
  assert.equal(env.act(id, 'tl.certify').error.rule_id, 'RULE-102');
  assert.deepEqual(ok(env.get(id)).allowed_actions.sort(), ['close', 'extend', 'quit', 'recordCertCheck', 'recordEntryGrade']);
  assert.equal(ok(env.act(id, 'tl.extend', { reason: 'Retake the course' })).enrollment.status, 'Extended');
  // both pass: certify, not extend
  const p = env.probationary({ person: { last_name: 'Reyes', first_name: 'Ana' } });
  ok(env.check(p, { checklist: 95, exam: 90, kitchen_feedback: 90, manager_feedback: 90, course_program: 95 }));
  assert.equal(env.act(p, 'tl.extend', { reason: 'x' }).error.rule_id, 'RULE-104');
});

test('after an extension the next check is a new attempt and returns the record to Certification check', () => {
  const env = setupTl();
  env.setting('CFG-047', 2);
  const id = inCheck(env);
  ok(env.act(id, 'tl.extend', { reason: 'More time' }));
  assert.equal(status(env, id), 'Extended');
  const second = ok(env.check(id, { assessed_on: '2026-10-19', checklist: 100, exam: 95, kitchen_feedback: 95, manager_feedback: 95, course_program: undefined }));
  assert.equal(second.retake_no, 2);
  assert.equal(second.enrollment.status, 'Certification check');
  assert.equal(ok(env.act(id, 'tl.certify')).enrollment.certified_on, '2026-10-19');
  const hist = env.rows('status_history').filter((h) => h.entity_id === id).map((h) => h.to_status);
  assert.deepEqual(hist, ['Entry', 'Probationary', 'Certification check', 'Extended', 'Certification check', 'Certified']);
});

test('close needs a close reason from the list, and sets Failed', () => {
  const env = setupTl();
  const id = inCheck(env);
  assert.equal(env.act(id, 'tl.close', {}).error.code, 'VALIDATION');
  assert.equal(env.act(id, 'tl.close', { close_reason_id: 'LKP-9999' }).error.fields[0].path, 'close_reason_id');
  const location = env.rows('lookups').find((l) => l.category === 'location_type');
  assert.equal(env.act(id, 'tl.close', { close_reason_id: location.id }).error.fields[0].path, 'close_reason_id', 'another category is refused');
  const reason = env.rows('lookups').find((l) => l.category === 'tl_close_reason');
  const r = ok(env.act(id, 'tl.close', { close_reason_id: reason.id, remark: 'Did not reach the standard' }));
  assert.equal(r.enrollment.status, 'Failed');
  assert.equal(r.enrollment.close_reason_id, reason.id);
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.FAILED'));
  // from Probationary a close is not allowed
  const p = env.probationary({ person: { last_name: 'Reyes', first_name: 'Ana' } });
  assert.equal(env.act(p, 'tl.close', { close_reason_id: reason.id }).error.code, 'BLOCKED_BY_RULE');
});

test('quit with an empty quit reason list is CONFIG_MISSING CFG-018, and quit closes as Quit, never Failed', () => {
  const env = setupTl();
  const id = env.probationary();
  const none = env.act(id, 'tl.quit', { quit_date: '2026-10-10', quit_reason_lookup_id: 'LKP-0001' });
  assert.equal(none.error.code, 'CONFIG_MISSING');
  assert.ok(none.error.message.includes('CFG-018'));
  const reason = ok(env.call('lookups.create', { category: 'tl_quit_reason', value: 'Personal reasons', label: 'Personal reasons' }, env.token('admin')));
  assert.equal(env.act(id, 'tl.quit', { quit_date: '2026-09-30', quit_reason_lookup_id: reason.id }).error.fields[0].path, 'quit_date');
  assert.equal(env.act(id, 'tl.quit', { quit_date: '2026-10-21', quit_reason_lookup_id: reason.id }).error.fields[0].path, 'quit_date');
  assert.equal(env.act(id, 'tl.quit', { quit_date: '2026-10-10', quit_reason_lookup_id: 'LKP-9999' }).error.fields[0].path, 'quit_reason_lookup_id');
  const r = ok(env.act(id, 'tl.quit', { quit_date: '2026-10-10', quit_reason_lookup_id: reason.id }));
  assert.equal(r.enrollment.status, 'Quit');
  assert.equal(r.enrollment.quit_date, '2026-10-10');
  assert.equal(r.enrollment.close_reason_id, '');
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.QUIT'));
  assert.equal(env.rows('status_history').filter((h) => h.entity_id === id).pop().effective_date, '2026-10-10');
  // a quit record cannot quit again, and cannot be graded
  assert.equal(env.act(id, 'tl.quit', { quit_date: '2026-10-10', quit_reason_lookup_id: reason.id }).error.code, 'BLOCKED_BY_RULE');
});

test('quit is possible from every open status', () => {
  const env = setupTl();
  env.setting('CFG-047', 2);
  const reason = ok(env.call('lookups.create', { category: 'tl_quit_reason', value: 'Moved away', label: 'Moved away' }, env.token('admin')));
  const quit = (id) => env.act(id, 'tl.quit', { quit_date: '2026-10-10', quit_reason_lookup_id: reason.id });
  const entry = ok(env.enroll()).enrollment.id;
  assert.equal(ok(quit(entry)).enrollment.status, 'Quit');
  const prob = env.probationary({ person: { last_name: 'A', first_name: 'One' } });
  assert.equal(ok(quit(prob)).enrollment.status, 'Quit');
  const check = inCheck(env, { person: { last_name: 'B', first_name: 'Two' } });
  assert.equal(ok(quit(check)).enrollment.status, 'Quit');
  const ext = inCheck(env, { person: { last_name: 'C', first_name: 'Three' } });
  ok(env.act(ext, 'tl.extend', { reason: 'x' }));
  assert.equal(ok(quit(ext)).enrollment.status, 'Quit');
  const cert = passing(env, { person: { last_name: 'D', first_name: 'Four' } });
  ok(env.act(cert, 'tl.certify'));
  assert.equal(quit(cert).error.code, 'BLOCKED_BY_RULE');
});

test('return to probation needs a note, keeps the deadline, and is for Supervisor, Manager and Senior', () => {
  const env = setupTl();
  env.setting('CFG-047', 2);
  const id = inCheck(env);
  const deadline = env.rows('tl_enrollments').find((e) => e.id === id).deadline;
  assert.equal(env.act(id, 'tl.returnToProbation', {}, 'supervisor').error.code, 'VALIDATION');
  assert.equal(env.act(id, 'tl.returnToProbation', { note: 'Needs more weeks' }, 'officer').error.code, 'FORBIDDEN');
  assert.equal(env.act(id, 'tl.returnToProbation', { note: 'Needs more weeks' }, 'admin').error.code, 'FORBIDDEN');
  const r = ok(env.act(id, 'tl.returnToProbation', { note: 'Needs more weeks' }, 'supervisor'));
  assert.equal(r.enrollment.status, 'Probationary');
  assert.equal(r.enrollment.deadline, deadline);
  assert.equal(env.rows('status_history').filter((h) => h.entity_id === id).pop().remark, 'Needs more weeks');
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.RETURNED_TO_PROBATION'));
  // from Extended too; from Probationary or Entry it is blocked
  ok(env.check(id, { assessed_on: '2026-10-18' }));
  ok(env.act(id, 'tl.extend', { reason: 'x' }));
  assert.equal(ok(env.act(id, 'tl.returnToProbation', { note: 'Again' }, 'manager')).enrollment.status, 'Probationary');
  assert.equal(env.act(id, 'tl.returnToProbation', { note: 'Again' }, 'senior').error.code, 'BLOCKED_BY_RULE');
});

test('an officer gets FORBIDDEN on promote, and promote works only from Certified', () => {
  const env = setupTl();
  const id = passing(env);
  const before = env.rows('audit_log').length;
  const denied = env.act(id, 'tl.promote', { promoted_on: '2026-10-18' }, 'officer');
  assert.equal(denied.error.code, 'FORBIDDEN');
  assert.ok(env.rows('audit_log').some((a) => a.event === 'API.FORBIDDEN' && a.entity === 'tl.promote'));
  assert.ok(env.rows('audit_log').length > before);
  const early = env.act(id, 'tl.promote', { promoted_on: '2026-10-18' }, 'manager');
  assert.equal(early.error.code, 'BLOCKED_BY_RULE');
  assert.equal(early.error.rule_id, 'RULE-106');
  ok(env.act(id, 'tl.certify'));
  assert.equal(env.act(id, 'tl.promote', { promoted_on: '2026-10-18' }, 'admin').error.code, 'FORBIDDEN');
  assert.equal(env.act(id, 'tl.promote', { promoted_on: '2026-10-14' }, 'manager').error.fields[0].path, 'promoted_on');
  assert.equal(env.act(id, 'tl.promote', { promoted_on: '2026-10-21' }, 'manager').error.fields[0].path, 'promoted_on');
  const r = ok(env.act(id, 'tl.promote', { promoted_on: '2026-10-18' }, 'manager'));
  assert.deepEqual([r.enrollment.status, r.enrollment.promoted_on], ['Promoted', '2026-10-18']);
  assert.ok(env.rows('audit_log').some((a) => a.event === 'TL.PROMOTED'));
  assert.equal(env.act(id, 'tl.promote', { promoted_on: '2026-10-18' }, 'senior').error.code, 'BLOCKED_BY_RULE');
});

test('two officers at once: the second gets CONFLICT with the current version and writes nothing', () => {
  const env = setupTl();
  const reason = ok(env.call('lookups.create', { category: 'tl_quit_reason', value: 'Moved away', label: 'Moved away' }, env.token('admin')));
  const id = inCheck(env);
  const v = env.version(id);
  // both officers have the record open at this version; the first closes it
  const first = env.tl('officer', 'tl.close', { id, row_version: v, close_reason_id: env.rows('lookups').find((l) => l.category === 'tl_close_reason').id });
  assert.equal(first.ok, true);
  const counts = () => [env.rows('status_history').length, env.rows('audit_log').filter((a) => /^TL\./.test(a.event)).length, env.rows('assessments').length, env.rows('tl_extensions').length];
  const before = counts();
  const second = env.tl('supervisor', 'tl.quit', { id, row_version: v, quit_date: '2026-10-10', quit_reason_lookup_id: reason.id });
  assert.equal(second.error.code, 'CONFLICT', 'a stale version is reported before the rule');
  assert.equal(second.error.current.row_version, v + 1);
  assert.equal(second.error.current.updated_by_name, 'Olivia Tester');
  assert.equal(status(env, id), 'Failed');
  assert.deepEqual(counts(), before);
  // the same for every action
  env.setting('CFG-047', 2);
  const id2 = env.probationary({ person: { last_name: 'Reyes', first_name: 'Ana' } });
  const v2 = env.version(id2);
  assert.equal(env.tl('officer', 'tl.quit', { id: id2, row_version: v2, quit_date: '2026-10-10', quit_reason_lookup_id: reason.id }).ok, true);
  const stale = { id: id2, row_version: v2 };
  const calls = [
    ['tl.recordEntryGrade', { component_id: env.entryComps[0], score: 90, assessed_on: '2026-10-10', correction_reason: 'x' }],
    ['tl.recordCertCheck', { assessed_on: '2026-10-15', checklist: 90, exam: 80, kitchen_feedback: 85, course_program: 95, officer_ids: [env.users.officer.id] }],
    ['tl.certify', {}], ['tl.extend', { reason: 'x' }], ['tl.close', { close_reason_id: 'LKP-0007' }],
    ['tl.quit', { quit_date: '2026-10-10', quit_reason_lookup_id: reason.id }], ['tl.returnToProbation', { note: 'x' }],
    ['tl.promote', { promoted_on: '2026-10-10' }], ['tl.update', { patch: { remarks: 'x' } }],
  ];
  const mark = counts();
  for (const [method, params] of calls) {
    const r = env.tl('manager', method, Object.assign({}, stale, params));
    assert.equal(r.error.code, 'CONFLICT', method);
  }
  assert.deepEqual(counts(), mark, 'nothing of a stale call was written');
});

test('every action writes its status_history row and its audit event', () => {
  const env = setupTl();
  env.setting('CFG-047', 2);
  const id = env.probationary();
  ok(env.check(id));
  ok(env.act(id, 'tl.extend', { reason: 'x' }));
  ok(env.check(id, { assessed_on: '2026-10-18', checklist: 99, course_program: undefined }));
  ok(env.act(id, 'tl.returnToProbation', { note: 'again' }, 'supervisor'));
  ok(env.check(id, { assessed_on: '2026-10-19', checklist: 99, exam: 99, kitchen_feedback: 99, manager_feedback: 99, course_program: undefined }));
  ok(env.act(id, 'tl.certify'));
  ok(env.act(id, 'tl.promote', { promoted_on: '2026-10-19' }, 'manager'));
  const events = env.rows('audit_log').map((a) => a.event);
  for (const e of ['TL.ENROLLED', 'TL.ENTRY_GRADE_RECORDED', 'TL.CERT_CHECK_RECORDED', 'TL.EXTENDED', 'TL.RETURNED_TO_PROBATION', 'TL.CERTIFIED', 'TL.PROMOTED']) {
    assert.ok(events.includes(e), e);
  }
  const hist = env.rows('status_history').filter((h) => h.entity_id === id);
  assert.deepEqual(hist.map((h) => h.to_status), ['Entry', 'Probationary', 'Certification check', 'Extended', 'Certification check', 'Probationary', 'Certification check', 'Certified', 'Promoted']);
  assert.ok(hist.every((h) => h.user_id));
  // the record history of the enrollment shows the status and the final grade
  const fields = env.rows('record_history').filter((h) => h.entity === 'tl_enrollments' && h.entity_id === id).map((h) => h.field);
  assert.ok(fields.includes('status') && fields.includes('final_grade') && fields.includes('certified_on'));
});

test('tl.get shows each attempt with its scores and officers, and the actions open to the role', () => {
  const env = setupTl();
  const id = passing(env);
  const mgr = ok(env.get(id, 'manager'));
  assert.equal(mgr.checks.length, 1);
  assert.deepEqual(mgr.checks[0].scores.map((s) => s.component).sort(), ['Checklist', 'Exam', 'Kitchen feedback', 'Manager feedback', 'TL course program']);
  assert.equal(mgr.checks[0].final_grade, 91.5);
  assert.equal(mgr.course_program.score, 92);
  assert.equal(mgr.pass_mark, 85);
  assert.equal(mgr.course_pass_mark, 90);
  assert.ok(mgr.allowed_actions.includes('certify') && mgr.allowed_actions.includes('returnToProbation'));
  assert.ok(!ok(env.get(id, 'officer')).allowed_actions.includes('returnToProbation'));
  ok(env.act(id, 'tl.certify'));
  assert.deepEqual(ok(env.get(id, 'manager')).allowed_actions, ['promote']);
  assert.deepEqual(ok(env.get(id, 'officer')).allowed_actions, []);
  assert.deepEqual(ok(env.get(id, 'admin')).allowed_actions, []);
});

test('the TL course program grade is stored as its own component and never as a Checklist grade', () => {
  const env = setupTl();
  const id = inCheck(env);
  const course = env.rows('assessments').filter((a) => a.component_id === env.comp('TL course program'));
  assert.equal(course.length, 1);
  assert.equal(course[0].score, 95);
  const checklist = env.rows('assessments').filter((a) => a.component_id === env.comp('Checklist'));
  assert.equal(checklist.length, 1);
  assert.equal(checklist[0].score, 90);
});
