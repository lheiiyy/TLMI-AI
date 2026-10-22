'use strict';
// The browser can call any top-level function with google.script.run, so every top-level function except doGet and
// tlmiApi must be refused unless the caller is the owner in the script editor (EditorGuard.check()).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupDb } = require('../helpers/db');
const { loadServer } = require('../helpers/loader');

const SERVER = path.join(__dirname, '..', '..', 'src', 'server');
const PUBLIC = ['doGet', 'tlmiApi'];

function topLevel(text) {
  const out = [];
  const re = /^(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{\s*([^\n;]*;?)/gm;
  let m;
  while ((m = re.exec(text))) out.push({ name: m[1], first: m[2].trim() });
  return out;
}

test('every top-level function is doGet, tlmiApi, or starts with EditorGuard.check()', () => {
  const found = [];
  for (const f of fs.readdirSync(SERVER).filter((x) => x.endsWith('.gs'))) {
    const text = fs.readFileSync(path.join(SERVER, f), 'utf8');
    topLevel(text).forEach((fn) => found.push(Object.assign({ file: f }, fn)));
    // a top-level var holding a function is exposed too; const and let are not, but none are used for entry points
    assert.ok(!/^var\s+\w+\s*=\s*(async\s*)?function/m.test(text), f + ' has a top-level var function');
  }
  const names = found.map((x) => x.name).sort();
  assert.ok(names.includes('doGet') && names.includes('tlmiApi'));
  for (const fn of ['setup', 'initSecrets', 'initAdminPassword', 'initFirstAdmin', 'checkConfig', 'measureHash']) assert.ok(names.includes(fn), fn);
  const bad = found.filter((x) => !PUBLIC.includes(x.name) && !/^EditorGuard\.check\(\);?$/.test(x.first));
  assert.deepEqual(bad.map((x) => x.file + ':' + x.name), [], 'these functions are callable from the browser and have no guard');
});

test('the checker itself catches a function without the guard', () => {
  assert.deepEqual(topLevel('function leak() {\n  return 1;\n}\n').map((x) => x.first), ['return 1;']);
  assert.deepEqual(topLevel('function safe() {\n  EditorGuard.check();\n  return 1;\n}\n').map((x) => x.first), ['EditorGuard.check();']);
});

test('EditorGuard passes in the editor: the active user is the owner', () => {
  const { g } = loadServer();
  assert.doesNotThrow(() => g('EditorGuard').check());
});

test('EditorGuard refuses a visitor, an unknown caller and a missing owner, without naming any address', () => {
  for (const [effective, active] of [['owner-account', 'visitor-account'], ['owner-account', ''], ['', ''], ['', 'visitor-account']]) {
    const { g, google } = loadServer();
    google.session.effective = effective;
    google.session.active = active;
    assert.throws(() => g('EditorGuard').check(), (e) => {
      assert.equal(e.code, 'FORBIDDEN');
      assert.ok(!e.message.includes('owner-account') && !e.message.includes('visitor-account'));
      return true;
    });
    assert.ok(!google.logs.join('\n').match(/owner-account|visitor-account/));
  }
});

const VISITOR = (env) => { env.google.session.active = 'visitor-account'; };
const UNKNOWN = (env) => { env.google.session.active = ''; };

for (const [label, make] of [['a visitor', VISITOR], ['an unknown caller', UNKNOWN]]) {
  test('setup is refused for ' + label + ' and creates nothing', () => {
    const env = setupDb({ tables: false });
    make(env);
    assert.throws(() => env.g('setup')(), (e) => e.code === 'FORBIDDEN');
    assert.equal(env.google.sheets.get('fake-db-id').getSheets().length, 1, 'only the default tab');
  });

  test('initSecrets is refused for ' + label + ' and makes no pepper', () => {
    const env = setupDb({ tables: false });
    make(env);
    assert.throws(() => env.g('initSecrets')(), (e) => e.code === 'FORBIDDEN');
    assert.equal(env.g('Props').get('PEPPER'), null);
  });

  test('initAdminPassword is refused for ' + label + ', changes no user and keeps its properties', () => {
    const env = setupDb();
    env.g('initSecrets')();
    env.g('Props').set('ADMIN_EMPLOYEE_NO', '3001');
    env.g('Props').set('ADMIN_TEMP_PASSWORD', 'temp-pass-12');
    make(env);
    assert.throws(() => env.g('initAdminPassword')(), (e) => e.code === 'FORBIDDEN');
    assert.equal(env.plain(env.g('Repository').all('users')).length, 0);
    assert.equal(env.g('Props').get('ADMIN_EMPLOYEE_NO'), '3001');
    assert.equal(env.g('Props').get('ADMIN_TEMP_PASSWORD'), 'temp-pass-12');
  });

  test('initFirstAdmin is refused for ' + label + ', creates no user and keeps its properties', () => {
    const env = setupDb();
    env.g('initSecrets')();
    env.g('Props').set('FIRST_ADMIN_NAME', 'Owen Owner');
    env.g('Props').set('FIRST_ADMIN_EMPLOYEE_NO', '3001');
    env.g('Props').set('FIRST_ADMIN_PASSWORD', 'temp-pass-12');
    make(env);
    assert.throws(() => env.g('initFirstAdmin')(), (e) => e.code === 'FORBIDDEN');
    assert.equal(env.plain(env.g('Repository').all('users')).length, 0);
    assert.equal(env.g('Props').get('FIRST_ADMIN_NAME'), 'Owen Owner');
    assert.equal(env.g('Props').get('FIRST_ADMIN_PASSWORD'), 'temp-pass-12');
  });

  test('checkConfig is refused for ' + label + ' and returns nothing', () => {
    const env = setupDb({ tables: false });
    make(env);
    let result;
    assert.throws(() => { result = env.g('checkConfig')(); }, (e) => e.code === 'FORBIDDEN');
    assert.equal(result, undefined);
    assert.ok(!env.google.logs.some((l) => l.includes('checkConfig')));
  });

  test('measureHash is refused for ' + label + ' and does not hash', () => {
    const env = setupDb({ tables: false });
    let hmacCalls = 0;
    const U = env.google.globals.Utilities;
    const orig = U.computeHmacSha256Signature;
    U.computeHmacSha256Signature = (...a) => { hmacCalls++; return orig(...a); };
    make(env);
    assert.throws(() => env.g('measureHash')(), (e) => e.code === 'FORBIDDEN');
    assert.equal(hmacCalls, 0);
  });
}

test('the editor case still works for all six functions', () => {
  const env = setupDb({ tables: false });
  env.g('setup')();
  env.g('initSecrets')();
  env.g('Props').set('FIRST_ADMIN_NAME', 'Owen Owner');
  env.g('Props').set('FIRST_ADMIN_EMPLOYEE_NO', '3001');
  env.g('Props').set('FIRST_ADMIN_PASSWORD', 'temp-pass-12');
  env.g('initFirstAdmin')();
  env.g('Props').set('ADMIN_EMPLOYEE_NO', '3001');
  env.g('Props').set('ADMIN_TEMP_PASSWORD', 'temp-pass-34');
  env.g('initAdminPassword')();
  assert.equal(env.plain(env.g('checkConfig')()).ok, false);
  assert.ok(env.plain(env.g('measureHash')()).ms1000 >= 0);
});

test('a browser call to the page entry points is unaffected by the guard', () => {
  const env = setupDb();
  env.google.session.active = '';
  assert.equal(env.g('doGet')().name, 'index');
  assert.equal(env.plain(env.g('tlmiApi')({ v: 1, method: 'system.ping', params: {} })).ok, true);
});

test('EditorGuard fails closed when Session cannot be read', () => {
  const { g, google } = loadServer();
  google.globals.Session.getActiveUser = () => { throw new Error('Authorization is required'); };
  assert.throws(() => g('EditorGuard').check(), (e) => e.code === 'FORBIDDEN');
  const again = loadServer();
  again.google.globals.Session.getEffectiveUser = () => { throw new Error('Authorization is required'); };
  assert.throws(() => again.g('EditorGuard').check(), (e) => e.code === 'FORBIDDEN');
});
