'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');

const env = loadServer();
const R = env.g('ImportRules');
const plain = env.plain;
const TODAY = '2026-10-20';

test('normalizeName upper-cases, trims, collapses spaces, removes punctuation and keeps accents', () => {
  assert.equal(R.normalizeName('  doña   soledad.  '), 'DOÑA SOLEDAD');
  assert.equal(R.normalizeName('Ann-Marie O\'Neil, Jr.'), 'ANN MARIE ONEIL JR');
  assert.equal(R.normalizeName(''), '');
  assert.equal(R.normalizeName(null), '');
  assert.equal(R.normalizeName('FOOD PREP*'), 'FOOD PREP');
});

test('matchMaster exact ignores case and spaces but not tildes', () => {
  const masters = ['TEST STORE ONE', 'DOÑA TEST', 'SECOND STORE'];
  assert.deepEqual(plain(R.matchMaster('  test  store one ', masters)), { status: 'exact', match: 'TEST STORE ONE' });
  assert.deepEqual(plain(R.matchMaster('doña test', masters)), { status: 'exact', match: 'DOÑA TEST' });
  const nye = plain(R.matchMaster('DONA TEST', masters));
  assert.equal(nye.status, 'candidate');
  assert.deepEqual(nye.candidates, ['DOÑA TEST']);
});

test('matchMaster finds candidates by edit distance and by shared words, else none', () => {
  const masters = ['TEST STORE ONE', 'SECOND STORE', 'PROVINCIAL TEST'];
  assert.equal(plain(R.matchMaster('SECOND STOR', masters)).status, 'candidate');
  assert.deepEqual(plain(R.matchMaster('TEST STORE', masters)).candidates, ['TEST STORE ONE']);
  assert.deepEqual(plain(R.matchMaster('UNKNOWN PLACE', masters)), { status: 'none' });
  assert.deepEqual(plain(R.matchMaster('', masters)), { status: 'none' });
});

test('matchMaster uses an alias an officer has confirmed', () => {
  const r = plain(R.matchMaster('OLD NAME', ['NEW NAME'], { 'old name': 'NEW NAME' }));
  assert.deepEqual(r, { status: 'exact', match: 'NEW NAME', via: 'alias' });
});

test('matchMaster does not map an asterisk spelling automatically', () => {
  const r = plain(R.matchMaster('FOOD PREP*', ['Food Prep', 'Pizza Maker']));
  assert.equal(r.status, 'candidate');
  assert.deepEqual(r.candidates, ['Food Prep']);
  assert.equal(r.note, 'ASTERISK');
});

test('matchMaster with two equal masters is a candidate, never a pick', () => {
  const r = plain(R.matchMaster('twin', ['Twin', 'TWIN']));
  assert.equal(r.status, 'candidate');
});

test('matchOfficer maps a first name only when exactly one officer starts with it', () => {
  const users = ['Olivia Tester', 'Marco Sample', 'Marcus Other'];
  assert.deepEqual(plain(R.matchOfficer('olivia', users)), { status: 'exact', match: 'Olivia Tester' });
  assert.deepEqual(plain(R.matchOfficer('MARCO', users)), { status: 'exact', match: 'Marco Sample' });
  const two = plain(R.matchOfficer('MAR', ['Marco Sample', 'Marcus Other']));
  assert.equal(two.status, 'candidate');
  assert.deepEqual(two.candidates.sort(), ['Marcus Other', 'Marco Sample'].sort());
  const typo = plain(R.matchOfficer('OLIVA', users));
  assert.equal(typo.status, 'candidate');
  assert.deepEqual(typo.candidates, ['Olivia Tester']);
  assert.equal(plain(R.matchOfficer('ZZZ', users)).status, 'none');
  assert.equal(plain(R.matchOfficer('Olivia Tester', users)).status, 'exact');
});

test('looksLikeNote spots notes typed in an officer column', () => {
  for (const s of ['NO CERT', 'RESIGNED', 'GIO / 2ND EXTEND', 'JAMES 9/29/26 quit', 'N/A']) assert.equal(R.looksLikeNote(s), true, s);
  for (const s of ['OLIVIA', 'Marco Sample']) assert.equal(R.looksLikeNote(s), false, s);
});

test('parseDate 14 Nov 2025 is 2025-11-14', () => {
  assert.deepEqual(plain(R.parseDate('14 Nov 2025', TODAY)), { iso: '2025-11-14' });
  assert.deepEqual(plain(R.parseDate('5 aug 2026', TODAY)), { iso: '2026-08-05' });
  assert.deepEqual(plain(R.parseDate(' 1 March 2026 ', TODAY)), { iso: '2026-03-01' });
});

