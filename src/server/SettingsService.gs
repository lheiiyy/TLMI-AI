// Versioned settings (spec sections 5, 7, 8). A change inserts a new version and keeps the old ones.
const SettingsService = (function () {
  const CACHE_TTL = 60;

  // Keys are the TDMS configuration IDs, and TLMI-001 (the TL course program pass mark; TDMS has no key for it). CFG-047
  // (extension limit) is defined so that Admin can set it, but it is not seeded: it stays unset until Admin decides, and
  // SettingsService.require('CFG-047') returns CONFIG_MISSING until then (RULE-104).
  const SETTING_DEFS = {
    'CFG-001': { label: 'Idle sign-out (minutes)', group: 'Sign-in', value_type: 'int', min: 1, max: 240 },
    'CFG-002': { label: 'Wrong passwords before a pause', group: 'Sign-in', value_type: 'int', min: 1, max: 20 },
    'CFG-003': { label: 'Pause length (minutes)', group: 'Sign-in', value_type: 'int', min: 1, max: 1440 },
    'CFG-040': { label: 'Probation period (months)', group: 'Team Leader', value_type: 'int', min: 1, max: 12 },
    'CFG-041': { label: 'Certification pass mark', group: 'Team Leader', value_type: 'int', min: 1, max: 100 },
    'CFG-042': { label: 'Extension length (days)', group: 'Team Leader', value_type: 'int', min: 1, max: 365 },
    'CFG-044': { label: 'Certification weights: checklist / exam / feedback', group: 'Team Leader', value_type: 'intset', parts: 3 },
    'CFG-045': { label: 'Feedback weights: kitchen / manager', group: 'Team Leader', value_type: 'intset', parts: 2 },
    'CFG-047': { label: 'Extension limit (number of extensions)', group: 'Team Leader', value_type: 'int', min: 1, max: 10 },
    'TLMI-001': { label: 'TL course program pass mark', group: 'Team Leader', value_type: 'int', min: 1, max: 100 },
  };

  function versions(key) {
    return Repository.all('settings').filter((r) => r.setting_key === key).sort((a, b) => a.version - b.version);
  }

  // The version in force on a date: the highest version whose effective_from is not after it.
  function inForce(key, onDate) {
    const d = onDate || Clock.today();
    const list = versions(key).filter((r) => r.effective_from <= d);
    return list.length ? list[list.length - 1] : null;
  }

  // An integer setting for today, from a short cache; the fallback when it is not set.
  function intOr(key, fallback) {
    const hit = CacheStore.get('cfg:' + key);
    if (hit) return hit.v;
    const row = inForce(key);
    const n = row && /^\d+$/.test(row.value) ? Number(row.value) : fallback;
    CacheStore.put('cfg:' + key, { v: n }, CACHE_TTL);
    return n;
  }

  function parsed(row) {
    if (row.value_type === 'int') return Number(row.value);
    if (row.value_type === 'intset') return row.value.split('/').map(Number);
    return row.value;
  }

  // The value in force, typed. Throws CONFIG_MISSING when the setting was never set.
  function require_(key, onDate) {
    const row = inForce(key, onDate);
    if (!row) throw Errors.configMissing(key);
    return parsed(row);
  }

  // Checks and normalises a new value for a defined key. Throws VALIDATION.
  function normalise(key, def, value) {
    const bad = (msg) => Errors.validation([{ path: 'value', code: 'RANGE', message: msg }]);
    const text = String(value).trim();
    if (def.value_type === 'int') {
      if (!/^\d+$/.test(text)) throw bad('A whole number is expected.');
      const n = Number(text);
      if (n < def.min || n > def.max) throw bad('Must be ' + def.min + ' to ' + def.max + '.');
      return String(n);
    }
    const parts = text.split('/').map((s) => s.trim());
    if (parts.length !== def.parts || !parts.every((s) => /^\d+$/.test(s))) throw bad(def.parts + ' whole numbers separated by / are expected.');
    const nums = parts.map(Number);
    if (nums.reduce((a, b) => a + b, 0) !== 100) throw bad('The weights must total 100.');
    return nums.join('/');
  }

  function item(key, row) {
    const def = SETTING_DEFS[key];
    return {
      setting_key: key, label: def.label, group: def.group, value_type: def.value_type,
      id: row ? row.id : null, value: row ? row.value : null, version: row ? row.version : null,
      effective_from: row ? row.effective_from : null, reason: row ? row.reason : null,
    };
  }

  function knownKey(key) {
    if (!SETTING_DEFS[key]) throw Errors.validation([{ path: 'setting_key', code: 'NOT_ALLOWED', message: 'Unknown setting.' }]);
  }

  function set(ctx, p) {
    knownKey(p.setting_key);
    const def = SETTING_DEFS[p.setting_key];
    const value = normalise(p.setting_key, def, p.value);
    return Repository.transact((uow) => {
      const all = uow.all('settings').filter((r) => r.setting_key === p.setting_key).sort((a, b) => a.version - b.version);
      const current = all.length ? all[all.length - 1] : null;
      const given = p.supersedes_id || '';
      if ((current ? current.id : '') !== given) {
        const who = current && current.created_by ? uow.get('users', current.created_by) : null;
        throw Errors.conflict({ id: current ? current.id : '', row_version: current ? current.version : 0,
          updated_by_name: who ? who.display_name : '', updated_at: current ? current.created_at : '' });
      }
      const today = Clock.today();
      const row = uow.insert('settings', {
        setting_key: p.setting_key, value: value, value_type: def.value_type, version: current ? current.version + 1 : 1,
        reason: p.reason, effective_from: today, supersedes_id: current ? current.id : '',
      }, { userId: ctx.userId, now: ctx.now });
      AuditService.event(uow, ctx, {
        event: 'SETTING.CHANGED', entity: 'settings', entityId: row.id,
        detail: { setting_key: p.setting_key, old_value: current ? current.value : null, new_value: value, effective_from: today, reason: p.reason },
      });
      CacheStore.remove('cfg:' + p.setting_key);
      return item(p.setting_key, row);
    });
  }

  function methods() {
    return {
      'settings.list': {
        kind: 'R', params: {},
        handler: () => Object.keys(SETTING_DEFS).map((k) => item(k, inForce(k))),
      },
      'settings.get': {
        kind: 'R',
        params: { setting_key: { type: 'text', required: true, max: 20 }, on_date: { type: 'date' } },
        handler: (ctx, p) => {
          knownKey(p.setting_key);
          return Object.assign(item(p.setting_key, inForce(p.setting_key, p.on_date)), {
            versions: versions(p.setting_key).map((r) => item(p.setting_key, r)),
          });
        },
      },
      'settings.set': {
        kind: 'W',
        params: {
          setting_key: { type: 'text', required: true, max: 20 },
          value: { type: 'text', required: true, max: 100 },
          supersedes_id: { type: 'text', max: 40 },
          reason: { type: 'text', required: true, max: 500 },
        },
        handler: set,
      },
    };
  }

  return {
    SETTING_DEFS: SETTING_DEFS, versions: versions, inForce: inForce, intOr: intOr, require: require_,
    methods: methods, CACHE_TTL: CACHE_TTL,
  };
})();
