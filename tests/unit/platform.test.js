'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');

test('hash verifies the right secret and rejects a wrong one', () => {
  const { g } = loadServer();
  const H = g('Hasher');
  const salt = H.newSalt();
  const stored = H.hash('secret-pin-1', salt, 'pepper', 1000);
  assert.match(stored, /^hmac-sha256\$1000\$[0-9a-f]{64}$/);
  assert.equal(H.verify('secret-pin-1', salt, 'pepper', stored), true);
  assert.equal(H.verify('secret-pin-2', salt, 'pepper', stored), false);
  assert.equal(H.verify('secret-pin-1', salt, 'other-pepper', stored), false);
  assert.equal(H.verify('secret-pin-1', salt, 'pepper', 'garbage'), false);
});

test('hash with the default iteration count reads the count from the stored value', () => {
  const { g } = loadServer();
  const H = g('Hasher');
  const salt = H.newSalt();
  const stored = H.hash('abcdef', salt, 'p');
  assert.ok(stored.startsWith('hmac-sha256$' + H.DEFAULT_ITERATIONS + '$'));
  const older = H.hash('abcdef', salt, 'p', 500);
  assert.equal(H.verify('abcdef', salt, 'p', older), true);
});

test('two salts differ', () => {
  const { g } = loadServer();
  assert.notEqual(g('Hasher').newSalt(), g('Hasher').newSalt());
});

test('LockGuard releases the lock when fn throws', () => {
  const { g, google } = loadServer();
  assert.throws(() => g('LockGuard').run(() => { throw new Error('boom'); }), /boom/);
  assert.equal(google.lock.held, false);
});

test('LockGuard throws BUSY when the lock is held', () => {
  const { g, google } = loadServer();
  google.lockHeld = true;
  assert.throws(() => g('LockGuard').run(() => 1), (e) => e.code === 'BUSY' && e.retry_after > 0);
});

test('LockGuard can be nested in one execution', () => {
  const { g, google } = loadServer();
  const out = g('LockGuard').run(() => g('LockGuard').run(() => 'inner'));
  assert.equal(out, 'inner');
  assert.equal(google.lock.held, false);
});

test('Clock gives ISO time and the Manila date', () => {
  const { g } = loadServer({ now: Date.UTC(2026, 9, 20, 18, 30, 0) });
  assert.equal(g('Clock').iso(), '2026-10-20T18:30:00.000Z');
  assert.equal(g('Clock').today(), '2026-10-21');
});

test('CacheStore round-trips objects, expires and removes', () => {
  const { g, google, plain } = loadServer();
  const C = g('CacheStore');
  C.put('k', { a: 1 }, 30);
  assert.deepEqual(plain(C.get('k')), { a: 1 });
  google.clock.now += 31000;
  assert.equal(C.get('k'), null);
  C.put('k2', { b: 2 }, 30);
  C.remove('k2');
  assert.equal(C.get('k2'), null);
});

test('Props get, set and remove', () => {
  const { g } = loadServer();
  const P = g('Props');
  assert.equal(P.get('X'), null);
  P.set('X', 'v');
  assert.equal(P.get('X'), 'v');
  P.remove('X');
  assert.equal(P.get('X'), null);
});

test('AppError carries code, message and extra fields', () => {
  const { g, plain } = loadServer();
  const e = g('Errors').conflict({ row_version: 3 });
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(plain(e.current), { row_version: 3 });
  assert.equal(g('Errors').busy(7).retry_after, 7);
  assert.equal(g('Errors').configMissing('CFG-047').code, 'CONFIG_MISSING');
  assert.ok(e instanceof g('AppError'));
});
