'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupApi } = require('../helpers/env');

function set(env, token, key, value, supersedes, reason) {
  return env.call('settings.set', { setting_key: key, value, supersedes_id: supersedes, reason: reason === undefined ? 'test change' : reason }, token);
}

test('settings.set inserts version 2 and keeps version 1', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const v1 = set(env, t, 'CFG-041', '85', undefined, 'first value');
  assert.equal(v1.ok, true, JSON.stringify(v1));
  assert.equal(v1.data.version, 1);
  const v2 = set(env, t, 'CFG-041', '80', v1.data.id, 'lower the pass mark');
  assert.equal(v2.ok, true);
  assert.equal(v2.data.version, 2);
  assert.equal(v2.data.value, '80');
  const get = env.call('settings.get', { setting_key: 'CFG-041' }, t).data;
  assert.equal(get.value, '80');
  assert.deepEqual(get.versions.map((v) => [v.version, v.value]), [[1, '85'], [2, '80']]);
  const rows = env.plain(env.g('Repository').all('settings'));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].supersedes_id, rows[0].id);
  assert.equal(rows[1].effective_from, '2026-10-20');
  assert.equal(rows[1].created_by, env.users.admin.id);
  const list = env.call('settings.list', {}, t).data;
  assert.equal(list.length, 10);
  assert.equal(list.find((s) => s.setting_key === 'CFG-041').value, '80');
  assert.equal(list.find((s) => s.setting_key === 'CFG-040').value, null);
});

test('settings.set without reason is VALIDATION', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  assert.equal(set(env, t, 'CFG-041', '85', undefined, '').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-041', '85', undefined, '   ').error.code, 'VALIDATION');
  assert.equal(env.call('settings.set', { setting_key: 'CFG-041', value: '85' }, t).error.fields[0].path, 'reason');
  assert.equal(env.plain(env.g('Repository').all('settings')).length, 0);
});

test('weights not totalling 100 is VALIDATION', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  assert.equal(set(env, t, 'CFG-044', '30/40/20').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-044', '50/50').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-044', '30/40/x').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-045', '60/30').error.code, 'VALIDATION');
  const good = set(env, t, 'CFG-044', '30 / 40 / 30');
  assert.equal(good.ok, true);
  assert.equal(good.data.value, '30/40/30');
  assert.equal(set(env, t, 'CFG-045', '60/40').ok, true);
});

test('integer settings are range checked and unknown keys are refused', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  assert.equal(set(env, t, 'CFG-041', '0').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-041', '101').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-041', '8.5').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-001', '241').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-999', '3').error.fields[0].path, 'setting_key');
  assert.equal(env.call('settings.get', { setting_key: 'CFG-999' }, t).error.code, 'VALIDATION');
  // CFG-047 and TLMI-001 are defined, so Admin can set them (and they are range checked)
  assert.equal(set(env, t, 'CFG-047', '0').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-047', '11').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'CFG-047', '3').ok, true);
  assert.equal(set(env, t, 'TLMI-001', '101').error.code, 'VALIDATION');
  assert.equal(set(env, t, 'TLMI-001', '88').ok, true);
});

test('a stale supersedes_id is CONFLICT', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const v1 = set(env, t, 'CFG-041', '85').data;
  assert.equal(set(env, t, 'CFG-041', '84').error.code, 'CONFLICT');
  const v2 = set(env, t, 'CFG-041', '83', v1.id);
  assert.equal(v2.ok, true);
  const stale = set(env, t, 'CFG-041', '82', v1.id);
  assert.equal(stale.error.code, 'CONFLICT');
  assert.equal(stale.error.current.id, v2.data.id);
  assert.equal(stale.error.current.row_version, 2);
  assert.equal(set(env, t, 'CFG-040', '3', 'SET-0001').error.code, 'CONFLICT');
  assert.equal(env.call('settings.get', { setting_key: 'CFG-041' }, t).data.value, '83');
});

test('require CFG-047 is CONFIG_MISSING until it is set', () => {
  const env = setupApi();
  const S = env.g('SettingsService');
  assert.throws(() => S.require('CFG-047'), (e) => e.code === 'CONFIG_MISSING' && e.message.includes('CFG-047'));
  env.g('Repository').transact((uow) => uow.insert('settings', { setting_key: 'CFG-047', value: '2', value_type: 'int', version: 1, effective_from: '2026-10-01' }, env.actor));
  assert.equal(S.require('CFG-047'), 2);
});

test('require returns typed values', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  set(env, t, 'CFG-044', '30/40/30');
  set(env, t, 'CFG-041', '85');
  assert.deepEqual(env.plain(env.g('SettingsService').require('CFG-044')), [30, 40, 30]);
  assert.equal(env.g('SettingsService').require('CFG-041'), 85);
});

test('get on a date returns the version in force then', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  env.g('Repository').transact((uow) => {
    uow.insert('settings', { setting_key: 'CFG-041', value: '85', value_type: 'int', version: 1, effective_from: '2026-10-01' }, env.actor);
    uow.insert('settings', { setting_key: 'CFG-041', value: '80', value_type: 'int', version: 2, effective_from: '2026-10-25', supersedes_id: 'SET-0001' }, env.actor);
  });
  const on = (d) => env.call('settings.get', { setting_key: 'CFG-041', on_date: d }, t).data.value;
  assert.equal(on('2026-10-20'), '85');
  assert.equal(on('2026-10-25'), '80');
  assert.equal(on('2026-09-01'), null);
  assert.equal(env.call('settings.get', { setting_key: 'CFG-041' }, t).data.value, '85');
});

test('a change is audited with old value, new value and reason, and the cache is refreshed', () => {
  const env = setupApi();
  const t = env.signIn('admin');
  const user = env.signIn('officer');
  const v1 = set(env, t, 'CFG-001', '10', undefined, 'shorter sessions').data;
  const row = env.auditRows().find((r) => r.event === 'SETTING.CHANGED');
  assert.ok(row);
  assert.deepEqual(JSON.parse(row.detail), { setting_key: 'CFG-001', old_value: null, new_value: '10', effective_from: '2026-10-20', reason: 'shorter sessions' });
  set(env, t, 'CFG-001', '20', v1.id, 'longer again');
  const d = JSON.parse(env.auditRows().filter((r) => r.event === 'SETTING.CHANGED')[1].detail);
  assert.equal(d.old_value, '10');
  // the new idle time applies at once (the cached value was removed)
  env.minutes(15);
  assert.equal(env.call('auth.me', {}, user).ok, true);
  env.minutes(21);
  assert.equal(env.call('auth.me', {}, user).error.code, 'SESSION_EXPIRED');
});

test('who can read and write settings', () => {
  const env = setupApi();
  for (const [role, canRead] of [['officer', false], ['supervisor', false], ['manager', true], ['senior', true], ['admin', true]]) {
    const t = env.signIn(role);
    const read = env.call('settings.list', {}, t);
    assert.equal(read.ok, canRead, role + ' read');
    if (!canRead) assert.equal(read.error.code, 'FORBIDDEN', role);
    const write = set(env, t, 'CFG-042', '30');
    assert.equal(write.ok, role === 'admin', role + ' write');
    if (role !== 'admin') assert.equal(write.error.code, 'FORBIDDEN', role);
  }
});