test('parseDate 25/02/2026 is 2026-02-25, with or without a time', () => {
  assert.deepEqual(plain(R.parseDate('25/02/2026', TODAY)), { iso: '2026-02-25' });
  assert.deepEqual(plain(R.parseDate('23/09/2026 08:00:00', TODAY)), { iso: '2026-09-23' });
  assert.deepEqual(plain(R.parseDate('2026-04-21', TODAY)), { iso: '2026-04-21' });
});

test('parseDate 30 Dec 1899 is SERIAL_1899', () => {
  assert.deepEqual(plain(R.parseDate('30 Dec 1899', TODAY)), { issue: 'SERIAL_1899' });
  assert.deepEqual(plain(R.parseDate('30/12/1899', TODAY)), { issue: 'SERIAL_1899' });
});

test('parseDate flags unreadable, impossible and future dates', () => {
  assert.deepEqual(plain(R.parseDate('', TODAY)), {});
  assert.deepEqual(plain(R.parseDate('   ', TODAY)), {});
  assert.deepEqual(plain(R.parseDate('yesterday', TODAY)), { issue: 'UNREADABLE' });
  assert.deepEqual(plain(R.parseDate('31/02/2026', TODAY)), { issue: 'UNREADABLE' });
  assert.deepEqual(plain(R.parseDate('12 Foo 2026', TODAY)), { issue: 'UNREADABLE' });
  assert.deepEqual(plain(R.parseDate('15 Dec 2026', TODAY)), { iso: '2026-12-15', issue: 'FUTURE' });
});

test('parseDate proposes a day and month swap for a future date', () => {
  // 08/12/2026 read day first is 8 December, in the future; read month first it is 12 August, in the past
  assert.deepEqual(plain(R.parseDate('08/12/2026', TODAY)), { iso: '2026-12-08', issue: 'FUTURE', proposed: '2026-08-12' });
  assert.deepEqual(plain(R.parseDate('25/12/2026', TODAY)), { iso: '2026-12-25', issue: 'FUTURE' });
});

test('parseGrade 9475% proposes 94.75', () => {
  assert.deepEqual(plain(R.parseGrade('9475%')), { issue: 'PERCENT_SCALED', proposed: 94.75 });
  assert.deepEqual(plain(R.parseGrade('95%')), { value: 95 });
  assert.deepEqual(plain(R.parseGrade('94.5 %')), { value: 94.5 });
  assert.deepEqual(plain(R.parseGrade('100%')), { value: 100 });
  assert.deepEqual(plain(R.parseGrade('0%')), { value: 0 });
  assert.deepEqual(plain(R.parseGrade('')), {});
});

test('parseGrade flags out of range, zero dates and text', () => {
  assert.deepEqual(plain(R.parseGrade('1000000%')), { issue: 'OUT_OF_RANGE' });
  assert.deepEqual(plain(R.parseGrade('-5%')), { issue: 'OUT_OF_RANGE' });
  assert.deepEqual(plain(R.parseGrade('30 Dec 1899')), { issue: 'SERIAL_1899' });
  assert.deepEqual(plain(R.parseGrade('n/a')), { issue: 'UNREADABLE' });
});

test('splitUniform 3 SMALL | 1 LARGE gives two items', () => {
  assert.deepEqual(plain(R.splitUniform('3 SMALL | 1 LARGE')), { items: [{ qty: 3, size: 'SMALL' }, { qty: 1, size: 'LARGE' }], issues: [] });
  assert.deepEqual(plain(R.splitUniform('2 MEDIUM')), { items: [{ qty: 2, size: 'MEDIUM' }], issues: [] });
  assert.deepEqual(plain(R.splitUniform('')), { items: [], issues: [] });
});

test('splitUniform reads DR number', () => {
  assert.deepEqual(plain(R.splitUniform('1 XLARGE (DR#700003248)')), { items: [{ qty: 1, size: 'XLARGE', drNo: '700003248' }], issues: [] });
  assert.deepEqual(plain(R.splitUniform('2 SMALL DR # 123 | 1 LARGE')).items, [{ qty: 2, size: 'SMALL', drNo: '123' }, { qty: 1, size: 'LARGE' }]);
});

test('splitUniform sends unreadable parts to issues', () => {
  const r = plain(R.splitUniform('3 SMALL | big shirt | 2 HUGE | 0 LARGE'));
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.issues.map((i) => [i.part, i.code]), [['big shirt', 'UNREADABLE'], ['2 HUGE', 'UNKNOWN_SIZE'], ['0 LARGE', 'BAD_QUANTITY']]);
});

test('mapStatus DISQUALIFIED is Failed with reason Disqualified', () => {
  assert.deepEqual(plain(R.mapStatus('DISQUALIFIED', '')), { status: 'Failed', closeReason: 'Disqualified' });
  assert.deepEqual(plain(R.mapStatus('promotion', '')), { status: 'Promoted' });
  assert.deepEqual(plain(R.mapStatus('CERTIFIED', '')), { status: 'Certified' });
  assert.deepEqual(plain(R.mapStatus(' Probationary ', '')), { status: 'Probationary' });
  for (const [legacy, want] of [['QUIT', 'Quit'], ['EXTENDED', 'Extended'], ['FAILED', 'Failed']]) assert.equal(R.mapStatus(legacy, '').status, want);
});

