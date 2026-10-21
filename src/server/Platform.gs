// The only file that calls Utilities, CacheService, LockService and PropertiesService, and that uses new Date().
// Nothing here runs at load time except building the objects.

const ORG_TIME_ZONE = 'Asia/Manila';

const Clock = {
  now() { return new Date(); },
  iso() { return new Date().toISOString(); },
  // The ISO 8601 UTC timestamp of a time given in milliseconds.
  isoAt(ms) { return new Date(ms).toISOString(); },
  today() { return Utilities.formatDate(new Date(), ORG_TIME_ZONE, 'yyyy-MM-dd'); },
  // The organisation (Asia/Manila) date of an ISO 8601 UTC timestamp.
  dateOfIso(iso) { return Utilities.formatDate(new Date(iso), ORG_TIME_ZONE, 'yyyy-MM-dd'); },
  // A Date read from a cell, as yyyy-mm-dd in the organisation time zone.
  dateText(d) { return Utilities.formatDate(d, ORG_TIME_ZONE, 'yyyy-MM-dd'); },
  // Compare timestamps without touching Date elsewhere.
  parse(iso) { return new Date(iso).getTime(); },
  ms() { return new Date().getTime(); },
};

const Ids = {
  uuid() { return Utilities.getUuid(); },
  // A temporary password of 12 characters: no look-alike characters (no I, O, 0, 1, l), and always a letter and a digit.
  // Each character is chosen by rejection sampling from random bytes, so that none is favoured: a byte at or above the
  // largest multiple of the alphabet length is discarded. 12 characters from 57 are about 70 bits, which is enough for
  // a password that must be changed at first sign-in. The alphabet is three short constants joined at run time
  // (tools/build.js stops a quoted string of 33 or more letters and digits).
  tempPassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const alphabet = upper + lower + digits;
    const limit = 256 - (256 % alphabet.length);
    for (;;) {
      let out = '';
      while (out.length < 12) {
        // Version 4 UUID: hex positions 12 and 16 are fixed bits, the other 30 hex digits are random.
        const hex = Utilities.getUuid().replace(/-/g, '').split('').filter((c, i) => i !== 12 && i !== 16).join('');
        for (let i = 0; i + 1 < hex.length && out.length < 12; i += 2) {
          const b = parseInt(hex.substr(i, 2), 16);
          if (b < limit) out += alphabet.charAt(b % alphabet.length);
        }
      }
      if (/[A-Za-z]/.test(out) && /[0-9]/.test(out)) return out;
    }
  },
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
  // Apps Script has only the overloads (byte[], byte[]) and (String, String), so every call passes byte arrays.
  hash(secret, salt, pepper, iterations) {
    const n = iterations || Hasher.DEFAULT_ITERATIONS;
    const key = Utilities.newBlob(String(pepper || '') + ':' + salt).getBytes();
    let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(secret) + ':' + salt).getBytes(), key);
    for (let i = 1; i < n; i++) h = Utilities.computeHmacSha256Signature(h, key);
    return 'hmac-sha256$' + n + '$' + Hasher._hex(h);
  },
  verify(secret, salt, pepper, stored) {
    const m = /^hmac-sha256\$(\d+)\$([0-9a-f]{64})$/.exec(String(stored || ''));
    if (!m) return false;
    const again = Hasher.hash(secret, salt, pepper, Number(m[1]));
    return Hasher._equal(again, stored);
  },
  // True when the stored hash was made with another iteration count than the current one (TDMS AD-10: upgrade on sign-in).
  needsRehash(stored) {
    const m = /^hmac-sha256\$(\d+)\$/.exec(String(stored || ''));
    return !!m && Number(m[1]) !== Hasher.DEFAULT_ITERATIONS;
  },
  // Constant time for equal-length strings.
  _equal(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  },
};

// Every top-level function can be called from the browser with google.script.run, and the web app runs as the owner.
// Functions that are only for the owner in the script editor (Setup.gs) call EditorGuard.check() first. In the editor the
// effective and the active user are both the owner; a web app visitor who is not the owner has an empty or a different
// active user and is refused. It fails closed. The addresses are compared in memory and never logged or returned.
const EditorGuard = {
  check() {
    let effective = '';
    let active = '';
    try {
      effective = Session.getEffectiveUser().getEmail();
      active = Session.getActiveUser().getEmail();
    } catch (e) {
      effective = '';
      active = '';
    }
    if (!effective || !active || effective !== active) {
      throw new AppError('FORBIDDEN', 'This function can only be run by the owner in the script editor.');
    }
  },
};

const Html = {
  page(name) {
    return HtmlService.createHtmlOutputFromFile(name).setTitle('TLMI')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  },
};

// Server-side log only. Never returned to the browser.
const Log = {
  info(msg) { Logger.log(msg); },
  error(requestId, e) { Logger.log('[' + requestId + '] ' + (e && e.stack ? e.stack : String(e))); },
};
