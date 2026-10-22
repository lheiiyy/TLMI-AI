'use strict';
// Name proposals and decision words of the legacy import review (spec 10.2 and 10.4). Invented names only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');
const { setupReview } = require('../helpers/review-env');
const { fillTab, readTab } = require('../helpers/sheets');

const env = loadServer();
const R = env.g('ImportRules');
const parts = (s) => env.plain(R.proposeNameParts(s));

test('comma form "LAST, FIRST M."', () => {
  assert.deepEqual(parts('SAMPLE, ANA M.'), { last: 'SAMPLE', first: 'ANA', middle: 'M', suffix: '' });
  assert.deepEqual(parts('sample,  ana   maria'), { last: 'SAMPLE', first: 'ANA MARIA', middle: '', suffix: '' });
  assert.deepEqual(parts('SAMPLE JR., ANA'), { last: 'SAMPLE', first: 'ANA', middle: '', suffix: 'JR' });
});

test('"FIRST MIDDLE DELA CRUZ" keeps the particle in the last name', () => {
  assert.deepEqual(parts('JUAN PABLO DELA CRUZ'), { last: 'DELA CRUZ', first: 'JUAN PABLO', middle: '', suffix: '' });
  assert.deepEqual(parts('JUAN SAN MIGUEL'), { last: 'SAN MIGUEL', first: 'JUAN', middle: '', suffix: '' });
  assert.deepEqual(parts('JUAN DELOS SANTOS'), { last: 'DELOS SANTOS', first: 'JUAN', middle: '', suffix: '' });
});

test('"FIRST DE LA CRUZ JR." gives suffix JR', () => {
  assert.deepEqual(parts('JUAN DE LA CRUZ JR.'), { last: 'DE LA CRUZ', first: 'JUAN', middle: '', suffix: 'JR' });
  assert.deepEqual(parts('JUAN DE LOS REYES III'), { last: 'DE LOS REYES', first: 'JUAN', middle: '', suffix: 'III' });
  assert.deepEqual(parts('JUAN STA. MARIA'), { last: 'STA. MARIA', first: 'JUAN', middle: '', suffix: '' });
});

test('"FIRST JR C LAST" puts JR as suffix and C as middle', () => {
  assert.deepEqual(parts('LEO JR C TESTER'), { last: 'TESTER', first: 'LEO', middle: 'C', suffix: 'JR' });
  assert.deepEqual(parts('DARYL FAYE C. SAMPLE'), { last: 'SAMPLE', first: 'DARYL FAYE', middle: 'C', suffix: '' });
});

test('"MA. FIRST LAST" keeps MA. in the first name', () => {
  assert.deepEqual(parts('MA. ANA SAMPLE'), { last: 'SAMPLE', first: 'MA. ANA', middle: '', suffix: '' });
  assert.deepEqual(parts('  ana   sample '), { last: 'SAMPLE', first: 'ANA', middle: '', suffix: '' });
});

test('a one-word cell has a last name only, for an officer to correct', () => {
  assert.deepEqual(parts('SAMPLE'), { last: 'SAMPLE', first: '', middle: '', suffix: '' });
  assert.deepEqual(parts(''), { last: '', first: '', middle: '', suffix: '' });
});

test('parseNameParts reads four parts and rejects a missing last name', () => {
  assert.deepEqual(env.plain(R.parseNameParts('dela cruz | juan | c | jr')), { last: 'DELA CRUZ', first: 'JUAN', middle: 'C', suffix: 'JR' });
  assert.deepEqual(env.plain(R.parseNameParts('SAMPLE | ANA |  | ')), { last: 'SAMPLE', first: 'ANA', middle: '', suffix: '' });
  assert.equal(R.parseNameParts(' | ANA | | '), null);
  assert.equal(R.parseNameParts('SAMPLE |  | | '), null);
  assert.equal(R.parseNameParts('SAMPLE | ANA'), null);
  assert.equal(R.parseNameParts('SAMPLE | ANA | | | X'), null);
  assert.equal(R.parseNameParts(''), null);
});

test('the decision words are exactly the four of spec 10.2', () => {
  assert.deepEqual(env.plain(R.DECISIONS), ['confirm', 'different person', 'correct value', 'drop value']);
});

test('persons_proposed gets the four proposed name columns before the decision tail', () => {
  const e = setupReview();
  e.run();
  const head = e.tab('persons_proposed')[0];
  assert.deepEqual(head, ['proposed_name', 'spellings', 'enrollments', 'entry_dates', 'source_rows',
    'proposed_last_name', 'proposed_first_name', 'proposed_middle_name', 'proposed_suffix',
    'row_key', 'decision', 'corrected_value', 'decided_by', 'decided_on', 'needs_review']);
  const p = e.objects('persons_proposed').find((r) => r.proposed_name === 'DARYL FAYE C SAMPLE');
  assert.deepEqual([p.proposed_last_name, p.proposed_first_name, p.proposed_middle_name, p.proposed_suffix], ['SAMPLE', 'DARYL FAYE', 'C', '']);
});

test('adding the columns keeps every earlier decision', () => {
  const e = setupReview();
  e.run();
  // Rewrite the tab in the layout of the earlier review (no proposed name columns) with two decisions.
  const rows = readTab(e.review, 'persons_proposed');
  const drop = [5, 6, 7, 8];
  const old = rows.map((r) => r.filter((c, i) => drop.indexOf(i) < 0));
  const head = old[0];
  const dec = head.indexOf('decision');
  const marco = old.findIndex((r) => r[0] === 'MARCO TESTER');
  const rea = old.findIndex((r) => r[0] === 'REA SAMPLE');
  old[marco][dec] = 'confirm'; old[marco][dec + 2] = 'Ada Admin';
  old[rea][dec] = 'correct value'; old[rea][dec + 1] = 'SAMPLE | REA | | ';
  fillTab(e.review, 'persons_proposed', old);
  e.run();
  const now = e.objects('persons_proposed');
  const m = now.find((r) => r.proposed_name === 'MARCO TESTER');
  const r = now.find((x) => x.proposed_name === 'REA SAMPLE');
  assert.deepEqual([m.decision, m.decided_by, m.needs_review, m.proposed_last_name, m.proposed_first_name], ['confirm', 'Ada Admin', '', 'TESTER', 'MARCO']);
  assert.deepEqual([r.decision, r.corrected_value, r.needs_review], ['correct value', 'SAMPLE | REA | | ', '']);
  assert.equal(now.length, 9);
});
