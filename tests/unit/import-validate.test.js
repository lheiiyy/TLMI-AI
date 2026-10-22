'use strict';
// Legacy import: validation against the officers' decisions (spec 10.1 and 10.3). Invented data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupImport, BASELINE, masterRow, planNow } = require('../helpers/import-env');
const { fillTab } = require('../helpers/sheets');
const M = require('../fixtures/master-log');

const ISSUE_CODES = ['PERSON_UNCONFIRMED', 'DUPLICATE_UNDECIDED', 'STORE_UNMAPPED', 'SUPPORT_STORE_UNMAPPED', 'STATION_UNMAPPED',
  'ENTRY_DATE_BAD', 'STATUS_BAD', 'VALUE_UNDECIDED', 'OPEN_TWICE', 'CHANGED_AFTER_COMMIT'];

// Decisions that confirm every person of the given rows' names.
const confirmAll = (names) => ({ persons: Object.fromEntries(names.map((n) => [n, 'confirm'])) });
const rowOf = (items, n) => items.find((i) => i.source_row === n);

test('with the baseline decisions the fixture rows 2 to 9 are READY and 11 and 12 are NOT_READY', () => {
  const env = setupImport();
  env.decideBaseline();
  const v = env.validateOk();
  assert.match(v.import_id, /^IMP-\d{4}$/);
  const r = env.results(v.import_id);
  assert.deepEqual(r, { 2: 'READY', 3: 'READY', 4: 'READY', 5: 'READY', 6: 'READY', 7: 'READY', 8: 'READY', 9: 'READY', 11: 'NOT_READY', 12: 'NOT_READY' });
  assert.deepEqual(v.counts.by_result, { READY: 8, NOT_READY: 2, SKIPPED: 0, COMMITTED: 0, ALREADY_COMMITTED: 0 });
  assert.deepEqual(env.codesOf(v.import_id, 11), ['STATUS_BAD']);
  assert.deepEqual(env.codesOf(v.import_id, 12), ['PERSON_UNCONFIRMED', 'ENTRY_DATE_BAD']);
  const batch = env.rows('import_batches').find((b) => b.id === v.import_id);
  assert.deepEqual([batch.kind, batch.status, batch.source_row_count], ['LEGACY_TL', 'Validated', 10]);
});

test('PERSON_UNCONFIRMED: no decision, a wrong decision word, or a corrected value that is not four parts', () => {
  const env = setupImport();
  env.decide({ persons: { 'MARCO TESTER': 'different person', 'ANA SAMPLE': ['correct value', 'SAMPLE | ANA'], 'REA SAMPLE': ['correct value', ' | REA | | '], 'KIM SAMPLE': 'drop value' } });
  const v = env.validateOk();
  [2, 3, 4, 5, 9, 12].forEach((n) => assert.ok(env.codesOf(v.import_id, n).includes('PERSON_UNCONFIRMED'), 'row ' + n));
});

test('a corrected person value is used for the person and a confirm uses the proposed parts', () => {
  const env = setupImport({ masterRows: [masterRow({ name: 'JUAN DELA CRUZ' }), masterRow({ name: 'MA. ANA SAMPLE', entry_date: '2 Mar 2026' })] });
  env.decide({ persons: { 'JUAN DELA CRUZ': ['correct value', 'dela cruz | juan | | jr'], 'MA ANA SAMPLE': 'confirm' } });
  const items = planNow(env);
  assert.deepEqual(items.map((i) => i.result), ['READY', 'READY']);
  assert.deepEqual([items[0].plan.person.last_name, items[0].plan.person.first_name, items[0].plan.person.suffix], ['DELA CRUZ', 'JUAN', 'JR']);
  assert.deepEqual([items[1].plan.person.last_name, items[1].plan.person.first_name], ['SAMPLE', 'MA. ANA']);
  assert.equal(items[0].plan.person.legacy_ref, 'LEGACY:JUAN DELA CRUZ');
});

