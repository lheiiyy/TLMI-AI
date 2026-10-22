'use strict';
// Part 2B, Task 9: the pure Team Leader rules (spec section 7).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');

const { g, plain } = loadServer();
const R = () => g('TlRules');

const O = 'Training Officer', S = 'Training Supervisor', M = 'Training Manager', SR = 'Senior Training Manager', A = 'Admin';
const ROLES = [O, S, M, SR, A];
const STATUSES = ['Entry', 'Probationary', 'Certification check', 'Certified', 'Extended', 'Failed', 'Quit', 'Promoted'];
const ACTIONS = ['recordEntryGrade', 'recordCertCheck', 'certify', 'extend', 'close', 'quit', 'returnToProbation', 'promote'];

test('30 Nov + 3 months is the last day of February', () => {
  assert.equal(R().deadline('2025-11-30', 3), '2026-02-28');
  assert.equal(R().deadline('2027-11-30', 3), '2028-02-29');
  assert.equal(R().deadline('2026-10-20', 3), '2027-01-20');
  assert.equal(R().deadline('2026-11-30', 3), '2027-02-28');
  assert.equal(R().deadline('2026-12-31', 2), '2027-02-28');
  assert.equal(R().deadline('2026-01-31', 1), '2026-02-28');
  assert.equal(R().deadline('2026-05-31', 12), '2027-05-31');
});

test('addDays moves across month and year ends and leap days', () => {
  assert.equal(R().addDays('2026-10-20', 30), '2026-11-19');
  assert.equal(R().addDays('2026-12-15', 30), '2027-01-14');
  assert.equal(R().addDays('2028-02-15', 14), '2028-02-29');
  assert.equal(R().addDays('2028-02-15', 15), '2028-03-01');
});

test('round2 rounds half up', () => {
  assert.equal(R().round2(84.995), 85);
  assert.equal(R().round2(83.3), 83.3);
  assert.equal(R().round2(1.005), 1.01);
  assert.equal(R().round2(2.004), 2);
  assert.equal(R().round2(0), 0);
});

test('superseded rows are not in force', () => {
  const rows = [
    { id: 'A1', component_id: 'C1', score: 80 },
    { id: 'A2', component_id: 'C1', score: 90, supersedes_id: 'A1' },
    { id: 'A3', component_id: 'C2', score: 70, supersedes_id: '' },
  ];
  assert.deepEqual(plain(R().inForce(rows)).map((r) => r.id), ['A2', 'A3']);
});

test('entry is complete only with every required component', () => {
  const grades = [{ component_id: 'C1', score: 90 }, { component_id: 'C2', score: 80 }];
  const part = plain(R().entryState(['C1', 'C2', 'C3'], grades));
  assert.deepEqual(part, { complete: false, missing: ['C3'], average: null });
  const done = plain(R().entryState(['C1', 'C2'], grades));
  assert.deepEqual(done, { complete: true, missing: [], average: 85 });
  const odd = plain(R().entryState(['C1', 'C2', 'C3'], [{ component_id: 'C1', score: 80 }, { component_id: 'C2', score: 80 }, { component_id: 'C3', score: 81 }]));
  assert.equal(odd.average, 80.33);
  // a grade for a component that is not required does not count
  assert.equal(plain(R().entryState(['C1'], [{ component_id: 'C1', score: 70 }, { component_id: 'X', score: 100 }])).average, 70);
});

const W = { cert: [30, 40, 30], feedback: [60, 40] };

test('final with both feedback forms', () => {
  assert.equal(R().finalGrade({ checklist: 90, exam: 80, kitchen: 85, manager: 75 }, plain(W)), 83.3);
});

test('final with only the kitchen form uses it alone', () => {
  assert.equal(R().finalGrade({ checklist: 90, exam: 80, kitchen: 85 }, plain(W)), 84.5);
  assert.equal(R().finalGrade({ checklist: 90, exam: 80, manager: 75 }, plain(W)), 81.5);
});

