'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDb } = require('../helpers/db');

test('setup is idempotent', () => {
  const env = setupDb({ tables: false });
  const first = env.plain(env.g('setup')());
  assert.equal(first.length, env.g('Schema').names().length);
  assert.ok(first.includes('import_batches'));
  assert.deepEqual(env.plain(env.g('setup')()), []);
  assert.ok(env.google.logs.some((l) => l.includes('created') && l.includes('brands')));
});

test('setup without TLMI_DB_ID says which property is missing', () => {
  const env = setupDb({ tables: false });
  env.g('Props').remove('TLMI_DB_ID');
  assert.throws(() => env.g('setup')(), (e) => e.code === 'CONFIG_MISSING' && e.message.includes('TLMI_DB_ID'));
});

test('initSecrets makes a pepper once and never logs it', () => {
  const env = setupDb({ tables: false });
  assert.equal(env.g('initSecrets')(), true);
  const pepper = env.g('Props').get('PEPPER');
  assert.match(pepper, /^[0-9a-f]{64}$/);
  assert.equal(env.g('initSecrets')(), false);
  assert.equal(env.g('Props').get('PEPPER'), pepper);
  assert.ok(!env.google.logs.join('\n').includes(pepper));
});

test('initAdminPin stores a hash and removes the plain property', () => {
  const env = setupDb({ tables: false });
  env.g('initSecrets')();
  env.g('Props').set('ADMIN_PIN_NEW', 'test-pin-12');
  env.g('Props').set('ADMIN_PIN_FAILS', JSON.stringify({ count: 3, pausedUntil: 0 }));
  env.g('initAdminPin')();
  const P = env.g('Props');
  assert.equal(P.get('ADMIN_PIN_NEW'), null);
  assert.match(P.get('ADMIN_PIN_HASH'), /^hmac-sha256\$\d+\$[0-9a-f]{64}$/);
  assert.ok(P.get('ADMIN_PIN_SALT').length >= 32);
  assert.equal(P.get('ADMIN_PIN_FAILS'), null, 'the failure counter is reset');
  assert.equal(env.g('Hasher').verify('test-pin-12', P.get('ADMIN_PIN_SALT'), P.get('PEPPER'), P.get('ADMIN_PIN_HASH')), true);
  assert.equal(env.g('Hasher').verify('test-pin-13', P.get('ADMIN_PIN_SALT'), P.get('PEPPER'), P.get('ADMIN_PIN_HASH')), false);
  assert.ok(!env.google.logs.join('\n').includes('test-pin-12'));
  assert.ok(!JSON.stringify(env.google.props).includes('test-pin-12'));
});

test('initAdminPin refuses a 5-character pin', () => {
  const env = setupDb({ tables: false });
  env.g('initSecrets')();
  env.g('Props').set('ADMIN_PIN_NEW', '12345');
  assert.throws(() => env.g('initAdminPin')(), /at least 6/);
  assert.equal(env.g('Props').get('ADMIN_PIN_HASH'), null);
  assert.equal(env.g('Props').get('ADMIN_PIN_NEW'), '12345', 'left in place so that it can be corrected');
  assert.ok(!env.google.logs.join('\n').includes('12345'));
});

test('initAdminPin needs the new pin and the pepper', () => {
  const env = setupDb({ tables: false });
  assert.throws(() => env.g('initAdminPin')(), /ADMIN_PIN_NEW/);
  env.g('Props').set('ADMIN_PIN_NEW', 'test-pin-12');
  assert.throws(() => env.g('initAdminPin')(), /initSecrets/);
  assert.equal(env.g('Props').get('ADMIN_PIN_HASH'), null);
});

test('checkConfig lists missing keys without values', () => {
  const env = setupDb({ tables: false });
  env.g('Props').set('ENV', 'DEV');
  env.g('Props').set('LEGACY_COPY_ID', 'a-legacy-value-that-must-not-be-logged');
  const res = env.plain(env.g('checkConfig')());
  assert.equal(res.ok, false);
  assert.deepEqual(res.missing.sort(), ['ADMIN_PIN_HASH', 'ADMIN_PIN_SALT', 'PEPPER', 'REVIEW_SHEET_ID']);
  const logs = env.google.logs.join('\n');
  assert.ok(logs.includes('REVIEW_SHEET_ID'));
  assert.ok(!logs.includes('a-legacy-value-that-must-not-be-logged'));
  assert.ok(!logs.includes('fake-db-id'));
  env.g('Props').set('REVIEW_SHEET_ID', 'x');
  env.g('initSecrets')();
  env.g('Props').set('ADMIN_PIN_NEW', 'test-pin-12');
  env.g('initAdminPin')();
  assert.deepEqual(env.plain(env.g('checkConfig')()), { ok: true, missing: [] });
});

test('measureHash returns two positive numbers', () => {
  const env = setupDb({ tables: false });
  const res = env.plain(env.g('measureHash')());
  assert.deepEqual(Object.keys(res).sort(), ['ms1000', 'ms10000']);
  assert.ok(res.ms1000 >= 0 && res.ms10000 >= 0);
  assert.equal(typeof res.ms1000, 'number');
  assert.ok(env.google.logs.some((l) => l.includes('1000') && l.includes('10000')));
});

test('measureHash uses the clock, so it reports what the clock says', () => {
  const env = setupDb({ tables: false });
  const U = env.google.globals.Utilities;
  const orig = U.computeHmacSha256Signature;
  let calls = 0;
  U.computeHmacSha256Signature = (...a) => { calls++; if (calls % 500 === 0) env.google.clock.now += 1; return orig(...a); };
  const res = env.plain(env.g('measureHash')());
  assert.equal(res.ms1000, 2);
  assert.equal(res.ms10000, 20);
});