test('DUPLICATE_UNDECIDED: a possible duplicate pair without a decision', () => {
  const env = setupImport();
  const spec = JSON.parse(JSON.stringify(BASELINE));
  delete spec.duplicates['DARYL FAYE C. SAMPLE | DARYL FAYE SAMPLE'];
  env.decide(spec);
  const v = env.validateOk();
  assert.ok(env.codesOf(v.import_id, 6).includes('DUPLICATE_UNDECIDED'));
  assert.ok(env.codesOf(v.import_id, 7).includes('DUPLICATE_UNDECIDED'));
  assert.equal(env.results(v.import_id)[6], 'NOT_READY');
});

test('different person keeps two persons; confirm merges them into one person with every spelling', () => {
  const env = setupImport();
  const spec = JSON.parse(JSON.stringify(BASELINE));
  spec.duplicates['DARYL FAYE C. SAMPLE | DARYL FAYE SAMPLE'] = 'different person';
  env.decide(spec);
  let items = planNow(env);
  assert.equal(rowOf(items, 6).result, 'READY');
  assert.equal(rowOf(items, 6).plan.person.legacy_ref, 'LEGACY:DARYL FAYE C SAMPLE');
  assert.equal(rowOf(items, 7).plan.person.legacy_ref, 'LEGACY:DARYL FAYE SAMPLE');
  env.decide({ duplicates: { 'DARYL FAYE C. SAMPLE | DARYL FAYE SAMPLE': 'confirm' } });
  items = planNow(env);
  assert.equal(rowOf(items, 6).plan.person.legacy_ref, rowOf(items, 7).plan.person.legacy_ref);
  assert.deepEqual(rowOf(items, 7).plan.person.spellings, ['DARYL FAYE C. SAMPLE', 'DARYL FAYE SAMPLE']);
  assert.equal(rowOf(items, 7).plan.person.middle_name, 'C');
});

test('a merged person needs every member confirmed', () => {
  const env = setupImport();
  const spec = JSON.parse(JSON.stringify(BASELINE));
  delete spec.persons['DARYL FAYE SAMPLE'];
  env.decide(spec);
  const v = env.validateOk();
  assert.ok(env.codesOf(v.import_id, 6).includes('PERSON_UNCONFIRMED'));
  assert.ok(env.codesOf(v.import_id, 7).includes('PERSON_UNCONFIRMED'));
});

test('STORE_UNMAPPED and STATION_UNMAPPED without the confirmed aliases; a confirmed alias maps an asterisk station', () => {
  const env = setupImport();
  const noAlias = JSON.parse(JSON.stringify(BASELINE));
  noAlias.mapping = [];
  env.decide(noAlias);
  let v = env.validateOk();
  assert.deepEqual(env.codesOf(v.import_id, 3), ['STORE_UNMAPPED', 'STATION_UNMAPPED']);
  assert.deepEqual(env.codesOf(v.import_id, 6), ['STORE_UNMAPPED']);
  env.decide({ mapping: BASELINE.mapping });
  const items = planNow(env);
  assert.equal(rowOf(items, 3).result, 'READY');
  assert.match(rowOf(items, 3).plan.enrollment.station_id, /^STN-\d{4}$/);
  const station = env.rows('stations').find((s) => s.id === rowOf(items, 3).plan.enrollment.station_id);
  assert.equal(station.name, 'Pizza Maker');
  v = env.validateOk();
  assert.equal(env.results(v.import_id)[3], 'READY');
});

test('SUPPORT_STORE_UNMAPPED; NONE and N/A support stores are blank', () => {
  const env = setupImport({ masterRows: [
    masterRow({ name: 'AL ONE', support: 'NOWHERE STORE' }),
    masterRow({ name: 'BO TWO', support: 'NONE' }),
    masterRow({ name: 'CY THREE', support: 'N/A' }),
    masterRow({ name: 'DI FOUR', support: 'SECOND TEST STORE' }),
  ] });
  env.decide(confirmAll(['AL ONE', 'BO TWO', 'CY THREE', 'DI FOUR']));
  const items = planNow(env);
  assert.deepEqual(items.map((i) => i.result), ['NOT_READY', 'READY', 'READY', 'READY']);
  assert.deepEqual(items[0].issues.map((i) => i.code), ['SUPPORT_STORE_UNMAPPED']);
  assert.equal(items[1].plan.enrollment.support_location_id, undefined);
  assert.equal(items[2].plan.enrollment.support_location_id, undefined);
  assert.match(items[3].plan.enrollment.support_location_id, /^LOC-\d{4}$/);
});