test('84.995 rounds to 85 and passes at 85', () => {
  // 100 x 0.3 + 100 x 0.4 + feedback x 0.3 = 70 + 0.3 x feedback; feedback 49.9833 gives 84.995 in practice, so build it from the weights.
  const f = R().finalGrade({ checklist: 84.995, exam: 84.995, kitchen: 84.995 }, plain(W));
  assert.equal(f, 85);
  assert.ok(f >= 85);
});

test('overdue only for open states', () => {
  const r = R();
  assert.equal(r.overdue('Probationary', '2026-10-19', '2026-10-20'), true);
  assert.equal(r.overdue('Probationary', '2026-10-20', '2026-10-20'), false);
  assert.equal(r.overdue('Extended', '2026-01-01', '2026-10-20'), true);
  for (const st of ['Certified', 'Failed', 'Quit', 'Promoted']) assert.equal(r.overdue(st, '2026-01-01', '2026-10-20'), false, st);
});

const FACTS = { entryComplete: true, finalGrade: 90, passMark: 85, extensionsUsed: 0, extensionLimit: 2, courseGrade: 95, coursePassMark: 90 };
const decide = (action, status, role, facts) => plain(R().decide(action, status, role, Object.assign({}, FACTS, facts || {})));

// The expected table of spec section 7.12 (with the facts of FACTS: everything passes, so certify is allowed and extend is not).
const OPEN = new Set(['Entry', 'Probationary', 'Certification check', 'Extended']);
function expectedOk(action, status) {
  switch (action) {
    case 'recordEntryGrade': return OPEN.has(status);
    case 'recordCertCheck': return ['Probationary', 'Certification check', 'Extended'].includes(status);
    case 'certify': return status === 'Certification check';
    case 'extend': return false; // FACTS pass, so extend is refused by X-4's condition
    case 'close': return ['Certification check', 'Extended'].includes(status);
    case 'quit': return OPEN.has(status);
    case 'returnToProbation': return ['Certification check', 'Extended'].includes(status);
    case 'promote': return status === 'Certified';
    default: throw new Error(action);
  }
}

test('decide matches the transition table for every state x action', () => {
  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      const res = decide(action, status, M);
      assert.equal(res.ok, expectedOk(action, status), status + ' / ' + action + ' ' + JSON.stringify(res));
      if (!res.ok) {
        assert.equal(res.code, 'BLOCKED_BY_RULE', status + ' / ' + action);
        assert.ok(res.rule_id, status + ' / ' + action);
      }
    }
  }
});

test('decide matches the role column for every role', () => {
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      const status = action === 'promote' ? 'Certified' : action === 'recordCertCheck' ? 'Probationary' : 'Certification check';
      const res = decide(action, status, role);
      const supOnly = action === 'returnToProbation' || action === 'promote';
      const roleOk = !supOnly || [S, M, SR].includes(role);
      if (!roleOk) {
        assert.deepEqual([res.ok, res.code], [false, 'FORBIDDEN'], role + ' / ' + action);
      } else if (action === 'extend') {
        assert.equal(res.code, 'BLOCKED_BY_RULE');
      } else {
        assert.equal(res.ok, true, role + ' / ' + action + ' ' + JSON.stringify(res));
      }
    }
  }
});

test('an officer cannot promote or return to probation (FORBIDDEN)', () => {
  assert.equal(decide('promote', 'Certified', O).code, 'FORBIDDEN');
  assert.equal(decide('returnToProbation', 'Extended', O).code, 'FORBIDDEN');
  assert.equal(decide('promote', 'Certified', S).ok, true);
  assert.equal(decide('returnToProbation', 'Certification check', SR).ok, true);
});

