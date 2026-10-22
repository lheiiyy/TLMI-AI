'use strict';
// Legacy import: the commit in chunks and the reconciliation (spec 10.5 and 10.6). Invented data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupImport, masterRow } = require('../helpers/import-env');
const { loadServer } = require('../helpers/loader');

const SYL = ['KA', 'LO', 'MI', 'NE', 'RU', 'SA'];
const name = (i) => SYL[i % 6] + SYL[Math.floor(i / 6) % 6] + SYL[Math.floor(i / 36) % 6] + ' TESTER';
const confirmAll = (names) => ({ persons: Object.fromEntries(names.map((n) => [n, 'confirm'])) });
const today = () => '2026-10-20';

// Validates the baseline decisions, skips the two NOT_READY rows with a reason, and returns the batch.
function baselineBatch() {
  const env = setupImport();
  env.decideBaseline();
  const v = env.validateOk();
  for (const n of [11, 12]) {
    const row = env.importRows(v.import_id).find((r) => r.source_row === n);
    const sk = env.call('import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: 'Not importable: invented test reason' }, env.admin);
    assert.equal(sk.ok, true, JSON.stringify(sk));
  }
  env.batch = (id) => env.rows('import_batches').find((b) => b.id === (id || v.import_id));
  env.commit = (extra, id) => env.call('import.commit', Object.assign({ import_id: id || v.import_id, row_version: env.batch(id).row_version, backup_date: today() }, extra || {}), env.admin);
  env.v = v;
  return env;
}

function manyRows(n) {
  const names = [];
  const rows = [];
  for (let i = 0; i < n; i++) { names.push(name(i)); rows.push(masterRow({ name: name(i), entry_date: '1 Mar 2026' })); }
  const env = setupImport({ masterRows: rows });
  env.decide(confirmAll(names));
  const v = env.validateOk();
  env.v = v;
  env.commit = (extra) => env.call('import.commit', Object.assign({ import_id: v.import_id, row_version: env.rows('import_batches').find((b) => b.id === v.import_id).row_version, backup_date: today() }, extra || {}), env.admin);
  return env;
}

test('backup_date other than today is VALIDATION and nothing is written', () => {
  const env = baselineBatch();
  const before = env.snapshot();
  for (const d of ['2026-10-19', '2026-10-21']) {
    const r = env.commit({ backup_date: d });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION');
    assert.equal(r.error.fields[0].path, 'backup_date');
  }
  assert.equal(env.call('import.commit', { import_id: env.v.import_id, row_version: env.batch().row_version }, env.admin).error.code, 'VALIDATION');
  assert.equal(env.snapshot(), before);
});

test('commit creates person, aliases, enrollment, grades, officers and history for a ready row', () => {
  const env = baselineBatch();
  const r = env.commit();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.committed, r.data.remaining, r.data.status], [8, 0, 'Committed']);
  const enr = env.rows('tl_enrollments');
  assert.equal(enr.length, 8);
  const marco = enr.find((e) => e.legacy_ref.startsWith('MASTER_LOG!2#'));
  assert.match(marco.id, /^TLE-2025-\d{4}$/, 'the ID year is the entry date year');
  assert.deepEqual([marco.status, marco.entry_date, marco.deadline, marco.batch_code, marco.certified_on, marco.final_grade, marco.weights_version],
    ['Certified', '2025-11-14', '2026-02-14', 'BATCH 1', '2026-02-20', 89, 'LEGACY']);
  assert.equal(marco.pass_mark_used, null);
  const person = env.rows('persons').find((p) => p.id === marco.person_id);
  assert.deepEqual([person.last_name, person.first_name, person.legacy_ref], ['TESTER', 'MARCO', 'LEGACY:MARCO TESTER']);
  assert.ok(env.rows('person_aliases').some((a) => a.person_id === person.id && a.alias_type === 'NAME' && a.value === 'MARCO TESTER'));
  const comp = (id) => env.rows('assessment_components').find((c) => c.id === id).name;
  const asm = env.rows('assessments').filter((a) => a.subject_id === marco.id);
  assert.deepEqual(asm.map((a) => [comp(a.component_id), a.score, a.retake_no, a.assessed_on]).sort(),
    [['Exam', 88, 1, '2026-02-20'], ['ISTV', 95, 0, '2025-11-14'], ['TL course program', 90, 1, '2026-02-20'], ['Tech Val Food Prep', 90, 0, '2025-11-14'],
      ['Tech Val Pizza Maker', 92, 0, '2025-11-14'], ['TL entry exam Food Prep', 88, 0, '2025-11-14'], ['TL entry exam Pizza Maker', 91, 0, '2025-11-14']].sort());
  const officers = env.rows('tl_certifying_officers').filter((o) => o.tl_enrollment_id === marco.id);
  assert.deepEqual(officers.map((o) => o.retake_no), [1]);
  assert.equal(env.rows('users').find((u) => u.id === officers[0].user_id).display_name, 'Olivia Tester');
  const hist = env.rows('status_history').filter((h) => h.entity_id === marco.id);
  assert.equal(hist.length, 1);
  assert.deepEqual([hist[0].from_status, hist[0].to_status, hist[0].effective_date], ['', 'Certified', '2026-02-20']);
  assert.match(hist[0].remark, new RegExp('^Legacy import ' + env.v.import_id + ' row 2$'));
  const audit = env.auditRows().filter((a) => a.event === 'TL.ENROLLED' && a.entity_id === marco.id);
  assert.equal(audit.length, 1);
  assert.deepEqual([JSON.parse(audit[0].detail).source, JSON.parse(audit[0].detail).import_id], ['LEGACY_IMPORT', env.v.import_id]);
  const rows = env.importRows(env.v.import_id);
  const row2 = rows.find((x) => x.source_row === 2);
  assert.deepEqual([row2.result, row2.created_record_type, row2.created_record_id], ['COMMITTED', 'tl_enrollments', marco.id]);
});