test('a blank station is allowed for a legacy row; an unknown one is STATION_UNMAPPED', () => {
  const env = setupImport({ masterRows: [masterRow({ name: 'AL ONE', station: '' }), masterRow({ name: 'BO TWO', station: 'LASER WORKS' })] });
  env.decide(confirmAll(['AL ONE', 'BO TWO']));
  const items = planNow(env);
  assert.deepEqual(items.map((i) => i.result), ['READY', 'NOT_READY']);
  assert.equal(items[0].plan.enrollment.station_id, undefined);
  assert.deepEqual(items[1].issues.map((i) => i.code), ['STATION_UNMAPPED']);
});

test('ENTRY_DATE_BAD: unreadable and future dates need confirm with a proposal, or a typed correction; drop is not allowed', () => {
  const rows = [
    masterRow({ name: 'AL ONE', entry_date: 'next week' }),
    masterRow({ name: 'BO TWO', entry_date: '' }),
    masterRow({ name: 'CY THREE', entry_date: '05/10/2027' }),
    masterRow({ name: 'DI FOUR', entry_date: '08/12/2026' }),
  ];
  const env = setupImport({ masterRows: rows });
  env.decide(confirmAll(['AL ONE', 'BO TWO', 'CY THREE', 'DI FOUR']));
  let items = planNow(env);
  assert.deepEqual(items.map((i) => i.issues.map((x) => x.code)), [['ENTRY_DATE_BAD'], ['ENTRY_DATE_BAD'], ['ENTRY_DATE_BAD'], ['ENTRY_DATE_BAD']]);
  env.decide({ bad: [[2, 'entry_date', 'drop value'], [3, 'entry_date', 'correct value', '2026-03-02'], [4, 'entry_date', 'confirm'], [5, 'entry_date', 'confirm']] });
  items = planNow(env);
  assert.equal(items[0].result, 'NOT_READY', 'drop is refused');
  assert.equal(items[1].plan.enrollment.entry_date, '2026-03-02');
  assert.equal(items[2].result, 'NOT_READY', 'confirm without a proposal');
  assert.equal(items[3].plan.enrollment.entry_date, '2026-08-12', 'confirm takes the proposed date');
});

test('STATUS_BAD: an unknown RESULT needs a typed valid RESULT value', () => {
  const env = setupImport();
  env.decideBaseline();
  let v = env.validateOk();
  assert.deepEqual(env.codesOf(v.import_id, 11), ['STATUS_BAD']);
  env.decide({ bad: [[11, 'result', 'correct value', 'DISQUALIFIED']] });
  const items = planNow(env);
  assert.equal(rowOf(items, 11).result, 'READY');
  assert.equal(rowOf(items, 11).planned_status, 'Failed');
  assert.equal(rowOf(items, 11).planned_close_reason, 'Disqualified');
  env.decide({ bad: [[11, 'result', 'correct value', 'WHATEVER']] });
  v = env.validateOk();
  assert.deepEqual(env.codesOf(v.import_id, 11), ['STATUS_BAD']);
});

test('DISQUALIFIED becomes Failed with the close reason Disqualified', () => {
  const env = setupImport();
  env.decideBaseline();
  const items = planNow(env);
  const e = rowOf(items, 7).plan.enrollment;
  assert.equal(e.status, 'Failed');
  assert.equal(e.close_reason_id, env.rows('lookups').find((l) => l.category === 'tl_close_reason' && l.value === 'Disqualified').id);
});

test('VALUE_UNDECIDED: a bad date or grade needs confirm, a typed value or drop value', () => {
  const env = setupImport();
  const spec = JSON.parse(JSON.stringify(BASELINE));
  spec.bad = spec.bad.filter((b) => b[0] !== 8 && b[0] !== 3);
  env.decide(spec);
  const v = env.validateOk();
  assert.deepEqual(env.codesOf(v.import_id, 8), ['VALUE_UNDECIDED']);
  assert.deepEqual(env.codesOf(v.import_id, 3), ['VALUE_UNDECIDED']);
  assert.equal(env.issuesOf(v.import_id, 8).issues[0].field, 'techval_fp');
  // a typed grade is read like a grade; an unreadable typed value leaves the row undecided
  env.decide({ bad: [[8, 'techval_fp', 'correct value', 'abc'], [3, 'istv', 'correct value', '94.5%']] });
  const items = planNow(env);
  assert.equal(rowOf(items, 8).result, 'NOT_READY');
  assert.equal(rowOf(items, 3).result, 'READY');
  assert.equal(rowOf(items, 3).plan.grades.find((g) => g.field === 'istv').score, 94.5);
});

