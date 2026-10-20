'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogle } = require('./fake-google');

function sheet(google) {
  const ss = google.addSpreadsheet('db1', 'db');
  return ss.insertSheet('t');
}

test('writes a yyyy-mm-dd string to a general-format cell and reads a Date', () => {
  const google = createGoogle();
  const sh = sheet(google);
  sh.getRange(1, 1).setValues([['2026-04-21']]);
  const v = sh.getRange(1, 1).getValues()[0][0];
  assert.equal(Object.prototype.toString.call(v), '[object Date]');
  assert.equal(sh.getRange(1, 1).getDisplayValues()[0][0], '2026-04-21');
  sh.getRange(2, 1).setValues([['00123']]);
  assert.equal(sh.getRange(2, 1).getValues()[0][0], 123);
});

test('keeps it a string when the column format is @', () => {
  const google = createGoogle();
  const sh = sheet(google);
  sh.getRange(1, 1, 2, 1).setNumberFormat('@');
  sh.getRange(1, 1, 2, 1).setValues([['2026-04-21'], ['00123']]);
  assert.deepEqual(sh.getRange(1, 1, 2, 1).getValues(), [['2026-04-21'], ['00123']]);
});

test('lock throws when held', () => {
  const google = createGoogle();
  const lock = google.globals.LockService.getScriptLock();
  google.lockHeld = true;
  assert.throws(() => lock.waitLock(1000), /Lock timeout/);
  google.lockHeld = false;
  lock.waitLock(1000);
  assert.equal(lock.hasLock(), true);
  assert.throws(() => google.globals.LockService.getScriptLock().waitLock(1000), /Lock timeout/);
  lock.releaseLock();
  assert.equal(lock.hasLock(), false);
});

test('cache entry expires after ttl', () => {
  const google = createGoogle();
  const cache = google.globals.CacheService.getScriptCache();
  cache.put('k', 'v', 60);
  assert.equal(cache.get('k'), 'v');
  google.clock.now += 59 * 1000;
  assert.equal(cache.get('k'), 'v');
  google.clock.now += 2 * 1000;
  assert.equal(cache.get('k'), null);
});

test('formatDate uses the time zone and the clock drives new Date()', () => {
  const google = createGoogle({ now: Date.UTC(2026, 9, 20, 18, 30, 0) });
  const d = new google.Date();
  assert.equal(google.globals.Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd'), '2026-10-21');
  assert.equal(google.globals.Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"), '2026-10-20T18:30:00Z');
});

test('hmac returns signed bytes like Apps Script', () => {
  const google = createGoogle();
  const sig = google.globals.Utilities.computeHmacSha256Signature('a', 'b');
  assert.equal(sig.length, 32);
  assert.ok(sig.every((b) => b >= -128 && b <= 127));
});

test('hmac refuses mixed argument types like Apps Script', () => {
  const google = createGoogle();
  const U = google.globals.Utilities;
  const bytes = U.newBlob('abc').getBytes();
  assert.throws(() => U.computeHmacSha256Signature(bytes, 'key'), /Byte\[\],String/);
  assert.throws(() => U.computeHmacSha256Signature('abc', bytes), /String,Byte\[\]/);
  assert.equal(U.computeHmacSha256Signature(bytes, U.newBlob('key').getBytes()).length, 32);
  assert.equal(U.computeHmacSha256Signature('abc', 'key').length, 32);
});
