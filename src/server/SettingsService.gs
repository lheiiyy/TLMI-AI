// Versioned settings (spec sections 5, 7, 8). Task 6 part: reading. Task 7 adds the definitions and the methods.
const SettingsService = (function () {
  const CACHE_TTL = 60;

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

  return { versions: versions, inForce: inForce, intOr: intOr, CACHE_TTL: CACHE_TTL };
})();
