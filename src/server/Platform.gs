// The only file that calls Utilities, CacheService, LockService and PropertiesService, and that uses new Date().
// Nothing here runs at load time except building the objects.

const ORG_TIME_ZONE = 'Asia/Manila';

const Clock = {
  now() { return new Date(); },
  iso() { return new Date().toISOString(); },
  today() { return Utilities.formatDate(new Date(), ORG_TIME_ZONE, 'yyyy-MM-dd'); },
  // A Date read from a cell, as yyyy-mm-dd in the organisation time zone.
  dateText(d) { return Utilities.formatDate(d, ORG_TIME_ZONE, 'yyyy-MM-dd'); },
  // Compare timestamps without touching Date elsewhere.
  parse(iso) { return new Date(iso).getTime(); },
  ms() { return new Date().getTime(); },
};

const Ids = {
  uuid() { return Utilities.getUuid(); },
};

const Props = {
  get(key) { return PropertiesService.getScriptProperties().getProperty(key); },
  set(key, value) { PropertiesService.getScriptProperties().setProperty(key, String(value)); },
  remove(key) { PropertiesService.getScriptProperties().deleteProperty(key); },
};

const CacheStore = {
  get(key) {
    const raw = CacheService.getScriptCache().get(key);
    return raw === null ? null : JSON.parse(raw);
  },
  put(key, obj, ttlSec) { CacheService.getScriptCache().put(key, JSON.stringify(obj), ttlSec); },
  remove(key) { CacheService.getScriptCache().remove(key); },
};

const LockGuard = {
  _depth: 0,
  // Runs fn while holding the script lock. Nested calls in one execution reuse the lock.
  run(fn, waitMs) {
    if (LockGuard._depth > 0) return fn();
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(waitMs === undefined ? 10000 : waitMs);
    } catch (e) {
      throw Errors.busy(5);
    }
    LockGuard._depth = 1;
    try {
      return fn();
    } finally {
      LockGuard._depth = 0;
      lock.releaseLock();
    }
  },
};

const Hasher = {
  // Stored inside every hash, so a later change never breaks old hashes. Chosen by a measurement on TEST (plan Task 2).
  DEFAULT_ITERATIONS: 10000,
  newSalt() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); },
  _hex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
    return s;
  },
  // Iterated HMAC-SHA256 (TDMS AD-10): key = pepper + salt, message starts as the secret.
  hash(secret, salt, pepper, iterations) {
    const n = iterations || Hasher.DEFAULT_ITERATIONS;
    const key = String(pepper || '') + ':' + salt;
    let h = Utilities.computeHmacSha256Signature(String(secret) + ':' + salt, key);
    for (let i = 1; i < n; i++) h = Utilities.computeHmacSha256Signature(h, key);
    return 'hmac-sha256$' + n + '$' + Hasher._hex(h);
  },
  verify(secret, salt, pepper, stored) {
    const m = /^hmac-sha256\$(\d+)\$([0-9a-f]{64})$/.exec(String(stored || ''));
    if (!m) return false;
    const again = Hasher.hash(secret, salt, pepper, Number(m[1]));
    return Hasher._equal(again, stored);
  },
  // Constant time for equal-length strings.
  _equal(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  },
};