test('one IMPORT.COMMITTED audit row per call, with the counts', () => {
  const env = baselineBatch();
  env.commit();
  const rows = env.auditRows().filter((a) => a.event === 'IMPORT.COMMITTED');
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].detail), { committed: 8, held: 0, remaining: 0, status: 'Committed' });
  assert.equal(rows[0].entity_id, env.v.import_id);
});

test('a person with two rows gets one person and two enrollments', () => {
  const env = baselineBatch();
  env.commit();
  const persons = env.rows('persons');
  const rea = persons.filter((p) => p.legacy_ref === 'LEGACY:REA SAMPLE');
  assert.equal(rea.length, 1);
  assert.equal(env.rows('tl_enrollments').filter((e) => e.person_id === rea[0].id).length, 2);
  // a confirmed duplicate pair is one person with both spellings as aliases
  const daryl = persons.filter((p) => p.legacy_ref.startsWith('LEGACY:DARYL'));
  assert.equal(daryl.length, 1);
  assert.equal(env.rows('tl_enrollments').filter((e) => e.person_id === daryl[0].id).length, 2);
  const names = env.rows('person_aliases').filter((a) => a.person_id === daryl[0].id && a.alias_type === 'NAME').map((a) => a.value).sort();
  assert.deepEqual(names, ['DARYL FAYE C. SAMPLE', 'DARYL FAYE SAMPLE']);
  assert.equal(persons.length, 6, 'MARCO, ANA, REA, DARYL, LEO and KIM, and nobody else');
});

test('DISQUALIFIED becomes Failed with close reason Disqualified', () => {
  const env = baselineBatch();
  env.commit();
  const e = env.rows('tl_enrollments').find((x) => x.legacy_ref.startsWith('MASTER_LOG!7#'));
  assert.equal(e.status, 'Failed');
  assert.equal(env.rows('lookups').find((l) => l.id === e.close_reason_id).value, 'Disqualified');
  const failed = env.rows('tl_enrollments').find((x) => x.legacy_ref.startsWith('MASTER_LOG!8#'));
  assert.equal(failed.status, 'Failed');
  assert.equal(failed.close_reason_id, '');
});

test('legacy final is kept with weights_version LEGACY and is not recomputed', () => {
  const env = baselineBatch();
  env.commit();
  for (const e of env.rows('tl_enrollments')) assert.equal(e.weights_version, 'LEGACY');
  const kim = env.rows('tl_enrollments').find((x) => x.legacy_ref.startsWith('MASTER_LOG!9#'));
  assert.equal(kim.final_grade, 90);
  const rea = env.rows('tl_enrollments').find((x) => x.legacy_ref.startsWith('MASTER_LOG!5#'));
  assert.equal(rea.final_grade, null);
  // the app reads an imported record without recomputing or failing
  const got = env.call('tl.get', { id: kim.id }, env.t ? env.t.admin : env.admin);
  assert.equal(got.ok, true, JSON.stringify(got));
  assert.equal(got.data.enrollment.final_grade, 90);
  assert.equal(got.data.attempts[0].final_grade, null, 'no recomputed final for a legacy attempt');
});

