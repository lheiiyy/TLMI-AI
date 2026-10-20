'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');
const { fillTab, readTab } = require('../helpers/sheets');

test('readExternal returns display text with the header row', () => {
  const env = setupDb();
  const ss = env.google.addSpreadsheet('ext-1', 'ext');
  fillTab(ss, 'DATA', [['a', 'b'], ['2026-04-21', '00123'], ['x']]);
  assert.deepEqual(env.plain(env.g('Repository').readExternal('ext-1', 'DATA')), [['a', 'b'], ['2026-04-21', '00123'], ['x', '']]);
});

test('readExternal: missing tab is NOT_FOUND or null when optional, and no id appears in errors', () => {
  const env = setupDb();
  env.google.addSpreadsheet('ext-secret-id', 'ext');
  const R = env.g('Repository');
  assert.throws(() => R.readExternal('ext-secret-id', 'NOPE'), (e) => e.code === 'NOT_FOUND' && e.message.includes('NOPE') && !e.message.includes('ext-secret-id'));
  assert.equal(R.readExternal('ext-secret-id', 'NOPE', { optional: true }), null);
  assert.throws(() => R.readExternal('unknown-id-123', 'X'), (e) => e.code === 'SERVER' && !e.message.includes('unknown-id-123'));
});

test('writeReview creates a tab, writes text, and replaces old content', () => {
  const env = setupDb();
  const ss = env.google.addSpreadsheet('rev-1', 'review');
  const R = env.g('Repository');
  R.writeReview('rev-1', 'bad_values', ['h1', 'h2'], [['2026-04-21', '00123'], ['a', 'b'], ['c', 'd']]);
  assert.deepEqual(readTab(ss, 'bad_values'), [['h1', 'h2'], ['2026-04-21', '00123'], ['a', 'b'], ['c', 'd']]);
  R.writeReview('rev-1', 'bad_values', ['h1', 'h2'], [['only', 'one']]);
  assert.deepEqual(readTab(ss, 'bad_values'), [['h1', 'h2'], ['only', 'one']]);
  R.writeReview('rev-1', 'bad_values', ['h1', 'h2'], []);
  assert.deepEqual(readTab(ss, 'bad_values'), [['h1', 'h2']]);
});

test('writeReview grows the sheet for many rows', () => {
  const env = setupDb();
  const ss = env.google.addSpreadsheet('rev-2', 'review');
  const rows = Array.from({ length: 1500 }, (_, i) => ['r' + i, String(i)]);
  env.g('Repository').writeReview('rev-2', 't', ['a', 'b'], rows);
  assert.equal(readTab(ss, 't').length, 1501);
  assert.equal(readTab(ss, 't')[1500][0], 'r1499');
});

test('a dry run reads the real data and writes nothing', () => {
  const env = setupDb();
  const R = env.g('Repository');
  const out = env.plain(R.transact((uow) => [uow.insert('regions', { name: 'NCR' }, env.actor).id, uow.all('regions').length], { dryRun: true }));
  assert.deepEqual(out, ['REG-0001', 1]);
  assert.equal(R.all('regions').length, 0);
  assert.equal(R.all('id_counters').length, 0);
  assert.equal(env.google.lock.held, false);
});