test('mapStatus reads report flags and appointment letter values from STATUS', () => {
  assert.deepEqual(plain(R.mapStatus('CERTIFIED', 'FOR REPORTING')), { status: 'Certified', flag: 'FOR REPORTING' });
  assert.deepEqual(plain(R.mapStatus('PROBATIONARY', 'NEW ENTRY')), { status: 'Probationary', flag: 'NEW ENTRY' });
  assert.deepEqual(plain(R.mapStatus('PROMOTION', 'ON-GOING PROMOTION')), { status: 'Promoted', appointment: 'ON-GOING PROMOTION' });
  assert.deepEqual(plain(R.mapStatus('CERTIFIED', 'signed')), { status: 'Certified', appointment: 'SIGNED' });
  assert.deepEqual(plain(R.mapStatus('QUIT', 'RESIGNED')), { status: 'Quit', flag: 'RESIGNED' });
});

test('mapStatus reports unknown results and stray STATUS values', () => {
  assert.deepEqual(plain(R.mapStatus('MAYBE', '')), { issue: 'UNKNOWN_STATUS' });
  assert.deepEqual(plain(R.mapStatus('', '')), { issue: 'BLANK_STATUS' });
  const r = plain(R.mapStatus('CERTIFIED', '42'));
  assert.equal(r.status, 'Certified');
  assert.equal(r.statusIssue, 'UNKNOWN_STATUS_VALUE');
});

test('certification before entry is flagged', () => {
  const rec = { entry_date: '14 Nov 2025', date_certified: '24/01/2025', full_name: 'A B', mother_store: 'S', result: 'CERTIFIED' };
  const issues = plain(R.checkRow(rec, TODAY));
  assert.deepEqual(issues, [{ field: 'date_certified', raw: '24/01/2025', code: 'CERT_BEFORE_ENTRY' }]);
});

test('checkRow flags blanks, future dates, zero dates and grade problems', () => {
  const rec = {
    entry_date: '', full_name: 'MARCO TESTER', mother_store: '', result: 'CERTIFIED',
    date_certified: '08/12/2026', cert_deadline: '15 Dec 2026', istv: '9475%', techval_fp: '30 Dec 1899', exam_fp: '95%', cert_grade: '1000000%',
  };
  const issues = plain(R.checkRow(rec, TODAY));
  const by = Object.fromEntries(issues.map((i) => [i.field, i]));
  assert.equal(by.entry_date.code, 'BLANK_REQUIRED');
  assert.equal(by.mother_store.code, 'BLANK_REQUIRED');
  assert.equal(by.date_certified.code, 'FUTURE');
  assert.equal(by.date_certified.proposed, '2026-08-12');
  assert.equal(by.cert_deadline, undefined, 'a deadline in the future is normal');
  assert.deepEqual([by.istv.code, by.istv.proposed], ['PERCENT_SCALED', 94.75]);
  assert.equal(by.techval_fp.code, 'SERIAL_1899');
  assert.equal(by.exam_fp, undefined);
  assert.equal(by.cert_grade.code, 'OUT_OF_RANGE');
  assert.equal(by.full_name, undefined);
});

test('checkRow gives no issue for a clean row', () => {
  const rec = { entry_date: '14 Nov 2025', full_name: 'A B', mother_store: 'S', result: 'CERTIFIED', date_certified: '20/02/2026', istv: '95%', cert_deadline: '23/12/2026 08:00:00' };
  assert.deepEqual(plain(R.checkRow(rec, TODAY)), []);
});

test('findDuplicates pairs a name with and without a middle name', () => {
  const pairs = plain(R.findDuplicates(['DARYL FAYE C. SIASAT', 'ANA CRUZ', 'DARYL FAYE SIASAT', 'ANA REYES', 'ana cruz']));
  assert.deepEqual(pairs, [{ a: 'DARYL FAYE C. SIASAT', b: 'DARYL FAYE SIASAT', reason: 'MIDDLE_PART_DIFFERS' }]);
  assert.deepEqual(plain(R.findDuplicates(['ANA CRUZ', 'ANA CRUZ'])), []);
  assert.deepEqual(plain(R.findDuplicates(['SOLO NAME'])), []);
});

test('hash is stable and differs for different text', () => {
  assert.equal(R.hash('abc'), R.hash('abc'));
  assert.notEqual(R.hash('abc'), R.hash('abd'));
  assert.match(R.hash('abc'), /^[0-9a-f]{8}$/);
});