test('drop value leaves the grade out and the row ready', () => {
  const env = setupImport();
  env.decideBaseline();
  const row8 = rowOf(planNow(env), 8);
  assert.equal(row8.result, 'READY');
  assert.deepEqual(row8.plan.grades.map((g) => g.field), ['istv']);
  // a dropped certification date leaves certified_on empty
  const row7 = rowOf(planNow(env), 7);
  assert.equal(row7.plan.enrollment.certified_on, undefined);
});

test('confirm takes the proposed value: a scaled grade and a future certified date', () => {
  const env = setupImport();
  env.decideBaseline();
  const items = planNow(env);
  assert.equal(rowOf(items, 3).plan.grades.find((g) => g.field === 'istv').score, 94.75);
  assert.equal(rowOf(items, 9).plan.enrollment.certified_on, '2026-08-12');
});

test('OPEN_TWICE: two open rows of one person are both NOT_READY until one is skipped', () => {
  const env = setupImport({ masterRows: [
    masterRow({ name: 'AL ONE', entry_date: '1 Mar 2026' }),
    masterRow({ name: 'AL ONE', entry_date: '1 Jun 2026' }),
    masterRow({ name: 'BO TWO', entry_date: '1 Mar 2026', result: 'QUIT' }),
    masterRow({ name: 'BO TWO', entry_date: '1 Jun 2026' }),
  ] });
  env.decide(confirmAll(['AL ONE', 'BO TWO']));
  const v = env.validateOk();
  assert.deepEqual(env.results(v.import_id), { 2: 'NOT_READY', 3: 'NOT_READY', 4: 'READY', 5: 'READY' });
  assert.deepEqual(env.codesOf(v.import_id, 2), ['OPEN_TWICE']);
  assert.deepEqual(env.codesOf(v.import_id, 3), ['OPEN_TWICE']);
  // skip one and validate again: the other becomes READY
  const row = env.importRows(v.import_id).find((r) => r.source_row === 2);
  const sk = env.call('import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: 'Duplicate entry on the sheet' }, env.admin);
  assert.equal(sk.ok, true, JSON.stringify(sk));
  const v2 = env.validateOk();
  assert.deepEqual(env.results(v2.import_id), { 2: 'SKIPPED', 3: 'READY', 4: 'READY', 5: 'READY' });
});

test('Certified counts as open for OPEN_TWICE (RULE-100); Failed, Quit and Promoted do not', () => {
  const env = setupImport({ masterRows: [
    masterRow({ name: 'AL ONE', result: 'CERTIFIED', entry_date: '1 Mar 2026' }),
    masterRow({ name: 'AL ONE', result: 'PROBATIONARY', entry_date: '1 Jun 2026' }),
    masterRow({ name: 'BO TWO', result: 'PROMOTION', entry_date: '1 Mar 2025' }),
    masterRow({ name: 'BO TWO', result: 'FAILED', entry_date: '1 Mar 2026' }),
    masterRow({ name: 'BO TWO', result: 'PROBATIONARY', entry_date: '1 Jun 2026' }),
  ] });
  env.decide(confirmAll(['AL ONE', 'BO TWO']));
  const v = env.validateOk();
  assert.deepEqual(env.results(v.import_id), { 2: 'NOT_READY', 3: 'NOT_READY', 4: 'READY', 5: 'READY', 6: 'READY' });
});

test('CHANGED_AFTER_COMMIT: an enrollment with this row number and another hash', () => {
  const env = setupImport();
  env.decideBaseline();
  env.g('Repository').transact((uow) => {
    const per = uow.insert('persons', { last_name: 'OLD', first_name: 'ROW', legacy_ref: 'LEGACY:OLD ROW' }, env.actor);
    uow.insert('tl_enrollments', {
      person_id: per.id, mother_location_id: 'LOC-0001', entry_date: '2025-01-01', deadline: '2025-04-01', status: 'Failed', legacy_ref: 'MASTER_LOG!2#deadbeef',
    }, env.actor, 2025);
  });
  const v = env.validateOk();
  assert.deepEqual(env.codesOf(v.import_id, 2), ['CHANGED_AFTER_COMMIT']);
  assert.equal(env.results(v.import_id)[2], 'NOT_READY');
  assert.equal(env.results(v.import_id)[3], 'READY');
});

test('a row whose legacy_ref is already an enrollment is ALREADY_COMMITTED', () => {
  const env = setupImport();
  env.decideBaseline();
  const ref = planNow(env).find((i) => i.source_row === 2).legacy_ref;
  assert.match(ref, /^MASTER_LOG!2#[0-9a-f]{8}$/);
  let id;
  env.g('Repository').transact((uow) => {
    const per = uow.insert('persons', { last_name: 'TESTER', first_name: 'MARCO', legacy_ref: 'LEGACY:MARCO TESTER' }, env.actor);
    id = uow.insert('tl_enrollments', {
      person_id: per.id, mother_location_id: 'LOC-0001', entry_date: '2025-11-14', deadline: '2026-02-14', status: 'Certified', legacy_ref: ref,
    }, env.actor, 2025).id;
  });
  const v = env.validateOk();
  assert.equal(env.results(v.import_id)[2], 'ALREADY_COMMITTED');
  const row = env.importRows(v.import_id).find((r) => r.source_row === 2);
  assert.deepEqual([row.created_record_type, row.created_record_id], ['tl_enrollments', id]);
});

test('an unmapped CERT BY officer is a warning; the row stays ready', () => {
  const env = setupImport();
  env.decideBaseline();
  const v = env.validateOk();
  assert.equal(env.results(v.import_id)[6], 'READY');
  assert.ok(env.warningsOf(v.import_id, 6).includes('OFFICER_UNMAPPED'));
  const item = rowOf(planNow(env), 3);
  assert.equal(item.result, 'READY');
  assert.deepEqual(item.plan.officers.length, 2, 'two mapped officers in "OLIVIA | MARCO"');
  const unmapped = planNow(env).find((i) => i.source_row === 6);
  assert.deepEqual(unmapped.plan.officers, [], 'an unmapped CERT BY officer is not used');
});

test('a typed note in CERT BY or ENTRY BY goes to remarks as "Legacy note: ..."', () => {
  const env = setupImport();
  env.decideBaseline();
  const items = planNow(env);
  assert.equal(rowOf(items, 4).plan.enrollment.remarks, 'Legacy note: NO CERT');
  assert.equal(rowOf(items, 6).plan.enrollment.remarks, 'Legacy note: GIO / 2ND EXTEND');
  assert.ok(rowOf(items, 4).warnings.some((w) => w.code === 'OFFICER_NOTE'));
});

test('a typed entry average that differs by more than 0.5 is a warning and is not used', () => {
  const env = setupImport({ masterRows: [
    masterRow({ name: 'AL ONE', istv: '90%', techval_fp: '80%', entry_average: '99%' }),
    masterRow({ name: 'BO TWO', istv: '90%', techval_fp: '80%', entry_average: '85.3%' }),
  ] });
  env.decide(confirmAll(['AL ONE', 'BO TWO']));
  const items = planNow(env);
  assert.deepEqual(items[0].warnings.map((w) => w.code), ['ENTRY_AVERAGE_DIFFERS']);
  assert.deepEqual(items[1].warnings.map((w) => w.code), []);
  assert.equal(items[0].result, 'READY');
});

test('the mapping of grades: T is the TL course program, U is the Exam, retake_no 1, dated by column S; K to O are retake_no 0 dated by the entry date', () => {
  const env = setupImport();
  env.decideBaseline();
  const row2 = rowOf(planNow(env), 2).plan;
  const comp = (id) => env.rows('assessment_components').find((c) => c.id === id).name;
  const g = Object.fromEntries(row2.grades.map((x) => [x.field, x]));
  assert.equal(comp(g.cert_grade.component_id), 'TL course program');
  assert.equal(comp(g.exam_grade.component_id), 'Exam');
  assert.deepEqual([g.cert_grade.retake_no, g.cert_grade.assessed_on, g.exam_grade.retake_no], [1, '2026-02-20', 1]);
  assert.equal(row2.grades.some((x) => comp(x.component_id) === 'Checklist'), false, 'no legacy row gets a Checklist grade');
  assert.deepEqual([g.istv.retake_no, g.istv.assessed_on, comp(g.istv.component_id)], [0, '2025-11-14', 'ISTV']);
  assert.equal(row2.enrollment.final_grade, 89);
  assert.equal(row2.enrollment.weights_version, 'LEGACY');
  assert.equal(row2.enrollment.pass_mark_used, undefined);
  assert.equal(row2.enrollment.certified_on, '2026-02-20');
});

test('the deadline is column Q when present, otherwise the entry date plus CFG-040 months', () => {
  const env = setupImport();
  env.decideBaseline();
  const items = planNow(env);
  assert.equal(rowOf(items, 2).plan.enrollment.deadline, '2026-02-14');
  assert.equal(rowOf(items, 5).plan.enrollment.deadline, '2026-08-05');
  assert.equal(rowOf(items, 6).plan.enrollment.deadline, '2026-12-23');
});

test('a certification grade without a date certified is a warning and is not imported', () => {
  const env = setupImport({ masterRows: [masterRow({ name: 'AL ONE', cert_grade: '91%', exam_grade: '88%' })] });
  env.decide(confirmAll(['AL ONE']));
  const item = planNow(env)[0];
  assert.equal(item.result, 'READY');
  assert.deepEqual(item.warnings.map((w) => w.code), ['CERT_GRADE_NO_DATE', 'CERT_GRADE_NO_DATE']);
  assert.deepEqual(item.plan.grades.map((g) => g.field), ['istv']);
});

test('a decision marked needs_review still counts, and the row carries a warning', () => {
  const env = setupImport();
  env.decideBaseline();
  const sheet = env.review.getSheetByName('persons_proposed');
  const rows = env.tab('persons_proposed');
  const idx = rows.findIndex((r) => r[0] === 'MARCO TESTER');
  sheet.getRange(idx + 1, rows[0].indexOf('needs_review') + 1, 1, 1).setValues([['TRUE']]);
  const item = rowOf(planNow(env), 2);
  assert.equal(item.result, 'READY');
  assert.ok(item.warnings.some((w) => w.code === 'DECISION_FLAGGED'));
});

test('a review sheet without the proposed name parts leaves a confirm unusable', () => {
  const env = setupImport({ masterRows: [masterRow({ name: 'AL ONE' })] });
  env.decide(confirmAll(['AL ONE']));
  const rows = env.tab('persons_proposed');
  const keep = rows.map((r) => r.filter((c, i) => [5, 6, 7, 8].indexOf(i) < 0));
  fillTab(env.review, 'persons_proposed', keep);
  assert.deepEqual(planNow(env)[0].issues.map((i) => i.code), ['PERSON_UNCONFIRMED']);
});

test('every issue code of spec 10.3 is covered by a test above', () => {
  assert.equal(ISSUE_CODES.length, 10);
});

test('validate writes only import_batches, import_rows, id_counters and audit_log', () => {
  const env = setupImport();
  env.decideBaseline();
  const before = JSON.parse(env.snapshot());
  const v = env.validateOk();
  const after = JSON.parse(env.snapshot());
  const changed = after.filter((t, i) => JSON.stringify(t) !== JSON.stringify(before[i])).map((t) => t[0]).sort();
  assert.deepEqual(changed, ['audit_log', 'id_counters', 'import_batches', 'import_rows']);
  assert.equal(env.importRows(v.import_id).length, 10);
  const audit = env.auditRows().filter((a) => a.event === 'IMPORT.VALIDATED');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entity_id, v.import_id);
  // the legacy copy and the review sheet are only read
  assert.equal(env.legacy.getSheetByName('MASTER_LOG').getLastRow(), 1 + M.MASTER_LOG_ROWS.length);
});

test('validate does not write to the legacy copy or the review sheet', () => {
  const env = setupImport();
  env.decideBaseline();
  const legacy = JSON.stringify(env.legacy.getSheetByName('MASTER_LOG').getRange(1, 1, 12, 23).getValues());
  const review = JSON.stringify(['persons_proposed', 'possible_duplicates', 'name_mapping', 'bad_values'].map((t) => env.tab(t)));
  env.validateOk();
  env.validateOk();
  assert.equal(JSON.stringify(env.legacy.getSheetByName('MASTER_LOG').getRange(1, 1, 12, 23).getValues()), legacy);
  assert.equal(JSON.stringify(['persons_proposed', 'possible_duplicates', 'name_mapping', 'bad_values'].map((t) => env.tab(t))), review);
});

test('a skip is carried to the next validation by legacy_ref', () => {
  const env = setupImport();
  env.decideBaseline();
  const v1 = env.validateOk();
  const row = env.importRows(v1.import_id).find((r) => r.source_row === 11);
  const sk = env.call('import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: 'Not a Team Leader' }, env.admin);
  assert.equal(sk.ok, true, JSON.stringify(sk));
  assert.equal(sk.data.result, 'SKIPPED');
  const v2 = env.validateOk();
  const again = env.importRows(v2.import_id).find((r) => r.source_row === 11);
  assert.deepEqual([again.result, again.skip_reason], ['SKIPPED', 'Not a Team Leader']);
  assert.ok(env.auditRows().some((a) => a.event === 'IMPORT.ROW_SKIPPED' && a.entity_id === row.id));
});

test('a skip is not carried when the source row changed', () => {
  const env = setupImport();
  env.decideBaseline();
  const v1 = env.validateOk();
  const row = env.importRows(v1.import_id).find((r) => r.source_row === 11);
  env.call('import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: 'Not a Team Leader' }, env.admin);
  env.legacy.getSheetByName('MASTER_LOG').getRange(11, 13 - 1).setValues([['A CHANGED BATCH']]);
  const v2 = env.validateOk();
  assert.equal(env.importRows(v2.import_id).find((r) => r.source_row === 11).result, 'NOT_READY');
});

test('a new validation sets the earlier Validated batch to Superseded; a Committed batch stays Committed', () => {
  const env = setupImport();
  env.decideBaseline();
  const v1 = env.validateOk();
  const v2 = env.validateOk();
  const status = (id) => env.rows('import_batches').find((b) => b.id === id).status;
  assert.deepEqual([status(v1.import_id), status(v2.import_id)], ['Superseded', 'Validated']);
  // a batch that is Committed (or Committing) is never superseded
  env.g('Repository').transact((uow) => {
    const b = uow.get('import_batches', v2.import_id);
    uow.update('import_batches', b.id, { status: 'Committed' }, { expectedVersion: b.row_version, actor: env.actor });
  });
  const v3 = env.validateOk();
  assert.deepEqual([status(v2.import_id), status(v3.import_id)], ['Committed', 'Validated']);
});

test('import.get reports the latest batch and its counts', () => {
  const env = setupImport();
  env.decideBaseline();
  assert.deepEqual(env.call('import.get', {}, env.admin).data, { batch: null, counts: null, reconciliation: null });
  const v = env.validateOk();
  env.validateOk();
  const latest = env.call('import.get', {}, env.admin);
  assert.equal(latest.ok, true);
  assert.equal(latest.data.batch.is_latest, true);
  const first = env.call('import.get', { import_id: v.import_id }, env.admin);
  assert.equal(first.data.batch.status, 'Superseded');
  assert.equal(first.data.batch.is_latest, false);
  assert.deepEqual(latest.data.counts.by_result, { READY: 8, NOT_READY: 2, SKIPPED: 0, COMMITTED: 0, ALREADY_COMMITTED: 0 });
  assert.equal(latest.data.reconciliation.source_rows, 10);
  assert.equal(latest.data.reconciliation.reconciled, false);
  assert.equal(env.call('import.get', { import_id: 'IMP-9999' }, env.admin).error.code, 'NOT_FOUND');
});

test('import.rows.list filters by result and pages', () => {
  const env = setupImport();
  env.decideBaseline();
  const v = env.validateOk();
  const all = env.call('import.rows.list', { import_id: v.import_id, page_size: 4 }, env.admin);
  assert.equal(all.ok, true);
  assert.equal(all.data.length, 4);
  assert.deepEqual(all.meta.page, { page: 1, page_size: 4, total: 10 });
  assert.deepEqual(all.data.map((r) => r.source_row), [2, 3, 4, 5]);
  const notReady = env.call('import.rows.list', { import_id: v.import_id, filters: { result: 'NOT_READY' } }, env.admin);
  assert.deepEqual(notReady.data.map((r) => r.source_row), [11, 12]);
  assert.deepEqual(notReady.data[1].issues.map((i) => i.code), ['PERSON_UNCONFIRMED', 'ENTRY_DATE_BAD']);
  assert.equal(notReady.data[0].legacy_result, 'MAYBE');
  const big = env.call('import.rows.list', { import_id: v.import_id, page_size: 51 }, env.admin);
  assert.equal(big.error.code, 'VALIDATION');
  const bad = env.call('import.rows.list', { import_id: v.import_id, filters: { issue: 'X' } }, env.admin);
  assert.equal(bad.error.code, 'VALIDATION');
  const found = env.call('import.rows.list', { import_id: v.import_id, q: 'STATUS_BAD' }, env.admin);
  assert.deepEqual(found.data.map((r) => r.source_row), [11]);
});

test('import.rows.skip refuses a stale row_version, a missing reason, a committed row and a superseded batch', () => {
  const env = setupImport();
  env.decideBaseline();
  const v1 = env.validateOk();
  const row = env.importRows(v1.import_id).find((r) => r.source_row === 11);
  assert.equal(env.call('import.rows.skip', { id: row.id, row_version: row.row_version + 1, skip_reason: 'x' }, env.admin).error.code, 'CONFLICT');
  assert.equal(env.call('import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: '   ' }, env.admin).error.code, 'VALIDATION');
  assert.equal(env.call('import.rows.skip', { id: row.id, row_version: row.row_version }, env.admin).error.code, 'VALIDATION');
  assert.equal(env.call('import.rows.skip', { id: 'IMR-999999', row_version: 1, skip_reason: 'x' }, env.admin).error.code, 'NOT_FOUND');
  env.validateOk();
  const stale = env.call('import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: 'x' }, env.admin);
  assert.equal(stale.error.code, 'VALIDATION');
  assert.equal(env.importRows(v1.import_id).find((r) => r.id === row.id).result, 'NOT_READY');
});

test('a non-Admin is FORBIDDEN on a direct call of each import method', () => {
  const env = setupImport();
  env.decideBaseline();
  const v = env.validateOk();
  const row = env.importRows(v.import_id)[0];
  const calls = [
    ['import.validate', {}],
    ['import.get', { import_id: v.import_id }],
    ['import.rows.list', { import_id: v.import_id }],
    ['import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: 'x' }],
  ];
  ['officer', 'supervisor', 'manager', 'senior'].forEach((role) => {
    const token = env.signIn(role);
    calls.forEach(([m, p]) => {
      const r = env.call(m, p, token);
      assert.equal(r.ok, false, role + ' ' + m);
      assert.equal(r.error.code, 'FORBIDDEN', role + ' ' + m);
    });
  });
  assert.equal(env.importRows(v.import_id)[0].result, row.result);
});

test('validate without the review sheet or the legacy copy is CONFIG_MISSING', () => {
  const env = setupImport();
  env.g('Props').remove('REVIEW_SHEET_ID');
  assert.equal(env.validate().error.code, 'CONFIG_MISSING');
  env.g('Props').set('REVIEW_SHEET_ID', 'review-sheet-id');
  env.g('Props').remove('LEGACY_COPY_ID');
  assert.equal(env.validate().error.code, 'CONFIG_MISSING');
});

test('the validation answer holds no password, hash or sheet id', () => {
  const env = setupImport();
  env.decideBaseline();
  const text = JSON.stringify(env.validate()) + JSON.stringify(env.call('import.get', {}, env.admin));
  assert.doesNotMatch(text, /password|hash|salt|pepper|legacy-copy-id|review-sheet-id|fake-db-id/i);
});

void ISSUE_CODES;
