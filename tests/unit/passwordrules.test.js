'use strict';
// Part 2A, Task 2: password rule FX-002, temporary passwords, and the iteration check.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');

const load = () => loadServer();

test('7 characters is TOO_SHORT, 8 passes', () => {
  const { g, plain } = load();
  assert.deepEqual(plain(g('PasswordRules').check('abc1234')), { ok: false, code: 'TOO_SHORT' });
  assert.deepEqual(plain(g('PasswordRules').check('abc12345')), { ok: true });
  assert.equal(plain(g('PasswordRules').check('')).code, 'TOO_SHORT');
  assert.equal(plain(g('PasswordRules').check(undefined)).code, 'TOO_SHORT');
});

test('letters only is NEEDS_DIGIT, digits only is NEEDS_LETTER', () => {
  const { g, plain } = load();
  assert.equal(plain(g('PasswordRules').check('abcdefghij')).code, 'NEEDS_DIGIT');
  assert.equal(plain(g('PasswordRules').check('1234567890')).code, 'NEEDS_LETTER');
  assert.equal(plain(g('PasswordRules').check('abcd efgh!')).code, 'NEEDS_DIGIT');
});

test('the current password again is SAME_AS_CURRENT; another one passes', () => {
  const { g, plain } = load();
  assert.deepEqual(plain(g('PasswordRules').check('abc12345', 'abc12345')), { ok: false, code: 'SAME_AS_CURRENT' });
  assert.equal(plain(g('PasswordRules').check('abc12345', 'abc12346')).ok, true);
  assert.equal(plain(g('PasswordRules').check('abc12345', '')).ok, true);
});

test('error() returns a validation error for the field, with a message that does not repeat the password', () => {
  const { g } = load();
  const e = g('PasswordRules').error('new', 'short1', 'old-pass-1');
  assert.equal(e.code, 'VALIDATION');
  assert.equal(e.fields[0].path, 'new');
  assert.equal(e.fields[0].code, 'TOO_SHORT');
  assert.ok(!JSON.stringify(e.fields).includes('short1'));
  assert.equal(g('PasswordRules').error('new', 'long-enough-1', 'old'), null);
});

test('tempPassword passes the rule 1000 times, is 12 characters, and has no look-alike characters', () => {
  const { g } = load();
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const p = g('Ids').tempPassword();
    assert.equal(p.length, 12);
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{12}$/, p);
    assert.equal(g('PasswordRules').check(p).ok, true);
    seen.add(p);
  }
  assert.equal(seen.size, 1000, 'no repeats');
});

test('tempPassword rejects biased bytes: a byte at or above the largest multiple of 57 is discarded', () => {
  const { g, google } = load();
  // 256 - (256 % 57) = 228: bytes 228 to 255 must never be used. A uuid made of ff bytes yields nothing, so the
  // function asks for another one until it has 12 characters.
  const U = google.globals.Utilities;
  const real = U.getUuid;
  let calls = 0;
  U.getUuid = () => { calls++; return calls <= 3 ? 'ffffffff-ffff-4fff-bfff-ffffffffffff' : real(); };
  const p = g('Ids').tempPassword();
  U.getUuid = real;
  assert.equal(p.length, 12);
  assert.ok(calls > 3, 'the biased uuids were skipped');
  assert.equal(g('PasswordRules').check(p).ok, true);
});

test('needsRehash is true for another iteration count, false for the current one', () => {
  const { g } = load();
  const H = g('Hasher');
  const hex = '0'.repeat(64);
  assert.equal(H.needsRehash('hmac-sha256$' + (H.DEFAULT_ITERATIONS + 1) + '$' + hex), true);
  assert.equal(H.needsRehash('hmac-sha256$1$' + hex), true);
  assert.equal(H.needsRehash('hmac-sha256$' + H.DEFAULT_ITERATIONS + '$' + hex), false);
  assert.equal(H.needsRehash(''), false);
  assert.equal(H.needsRehash('not a hash'), false);
});
