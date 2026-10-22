'use strict';
// Part 2B, Task 9: the pure Team Leader rules, with the values the spec fixes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');

const { g, plain } = loadServer();
const R = g('TlRules');
const call = (fn, ...a) => plain(R[fn](...a));

const ROLES = ['Training Officer', 'Training Supervisor', 'Training Manager', 'Senior Training Manager', 'Admin'];
const WEIGHTS = { cert: [30, 40, 30], feedback: [60, 40] };

test('30 Nov + 3 months is the last day of February, in a leap year too', () => {
  assert.equal(R.deadline('2025-11-30', 3), '2026-02-28');
  assert.equal(R.deadline('2027-11-30', 3), '2028-02-29');
  assert.equal(R.deadline('2026-10-20', 3), '2027-01-20');
  assert.equal(R.deadline('2026-01-31', 1), '2026-02-28');
  assert.equal(R.deadline('2026-01-31', 2), '2026-03-31');
  assert.equal(R.deadline('2026-11-15', 3), '2027-02-15');
  assert.equal(R.deadline('2026-12-31', 12), '2027-12-31');
  assert.equal(R.deadline('2024-02-29', 12), '2025-02-28');
  assert.throws(() => R.deadline('2026-13-01', 3));
});

test('addDays moves a date across month ends, year ends and leap days', () => {
  assert.equal(R.addDays('2026-02-28', 30), '2026-03-30');
  assert.equal(R.addDays('2026-12-15', 30), '2027-01-14');
  assert.equal(R.addDays('2028-02-15', 30), '2028-03-16');
  assert.equal(R.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(R.addDays('2026-03-01', -1), '2026-02-28');
});

test('round2 rounds half up, and 84.995 rounds to 85', () => {
  assert.equal(R.round2(84.995), 85);
  assert.equal(R.round2(84.994), 84.99);
  assert.equal(R.round2(83.3), 83.3);
  assert.equal(R.round2(1.005), 1.01);
  assert.equal(R.round2(0.125), 0.13);
  assert.equal(R.round2(100), 100);
});

test('the final grade with both feedback forms: checklist 90, exam 80, kitchen 85, manager 75 gives feedback 81 and final 83.3', () => {
  assert.equal(R.feedback(85, 75, 60, 40), 81);
  assert.equal(R.finalGrade({ checklist: 90, exam: 80, kitchen: 85, manager: 75 }, WEIGHTS), 83.3);
});

test('the final grade with one feedback form uses that form alone: 90, 80, kitchen 85 gives 84.5', () => {
  assert.equal(R.finalGrade({ checklist: 90, exam: 80, kitchen: 85 }, WEIGHTS), 84.5);
  assert.equal(R.finalGrade({ checklist: 90, exam: 80, manager: 75 }, WEIGHTS), 81.5);
  assert.throws(() => R.finalGrade({ checklist: 90, exam: 80 }, WEIGHTS), /feedback/);
});

test('84.995 rounds to 85 and passes at 85', () => {
  // 0.3 x 80 + 0.4 x 90 + 0.3 x 94.9833... would be noisy; pick scores whose exact result is 84.995
  const w = { cert: [100, 0, 0], feedback: [60, 40] };
  const grade = R.finalGrade({ checklist: 84.995, exam: 0, kitchen: 0 }, w);
  assert.equal(grade, 85);
  assert.ok(grade >= 85);
});

test('weights other than the default are used', () => {
  assert.equal(R.finalGrade({ checklist: 100, exam: 0, kitchen: 0 }, { cert: [50, 25, 25], feedback: [50, 50] }), 50);
  assert.equal(R.finalGrade({ checklist: 80, exam: 80, kitchen: 100, manager: 0 }, { cert: [30, 40, 30], feedback: [50, 50] }), 71);
});

test('entry is complete only with every required component', () => {
  const grades = [{ id: 'ASM-1', component_id: 'A', score: 90 }, { id: 'ASM-2', component_id: 'B', score: 80 }];
  assert.deepEqual(call('entryState', ['A', 'B'], grades), { complete: true, missing: [], average: 85 });
  assert.deepEqual(call('entryState', ['A', 'B', 'C'], grades), { complete: false, missing: ['C'], average: 85 });
  assert.deepEqual(call('entryState', ['A'], []), { complete: false, missing: ['A'], average: null });
  // a grade for a component that is not required does not count in the average
  assert.equal(R.entryState(['A'], grades).average, 90);
  assert.equal(R.entryState(['A', 'B'], [{ id: 'x', component_id: 'A', score: 90.5 }, { id: 'y', component_id: 'B', score: 91 }]).average, 90.75);
});

test('superseded rows are not in force', () => {
  const rows = [
    { id: 'ASM-1', component_id: 'A', score: 70 },
    { id: 'ASM-2', component_id: 'A', score: 80, supersedes_id: 'ASM-1' },
    { id: 'ASM-3', component_id: 'B', score: 90 },
    { id: 'ASM-4', component_id: 'A', score: 85, supersedes_id: 'ASM-2' },
  ];
  assert.deepEqual(call('inForce', rows).map((r) => r.id), ['ASM-3', 'ASM-4']);
});

// The transition table of spec 7.12, written out again here and not derived from the code.
// recordEntryGrade, recordCertCheck, certify, extend, close, quit, returnToProbation, promote
const TABLE = {
  'Entry':               [true, false, false, false, false, true, false, false],
  'Probationary':        [true, true, false, false, false, true, false, false],
  'Certification check': [true, true, 'cond', 'cond', true, true, true, false],
  'Extended':            [true, true, false, false, true, true, true, false],
  'Certified':           [false, false, false, false, false, false, false, true],
  'Failed':              [false, false, false, false, false, false, false, false],
  'Quit':                [false, false, false, false, false, false, false, false],
  'Promoted':            [false, false, false, false, false, false, false, false],
};
const ACTION_NAMES = ['recordEntryGrade', 'recordCertCheck', 'certify', 'extend', 'close', 'quit', 'returnToProbation', 'promote'];
// facts under which both conditional actions are possible in turn
const PASSING = { entryComplete: true, finalGrade: 90, passMark: 85, courseGrade: 95, coursePassMark: 90, extensionsUsed: 0, extensionLimit: 2 };
const FAILING = { entryComplete: true, finalGrade: 70, passMark: 85, courseGrade: 95, coursePassMark: 90, extensionsUsed: 0, extensionLimit: 2 };

test('decide matches the transition table for every status x action x role', () => {
  for (const status of Object.keys(TABLE)) {
    ACTION_NAMES.forEach((action, i) => {
      for (const role of ROLES) {
        const cell = TABLE[status][i];
        const seniorOnly = action === 'returnToProbation' || action === 'promote';
        const roleAllowed = !seniorOnly || ['Training Supervisor', 'Training Manager', 'Senior Training Manager'].includes(role);
        const label = status + ' / ' + action + ' / ' + role;
        const res = call('decide', action, status, role, cell === 'cond' ? (action === 'certify' ? PASSING : FAILING) : PASSING);
        if (!roleAllowed) { assert.equal(res.code, 'FORBIDDEN', label); continue; }
        if (cell === false) {
          assert.equal(res.ok, false, label);
          assert.equal(res.code, 'BLOCKED_BY_RULE', label);
          assert.ok(res.rule_id, label);
        } else {
          assert.equal(res.ok, true, label + ' ' + JSON.stringify(res));
        }
      }
    });
  }
});

test('an officer cannot promote or return to probation (FORBIDDEN), and Admin may do every officer action but not these two (P2-6)', () => {
  for (const [role, expected] of [['Training Officer', 'FORBIDDEN'], ['Admin', 'FORBIDDEN'], ['Training Supervisor', undefined]]) {
    assert.equal(R.decide('promote', 'Certified', role, PASSING).code, expected, role);
    assert.equal(R.decide('returnToProbation', 'Extended', role, PASSING).code, expected, role);
  }
  for (const a of ['recordEntryGrade', 'quit']) assert.equal(R.decide(a, 'Probationary', 'Admin', PASSING).ok, true, a);
  assert.equal(R.decide('certify', 'Certification check', 'Admin', PASSING).ok, true);
  assert.equal(R.decide('extend', 'Certification check', 'Admin', FAILING).ok, true);
  assert.equal(R.decide('close', 'Extended', 'Admin', PASSING).ok, true);
});

test('a certification check needs every entry grade (BLOCKED_BY_RULE RULE-101), also from Entry', () => {
  const noEntry = Object.assign({}, PASSING, { entryComplete: false });
  const entry = call('decide', 'recordCertCheck', 'Entry', 'Training Officer', noEntry);
  assert.deepEqual([entry.code, entry.rule_id], ['BLOCKED_BY_RULE', 'RULE-101']);
  const prob = call('decide', 'recordCertCheck', 'Probationary', 'Training Officer', noEntry);
  assert.deepEqual([prob.code, prob.rule_id], ['BLOCKED_BY_RULE', 'RULE-101']);
  assert.equal(R.decide('recordCertCheck', 'Probationary', 'Training Officer', PASSING).ok, true);
});

test('certify without a TL course program grade is BLOCKED_BY_RULE RULE-102', () => {
  const none = Object.assign({}, PASSING, { courseGrade: null });
  const r = call('decide', 'certify', 'Certification check', 'Training Officer', none);
  assert.deepEqual([r.code, r.rule_id], ['BLOCKED_BY_RULE', 'RULE-102']);
});

test('a course grade of 89 and 89.99 blocks certify at coursePassMark 90, and 90 passes', () => {
  for (const [grade, ok] of [[89, false], [89.99, false], [90, true], [100, true]]) {
    const r = call('decide', 'certify', 'Certification check', 'Training Officer', Object.assign({}, PASSING, { courseGrade: grade }));
    assert.equal(r.ok, ok, String(grade));
    if (!ok) assert.deepEqual([r.code, r.rule_id], ['BLOCKED_BY_RULE', 'RULE-102']);
  }
});

test('safety net: with no course pass mark in force, any recorded course grade passes', () => {
  const unset = Object.assign({}, PASSING, { courseGrade: 10, coursePassMark: null });
  assert.equal(R.decide('certify', 'Certification check', 'Training Officer', unset).ok, true);
  assert.equal(R.decide('certify', 'Certification check', 'Training Officer', Object.assign({}, unset, { courseGrade: null })).ok, false);
});

test('certify below the pass mark is BLOCKED_BY_RULE RULE-102, at the pass mark it passes', () => {
  const below = call('decide', 'certify', 'Certification check', 'Training Officer', Object.assign({}, PASSING, { finalGrade: 84.99 }));
  assert.deepEqual([below.code, below.rule_id], ['BLOCKED_BY_RULE', 'RULE-102']);
  assert.equal(R.decide('certify', 'Certification check', 'Training Officer', Object.assign({}, PASSING, { finalGrade: 85 })).ok, true);
  assert.equal(R.decide('certify', 'Certification check', 'Training Officer', Object.assign({}, PASSING, { passMark: null })).code, 'CONFIG_MISSING');
});

test('extend: CONFIG_MISSING without CFG-047, BLOCKED RULE-104 at the limit, and both branches of X-4', () => {
  const dec = (facts) => call('decide', 'extend', 'Certification check', 'Training Officer', facts);
  assert.deepEqual([dec(Object.assign({}, FAILING, { extensionLimit: null })).code, dec(Object.assign({}, FAILING, { extensionLimit: null })).key], ['CONFIG_MISSING', 'CFG-047']);
  assert.equal(dec(FAILING).ok, true);
  assert.equal(dec(Object.assign({}, FAILING, { extensionsUsed: 1 })).ok, true);
  const atLimit = dec(Object.assign({}, FAILING, { extensionsUsed: 2 }));
  assert.deepEqual([atLimit.code, atLimit.rule_id], ['BLOCKED_BY_RULE', 'RULE-104']);
  // X-4: the final passes but the course grade does not: extend is allowed, and certify is not
  const courseFails = Object.assign({}, PASSING, { courseGrade: 85 });
  assert.equal(dec(courseFails).ok, true);
  assert.equal(R.decide('certify', 'Certification check', 'Training Officer', courseFails).ok, false);
  // both pass: certify, not extend
  assert.equal(dec(PASSING).code, 'BLOCKED_BY_RULE');
  assert.equal(R.decide('certify', 'Certification check', 'Training Officer', PASSING).ok, true);
});

test('overdue only for open states', () => {
  assert.equal(R.overdue('Probationary', '2026-10-19', '2026-10-20'), true);
  assert.equal(R.overdue('Probationary', '2026-10-20', '2026-10-20'), false);
  assert.equal(R.overdue('Extended', '2026-10-01', '2026-10-20'), true);
  for (const s of ['Certified', 'Failed', 'Quit', 'Promoted']) assert.equal(R.overdue(s, '2020-01-01', '2026-10-20'), false, s);
});

test('allowedActions lists what the role may do in the status', () => {
  assert.deepEqual(call('allowedActions', 'Certification check', 'Training Officer', FAILING).sort(),
    ['close', 'extend', 'quit', 'recordCertCheck', 'recordEntryGrade']);
  assert.deepEqual(call('allowedActions', 'Certification check', 'Training Supervisor', PASSING).sort(),
    ['certify', 'close', 'quit', 'recordCertCheck', 'recordEntryGrade', 'returnToProbation']);
  assert.deepEqual(call('allowedActions', 'Certified', 'Training Manager', PASSING), ['promote']);
  assert.deepEqual(call('allowedActions', 'Certified', 'Admin', PASSING), []);
  assert.deepEqual(call('allowedActions', 'Quit', 'Admin', PASSING), []);
});