test('Admin may do every officer action but is FORBIDDEN on promote and returnToProbation (P2-6)', () => {
  for (const action of ['recordEntryGrade', 'recordCertCheck', 'certify', 'close', 'quit']) {
    const status = action === 'recordCertCheck' ? 'Probationary' : 'Certification check';
    assert.equal(decide(action, status, A).ok, true, action);
  }
  assert.equal(decide('extend', 'Certification check', A, { finalGrade: 80 }).ok, true);
  assert.equal(decide('promote', 'Certified', A).code, 'FORBIDDEN');
  assert.equal(decide('returnToProbation', 'Certification check', A).code, 'FORBIDDEN');
});

test('a cert check from Entry is refused by RULE-101, and without every entry grade too', () => {
  const r = decide('recordCertCheck', 'Entry', O);
  assert.deepEqual([r.ok, r.code, r.rule_id], [false, 'BLOCKED_BY_RULE', 'RULE-101']);
  const r2 = decide('recordCertCheck', 'Probationary', O, { entryComplete: false });
  assert.deepEqual([r2.ok, r2.code, r2.rule_id], [false, 'BLOCKED_BY_RULE', 'RULE-101']);
});

test('certify without a course program grade is BLOCKED_BY_RULE RULE-102', () => {
  const r = decide('certify', 'Certification check', O, { courseGrade: null });
  assert.deepEqual([r.ok, r.code, r.rule_id], [false, 'BLOCKED_BY_RULE', 'RULE-102']);
});

test('certify below the final pass mark is BLOCKED_BY_RULE RULE-102, and at the pass mark passes', () => {
  assert.equal(decide('certify', 'Certification check', O, { finalGrade: 84.99 }).rule_id, 'RULE-102');
  assert.equal(decide('certify', 'Certification check', O, { finalGrade: 85 }).ok, true);
});

test('a course grade of 89 (and 89.99) blocks certify at coursePassMark 90 and 90 passes', () => {
  assert.equal(decide('certify', 'Certification check', O, { courseGrade: 89 }).rule_id, 'RULE-102');
  assert.equal(decide('certify', 'Certification check', O, { courseGrade: 89.99 }).ok, false);
  assert.equal(decide('certify', 'Certification check', O, { courseGrade: 90 }).ok, true);
});

test('with no coursePassMark in force a recorded course grade is enough (safety net)', () => {
  assert.equal(decide('certify', 'Certification check', O, { courseGrade: 10, coursePassMark: null }).ok, true);
  assert.equal(decide('certify', 'Certification check', O, { courseGrade: null, coursePassMark: null }).ok, false);
});

test('extend is allowed when the final passes but the course grade is below coursePassMark (X-4)', () => {
  assert.equal(decide('extend', 'Certification check', O, { finalGrade: 95, courseGrade: 80 }).ok, true);
  assert.equal(decide('extend', 'Certification check', O, { finalGrade: 60, courseGrade: 95 }).ok, true);
});

test('extend is BLOCKED_BY_RULE when the final passes and the course grade passes', () => {
  const r = decide('extend', 'Certification check', O);
  assert.deepEqual([r.ok, r.code, r.rule_id], [false, 'BLOCKED_BY_RULE', 'RULE-104']);
});

test('extend is BLOCKED_BY_RULE RULE-104 at the limit, and CONFIG_MISSING when no limit is set', () => {
  const at = decide('extend', 'Certification check', O, { finalGrade: 50, extensionsUsed: 2, extensionLimit: 2 });
  assert.deepEqual([at.ok, at.code, at.rule_id], [false, 'BLOCKED_BY_RULE', 'RULE-104']);
  assert.equal(decide('extend', 'Certification check', O, { finalGrade: 50, extensionsUsed: 1, extensionLimit: 2 }).ok, true);
  const none = decide('extend', 'Certification check', O, { finalGrade: 50, extensionLimit: null });
  assert.deepEqual([none.ok, none.code], [false, 'CONFIG_MISSING']);
});

test('extend is only from Certification check', () => {
  for (const st of STATUSES.filter((s) => s !== 'Certification check')) {
    assert.equal(decide('extend', st, O, { finalGrade: 50 }).ok, false, st);
  }
});