test('legacy CERTFICATION GRADE becomes a TL course program grade, never a Checklist grade', () => {
  const env = baselineBatch();
  env.commit();
  const names = Object.fromEntries(env.rows('assessment_components').map((c) => [c.id, c.name]));
  const all = env.rows('assessments');
  assert.ok(all.length > 0);
  assert.equal(all.some((a) => names[a.component_id] === 'Checklist'), false);
  const course = all.filter((a) => names[a.component_id] === 'TL course program');
  assert.equal(course.length, 3, 'rows 2, 3 and 9 have a certification grade');
  assert.ok(course.every((a) => a.retake_no === 1));
  const exam = all.filter((a) => names[a.component_id] === 'Exam');
  assert.ok(exam.every((a) => a.retake_no === 1));
  // every assessment has a legacy_ref that points at its source row
  assert.ok(all.every((a) => /^MASTER_LOG!\d+#[0-9a-f]{8}:/.test(a.legacy_ref)));
});

test('a commit stopped after one chunk and called again commits each row once', () => {
  const env = manyRows(60);
  assert.equal(env.v.counts.by_result.READY, 60);
  const LG = env.g('LockGuard');
  const orig = LG.run;
  let calls = 0;
  LG.run = function (fn, wait) {
    calls += 1;
    if (calls === 2) throw env.g('Errors').busy(5);
    return orig.call(LG, fn, wait);
  };
  const first = env.commit();
  LG.run = orig;
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual([first.data.committed, first.data.remaining, first.data.status, first.data.stopped], [25, 35, 'Committing', 'BUSY']);
  assert.equal(env.rows('tl_enrollments').length, 25);
  assert.equal(env.importRows(env.v.import_id).filter((r) => r.result === 'COMMITTED').length, 25);
  // the stopped call is audited
  assert.equal(env.auditRows().filter((a) => a.event === 'IMPORT.COMMITTED').length, 1);
  // called again with the new row_version
  const second = env.call('import.commit', { import_id: env.v.import_id, row_version: first.data.row_version, backup_date: today() }, env.admin);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual([second.data.committed, second.data.remaining, second.data.status], [35, 0, 'Committed']);
  const enr = env.rows('tl_enrollments');
  assert.equal(enr.length, 60);
  assert.equal(new Set(enr.map((e) => e.legacy_ref)).size, 60, 'each source row exactly once');
  assert.equal(new Set(enr.map((e) => e.person_id)).size, 60);
  assert.equal(env.rows('persons').length, 60);
  assert.equal(env.rows('status_history').filter((h) => h.entity === 'tl_enrollments').length, 60);
});

test('a first chunk that is busy is an error and writes nothing', () => {
  const env = manyRows(30);
  const before = env.snapshot();
  const LG = env.g('LockGuard');
  const orig = LG.run;
  LG.run = function () { throw env.g('Errors').busy(5); };
  const r = env.commit();
  LG.run = orig;
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BUSY');
  assert.equal(env.snapshot(), before);
});

test('one call commits at most four chunks (100 rows); the caller continues', () => {
  const env = manyRows(110);
  const a = env.commit();
  assert.deepEqual([a.data.committed, a.data.remaining, a.data.status], [100, 10, 'Committing']);
  const b = env.call('import.commit', { import_id: env.v.import_id, row_version: a.data.row_version, backup_date: today() }, env.admin);
  assert.deepEqual([b.data.committed, b.data.remaining, b.data.status], [10, 0, 'Committed']);
  assert.equal(env.rows('tl_enrollments').length, 110);
  assert.equal(env.auditRows().filter((x) => x.event === 'IMPORT.COMMITTED').length, 2);
});

test('validate after commit shows ALREADY_COMMITTED, and a second commit creates nothing new', () => {
  const env = baselineBatch();
  env.commit();
  const before = {
    enr: env.rows('tl_enrollments').length, per: env.rows('persons').length, asm: env.rows('assessments').length,
    alias: env.rows('person_aliases').length, off: env.rows('tl_certifying_officers').length, hist: env.rows('status_history').length,
  };
  // the Committed batch itself: calling commit again writes nothing
  const again = env.commit();
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.deepEqual([again.data.committed, again.data.remaining, again.data.status], [0, 0, 'Committed']);
  // validate again: the committed rows are ALREADY_COMMITTED; the skipped rows are skipped again
  const v2 = env.validateOk();
  const r = env.results(v2.import_id);
  assert.deepEqual(Object.values(r).filter((x) => x === 'ALREADY_COMMITTED').length, 8);
  assert.equal(r[11], 'SKIPPED');
  assert.equal(r[12], 'SKIPPED');
  assert.equal(env.rows('import_batches').find((b) => b.id === env.v.import_id).status, 'Committed');
  const c2 = env.call('import.commit', { import_id: v2.import_id, row_version: env.batch(v2.import_id).row_version, backup_date: today() }, env.admin);
  assert.equal(c2.ok, true, JSON.stringify(c2));
  assert.deepEqual([c2.data.committed, c2.data.remaining, c2.data.status], [0, 0, 'Committed']);
  assert.deepEqual({
    enr: env.rows('tl_enrollments').length, per: env.rows('persons').length, asm: env.rows('assessments').length,
    alias: env.rows('person_aliases').length, off: env.rows('tl_certifying_officers').length, hist: env.rows('status_history').length,
  }, before);
  assert.equal(env.call('import.get', {}, env.admin).data.reconciliation.reconciled, true);
});

test('a not-ready row is never committed', () => {
  const env = setupImport();
  env.decideBaseline();
  const v = env.validateOk();
  const r = env.call('import.commit', { import_id: v.import_id, row_version: env.rows('import_batches').find((b) => b.id === v.import_id).row_version, backup_date: today() }, env.admin);
  assert.equal(r.ok, true);
  assert.equal(r.data.committed, 8);
  const rows = env.importRows(v.import_id);
  assert.equal(rows.find((x) => x.source_row === 11).result, 'NOT_READY');
  assert.equal(rows.find((x) => x.source_row === 12).result, 'NOT_READY');
  assert.equal(env.rows('tl_enrollments').some((e) => /^MASTER_LOG!(11|12)#/.test(e.legacy_ref)), false);
  assert.equal(env.rows('persons').some((p) => p.legacy_ref === 'LEGACY:PAT SAMPLE' || p.legacy_ref === 'LEGACY:SAM SAMPLE'), false);
  // the batch is Committed (no READY row is left), and the reconciliation says it is not reconciled
  assert.equal(r.data.status, 'Committed');
  assert.equal(env.call('import.get', {}, env.admin).data.reconciliation.reconciled, false);
});

test('a skipped row is not committed and is carried', () => {
  const env = baselineBatch();
  env.commit();
  assert.equal(env.rows('tl_enrollments').some((e) => /^MASTER_LOG!(11|12)#/.test(e.legacy_ref)), false);
  assert.equal(env.importRows(env.v.import_id).filter((r) => r.result === 'SKIPPED').length, 2);
});

test('commit writes nothing to the legacy copy or the review sheet', () => {
  const env = baselineBatch();
  const grab = () => JSON.stringify([
    env.legacy.getSheetByName('MASTER_LOG').getRange(1, 1, 12, 23).getValues(),
    ['persons_proposed', 'possible_duplicates', 'name_mapping', 'bad_values', 'uniform_split', 'summary'].map((t) => env.tab(t)),
    env.google.sheets.get('legacy-copy-id').getSheets ? env.google.sheets.get('legacy-copy-id').getSheets().length : 0,
  ]);
  const before = grab();
  env.commit();
  assert.equal(grab(), before);
});

test('commit refuses a stale row_version with CONFLICT and writes nothing', () => {
  const env = baselineBatch();
  const before = env.snapshot();
  const r = env.call('import.commit', { import_id: env.v.import_id, row_version: env.batch().row_version + 1, backup_date: today() }, env.admin);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CONFLICT');
  assert.ok(r.error.current.row_version);
  // the refusal itself is audited by the API layer; nothing else changed
  assert.equal(env.rows('tl_enrollments').length, 0);
  assert.equal(env.rows('import_rows').filter((x) => x.result === 'COMMITTED').length, 0);
  assert.notEqual(env.snapshot(), before, 'the audit row of the refused call');
});

test('commit refuses a superseded batch, an older batch and a batch whose inputs changed', () => {
  const env = baselineBatch();
  const old = env.v.import_id;
  const oldVersion = env.batch(old).row_version;
  const v2 = env.validateOk();
  let r = env.call('import.commit', { import_id: old, row_version: env.batch(old).row_version, backup_date: today() }, env.admin);
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].code, 'STATE');
  assert.notEqual(env.batch(old).row_version, oldVersion);
  // a decision changes after the validation: the commit is refused until the review is validated again
  env.decide({ persons: { 'MARCO TESTER': 'different person' } });
  r = env.call('import.commit', { import_id: v2.import_id, row_version: env.batch(v2.import_id).row_version, backup_date: today() }, env.admin);
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.fields[0].code, 'REVIEW_CHANGED');
  assert.equal(env.rows('tl_enrollments').length, 0);
  // a source row changes after the validation
  env.decide({ persons: { 'MARCO TESTER': 'confirm' } });
  const v3 = env.validateOk();
  env.legacy.getSheetByName('MASTER_LOG').getRange(2, 3).setValues([['A DIFFERENT BATCH']]);
  r = env.call('import.commit', { import_id: v3.import_id, row_version: env.batch(v3.import_id).row_version, backup_date: today() }, env.admin);
  assert.equal(r.error.fields[0].code, 'REVIEW_CHANGED');
});

test('a batch that is not the latest cannot be committed', () => {
  const env = baselineBatch();
  const first = env.v.import_id;
  env.validateOk();
  // make the first batch look Validated again, as if both were: only the newest may be committed
  env.g('Repository').transact((uow) => {
    const b = uow.get('import_batches', first);
    uow.update('import_batches', first, { status: 'Validated' }, { expectedVersion: b.row_version, actor: env.actor });
  });
  const r = env.call('import.commit', { import_id: first, row_version: env.batch(first).row_version, backup_date: today() }, env.admin);
  assert.equal(r.error.fields[0].code, 'NOT_LATEST');
});

test('a row that is no longer ready at commit time is re-judged and not written', () => {
  const env = setupImport({ masterRows: [masterRow({ name: 'AL ONE' }), masterRow({ name: 'BO TWO' })] });
  env.decide(confirmAll(['AL ONE', 'BO TWO']));
  const v = env.validateOk();
  assert.deepEqual(env.results(v.import_id), { 2: 'READY', 3: 'READY' });
  // the app enrolls an open record for the imported person before the commit
  env.g('Repository').transact((uow) => {
    const per = uow.insert('persons', { last_name: 'ONE', first_name: 'AL', legacy_ref: 'LEGACY:AL ONE' }, env.actor);
    uow.insert('tl_enrollments', { person_id: per.id, mother_location_id: 'LOC-0001', entry_date: '2026-01-05', deadline: '2026-04-05', status: 'Probationary' }, env.actor, 2026);
  });
  const r = env.call('import.commit', { import_id: v.import_id, row_version: env.rows('import_batches').find((b) => b.id === v.import_id).row_version, backup_date: today() }, env.admin);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.committed, r.data.held], [1, 1]);
  assert.deepEqual(env.results(v.import_id), { 2: 'NOT_READY', 3: 'COMMITTED' });
  assert.deepEqual(env.codesOf(v.import_id, 2), ['OPEN_TWICE']);
  assert.equal(env.rows('tl_enrollments').filter((e) => (e.legacy_ref || '').startsWith('MASTER_LOG!')).length, 1);
});

test('a non-Admin gets FORBIDDEN on import.commit and nothing is written', () => {
  const env = baselineBatch();
  const before = env.rows('tl_enrollments').length;
  for (const role of ['officer', 'supervisor', 'manager', 'senior']) {
    const r = env.call('import.commit', { import_id: env.v.import_id, row_version: env.batch().row_version, backup_date: today() }, env.signIn(role));
    assert.equal(r.error.code, 'FORBIDDEN', role);
  }
  assert.equal(env.rows('tl_enrollments').length, before);
});

test('imported records appear in the roster and can be read, searched by alias, and acted on by the app rules', () => {
  const env = baselineBatch();
  env.commit();
  const list = env.call('tl.list', { page_size: 50 }, env.admin);
  assert.equal(list.ok, true, JSON.stringify(list));
  assert.equal(list.meta.page.total, 8);
  const found = env.call('tl.list', { q: 'daryl faye c sample' }, env.admin);
  assert.equal(found.data.length, 2, 'both enrollments of the merged person');
  const rea = env.rows('tl_enrollments').find((x) => x.legacy_ref.startsWith('MASTER_LOG!5#'));
  assert.equal(env.call('tl.history', { id: rea.id }, env.admin).ok, true);
  // a legacy record is not recomputed by the app: certify needs a final grade the app does not have for a legacy row with no final
  const cert = env.call('tl.certify', { id: rea.id, row_version: rea.row_version }, env.admin);
  assert.equal(cert.ok, false);
});

test('the commit answer holds no password, hash or sheet id', () => {
  const env = baselineBatch();
  const text = JSON.stringify(env.commit());
  assert.doesNotMatch(text, /password|hash|salt|pepper|legacy-copy-id|review-sheet-id|fake-db-id/i);
});

// ---- reconcile (pure) -------------------------------------------------------------------------------------------------
const S = loadServer().g('ImportService');
const R = (rows, batch) => JSON.parse(JSON.stringify(S.reconcile(batch || { source_row_count: rows.length }, rows)));
const done = (legacy, planned, actual, extra) => Object.assign({
  result: 'COMMITTED', issues: [], legacy_result: legacy, planned_status: planned, planned_close_reason: '', tlmi_status: actual, tlmi_close_reason: '',
}, extra || {});

test('reconcile is true only when every row is committed or skipped and the counts agree', () => {
  const rows = [done('CERTIFIED', 'Certified', 'Certified'), done('PROMOTION', 'Promoted', 'Promoted'),
    { result: 'SKIPPED', skip_reason: 'Duplicate', issues: [], legacy_result: 'QUIT', planned_status: 'Quit' },
    done('DISQUALIFIED', 'Failed', 'Failed', { planned_close_reason: 'Disqualified', tlmi_close_reason: 'Disqualified' }),
    done('CERTIFIED', 'Certified', 'Certified', { result: 'ALREADY_COMMITTED' })];
  const r = R(rows);
  assert.equal(r.reconciled, true);
  assert.deepEqual(r.legacy_result_counts, { CERTIFIED: 2, PROMOTION: 1, QUIT: 1, DISQUALIFIED: 1 });
  assert.deepEqual(r.tlmi_status_counts, { Certified: 2, Promoted: 1, Failed: 1 });
  assert.deepEqual(r.failed_disqualified, { expected: 1, actual: 1, agree: true });
  assert.equal(r.source_rows, 5);
  assert.deepEqual(r.by_result, { READY: 0, NOT_READY: 0, SKIPPED: 1, COMMITTED: 3, ALREADY_COMMITTED: 1 });
});

test('reconcile is false for a READY row, a NOT_READY row, a skip without a reason, or counts that differ', () => {
  const ok = done('CERTIFIED', 'Certified', 'Certified');
  assert.equal(R([ok, { result: 'READY', issues: [], legacy_result: 'QUIT' }]).reconciled, false);
  assert.equal(R([ok, { result: 'NOT_READY', issues: [{ code: 'STATUS_BAD' }], legacy_result: 'MAYBE' }]).reconciled, false);
  assert.equal(R([ok, { result: 'SKIPPED', skip_reason: '', issues: [], legacy_result: 'QUIT' }]).reconciled, false);
  const diff = R([ok, done('QUIT', 'Quit', 'Failed')]);
  assert.equal(diff.reconciled, false);
  assert.deepEqual(diff.status_table.filter((t) => !t.agree).map((t) => t.status), ['Failed', 'Quit']);
  // the disqualified count must agree as well
  assert.equal(R([done('DISQUALIFIED', 'Failed', 'Failed', { planned_close_reason: 'Disqualified', tlmi_close_reason: '' })]).reconciled, false);
  // fewer rows than the batch says
  assert.equal(R([ok], { source_row_count: 2 }).reconciled, false);
  assert.equal(R([], { source_row_count: 0 }).reconciled, false);
  // by issue
  const by = R([{ result: 'NOT_READY', issues: [{ code: 'STATUS_BAD' }, { code: 'STATUS_BAD' }, { code: 'OPEN_TWICE' }], legacy_result: 'X' }]);
  assert.deepEqual(by.by_issue, { STATUS_BAD: 1, OPEN_TWICE: 1 });
});

test('the reconciliation of a real commit agrees with the legacy RESULT counts', () => {
  const env = baselineBatch();
  env.commit();
  const rec = env.call('import.get', {}, env.admin).data.reconciliation;
  assert.equal(rec.reconciled, true, JSON.stringify(rec));
  assert.deepEqual(rec.legacy_result_counts, { CERTIFIED: 2, PROMOTION: 1, QUIT: 1, PROBATIONARY: 2, EXTENDED: 1, DISQUALIFIED: 1, FAILED: 1, MAYBE: 1 });
  assert.deepEqual(rec.tlmi_status_counts, { Certified: 2, Promoted: 1, Quit: 1, Probationary: 1, Extended: 1, Failed: 2 });
  assert.deepEqual(rec.failed_disqualified, { expected: 1, actual: 1, agree: true });
  assert.equal(rec.source_rows, 10);
});
