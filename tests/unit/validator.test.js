'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');

const DEF = {
  name: 'things',
  fields: {
    name: { type: 'text', required: true, max: 20 },
    note: { type: 'text' },
    kind: { type: 'text', enum: ['a', 'b'] },
    qty: { type: 'int' },
    ratio: { type: 'number' },
    flag: { type: 'bool' },
    on: { type: 'date' },
    at: { type: 'timestamp' },
    code: { type: 'text', immutable: true },
  },
};

function run(input, mode) {
  const { g, plain } = loadServer();
  try {
    return { ok: plain(g('Validator').clean(DEF, input, mode)) };
  } catch (e) {
    return { err: e, fields: plain(e.fields) };
  }
}

test('validator rejects an unknown field', () => {
  const r = run({ name: 'x', bogus: 1 }, 'create');
  assert.equal(r.err.code, 'VALIDATION');
  assert.deepEqual(r.fields.map((f) => [f.path, f.code]), [['bogus', 'UNKNOWN_FIELD']]);
});

test('validator rejects a 50001-character text', () => {
  const r = run({ name: 'x', note: 'a'.repeat(50001) }, 'create');
  assert.equal(r.fields[0].code, 'TOO_LONG');
  assert.ok(run({ name: 'x', note: 'a'.repeat(50000) }, 'create').ok);
});

test('validator rejects text over its own max', () => {
  assert.equal(run({ name: 'a'.repeat(21) }, 'create').fields[0].code, 'TOO_LONG');
});

test('validator rejects null on a required field', () => {
  assert.equal(run({ name: null }, 'create').fields[0].code, 'REQUIRED');
  assert.equal(run({ name: null }, 'patch').fields[0].code, 'REQUIRED');
  assert.equal(run({ name: '   ' }, 'create').fields[0].code, 'REQUIRED');
});

test('validator requires required fields on create but not on patch', () => {
  assert.equal(run({ note: 'x' }, 'create').fields[0].code, 'REQUIRED');
  assert.deepEqual(run({ note: 'x' }, 'patch').ok, { note: 'x' });
});

test('validator trims text and accepts a patch with fewer fields', () => {
  assert.deepEqual(run({ name: '  Ana  ', note: ' hi ' }, 'create').ok, { name: 'Ana', note: 'hi' });
  assert.deepEqual(run({ qty: 3 }, 'patch').ok, { qty: 3 });
});

test('validator null clears an optional field', () => {
  assert.deepEqual(run({ note: null }, 'patch').ok, { note: null });
});

test('validator checks types, enum and dates', () => {
  assert.equal(run({ name: 'x', qty: 1.5 }, 'create').fields[0].code, 'TYPE');
  assert.equal(run({ name: 'x', ratio: 'a' }, 'create').fields[0].code, 'TYPE');
  assert.equal(run({ name: 'x', flag: 'yes' }, 'create').fields[0].code, 'TYPE');
  assert.equal(run({ name: 'x', kind: 'z' }, 'create').fields[0].code, 'NOT_ALLOWED');
  assert.equal(run({ name: 'x', on: '2026-02-30' }, 'create').fields[0].code, 'TYPE');
  assert.equal(run({ name: 'x', on: '21/04/2026' }, 'create').fields[0].code, 'TYPE');
  assert.equal(run({ name: 'x', at: 'yesterday' }, 'create').fields[0].code, 'TYPE');
  assert.ok(run({ name: 'x', on: '2026-02-28', at: '2026-02-28T01:02:03.000Z', flag: true, qty: 2, ratio: 1.5, kind: 'a' }, 'create').ok);
});

test('validator refuses to change an immutable field in a patch', () => {
  assert.equal(run({ code: 'AP' }, 'patch').fields[0].code, 'IMMUTABLE');
  assert.ok(run({ name: 'x', code: 'AP' }, 'create').ok);
});

test('validator collects every problem and refuses a non-object', () => {
  const r = run({ name: null, qty: 'a', bogus: 1 }, 'create');
  assert.equal(r.fields.length, 3);
  assert.equal(run('text', 'create').err.code, 'VALIDATION');
  assert.equal(run([], 'create').err.code, 'VALIDATION');
});
