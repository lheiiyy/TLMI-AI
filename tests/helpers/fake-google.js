'use strict';
// Fake Google services for Node tests. Only what the server code uses.
const crypto = require('node:crypto');

function pad(n, w) { return String(n).padStart(w, '0'); }

function createGoogle(opts = {}) {
  const google = {
    sheets: new Map(), // id -> Spreadsheet
    props: {},
    cache: new Map(),
    clock: { now: opts.now !== undefined ? opts.now : Date.UTC(2026, 9, 20, 4, 0, 0) },
    lockHeld: false, // another execution holds the script lock
    lock: { held: false },
    idCounter: 0,
  };

  class FakeDate extends Date {
    constructor(...a) {
      if (a.length === 0) super(google.clock.now);
      else super(...a);
    }
    static now() { return google.clock.now; }
  }
  google.Date = FakeDate;

  const key = (r, c) => r + ',' + c;

  class Range {
    constructor(sheet, r, c, nr, nc) { this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    _each(fn) {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(i, j, this.r + i, this.c + j);
    }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push(this.sheet._get(this.r + i, this.c + j));
        out.push(row);
      }
      return out;
    }
    getDisplayValues() {
      return this.getValues().map((row) => row.map((v) => display(v)));
    }
    setValues(vals) {
      if (!Array.isArray(vals) || vals.length !== this.nr || vals.some((row) => row.length !== this.nc)) {
        throw new Error('The number of rows or columns in the data does not match the range');
      }
      if (this.r + this.nr - 1 > this.sheet.maxRows || this.c + this.nc - 1 > this.sheet.maxCols) {
        throw new Error('The coordinates of the range are outside the dimensions of the sheet');
      }
      this._each((i, j, r, c) => this.sheet._set(r, c, vals[i][j]));
      return this;
    }
    setNumberFormat(f) { this._each((i, j, r, c) => this.sheet.formats.set(key(r, c), f)); return this; }
    setNumberFormats(fs) { this._each((i, j, r, c) => this.sheet.formats.set(key(r, c), fs[i][j])); return this; }
    clearContent() { this._each((i, j, r, c) => this.sheet._put(r, c, '')); return this; }
  }

  function display(v) {
    if (v === '' || v === null || v === undefined) return '';
    if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString().slice(0, 10);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  class Sheet {
    constructor(ss, name) {
      this.ss = ss; this.name = name; this.cells = new Map(); this.formats = new Map();
      this.maxRows = 1000; this.maxCols = 26; this.frozen = 0;
    }
    getName() { return this.name; }
    _get(r, c) { const v = this.cells.get(key(r, c)); return v === undefined ? '' : v; }
    _put(r, c, v) { if (v === '') this.cells.delete(key(r, c)); else this.cells.set(key(r, c), v); }
    _set(r, c, v) {
      if (v === null || v === undefined) v = '';
      if (typeof v === 'string' && this.formats.get(key(r, c)) !== '@') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          const [y, m, d] = v.split('-').map(Number);
          v = new FakeDate(Date.UTC(y, m - 1, d));
        } else if (/^-?\d+(\.\d+)?$/.test(v)) {
          v = Number(v);
        }
      }
      this._put(r, c, v);
    }
    getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, Number(k.split(',')[0])); return m; }
    getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, Number(k.split(',')[1])); return m; }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    getRange(r, c, nr = 1, nc = 1) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('The coordinates or dimensions of the range are invalid');
      return new Range(this, r, c, nr, nc);
    }
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    insertRowsAfter(after, n) { this.maxRows += n; }
    deleteRows(start, n) {
      const next = new Map();
      for (const [k, v] of this.cells) {
        const [r, c] = k.split(',').map(Number);
        if (r < start) next.set(k, v); else if (r >= start + n) next.set(key(r - n, c), v);
      }
      this.cells = next;
    }
    setFrozenRows(n) { this.frozen = n; }
  }

  class Spreadsheet {
    constructor(id, name) { this.id = id; this.name = name; this.sheets = []; this.insertSheet('Sheet1'); }
    getId() { return this.id; }
    getName() { return this.name; }
    getSheets() { return this.sheets.slice(); }
    getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
    insertSheet(name) {
      if (this.getSheetByName(name)) throw new Error('A sheet with the name "' + name + '" already exists');
      const s = new Sheet(this, name); this.sheets.push(s); return s;
    }
  }

  google.addSpreadsheet = (id, name) => { const ss = new Spreadsheet(id, name || id); google.sheets.set(id, ss); return ss; };

  const SpreadsheetApp = {
    openById(id) {
      const ss = google.sheets.get(id);
      if (!ss) throw new Error('Unexpected error while getting the method or property openById on object SpreadsheetApp.');
      return ss;
    },
    create(name) { return google.addSpreadsheet('fake-' + (++google.idCounter), name); },
  };

  const LockService = {
    getScriptLock() {
      return {
        waitLock() {
          if (google.lockHeld || google.lock.held) throw new Error('Lock timeout: another process was holding the lock for too long.');
          google.lock.held = true;
        },
        tryLock() { if (google.lockHeld || google.lock.held) return false; google.lock.held = true; return true; },
        hasLock() { return google.lock.held; },
        releaseLock() { google.lock.held = false; },
      };
    },
  };

  const CacheService = {
    getScriptCache() {
      return {
        get(k) {
          const e = google.cache.get(k);
          if (!e) return null;
          if (e.expires <= google.clock.now) { google.cache.delete(k); return null; }
          return e.value;
        },
        put(k, value, ttl = 600) {
          google.cache.set(k, { value: String(value), expires: google.clock.now + Math.min(ttl, 21600) * 1000 });
        },
        remove(k) { google.cache.delete(k); },
        removeAll(ks) { ks.forEach((k) => google.cache.delete(k)); },
      };
    },
  };
  google.clearCache = () => google.cache.clear();

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(k) { return Object.prototype.hasOwnProperty.call(google.props, k) ? google.props[k] : null; },
        setProperty(k, v) { google.props[k] = String(v); return this; },
        deleteProperty(k) { delete google.props[k]; return this; },
        getProperties() { return Object.assign({}, google.props); },
        setProperties(o) { Object.keys(o).forEach((k) => { google.props[k] = String(o[k]); }); return this; },
      };
    },
  };

  function toBuf(x) {
    if (typeof x === 'string') return Buffer.from(x, 'utf8');
    return Buffer.from(Array.from(x).map((b) => b & 255));
  }
  function partsIn(date, tz) {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const o = {}; f.formatToParts(date).forEach((p) => { o[p.type] = p.value; });
    return o;
  }
  const Utilities = {
    getUuid() { return crypto.randomUUID(); },
    computeHmacSha256Signature(value, k) {
      const d = crypto.createHmac('sha256', toBuf(k)).update(toBuf(value)).digest();
      return Array.from(d).map((b) => (b > 127 ? b - 256 : b));
    },
    base64Encode(x) { return toBuf(x).toString('base64'); },
    formatDate(date, tz, fmt) {
      const p = partsIn(date, tz === 'UTC' ? 'UTC' : tz);
      return fmt.replace(/yyyy|MM|dd|HH|mm|ss|'[^']*'/g, (t) => {
        if (t[0] === "'") return t.slice(1, -1);
        return { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second }[t];
      });
    },
    newBlob(s) { return { getBytes: () => Array.from(Buffer.from(s, 'utf8')) }; },
  };

  const logs = [];
  const Logger = { log(...a) { logs.push(a.join(' ')); } };
  google.logs = logs;

  google.globals = { SpreadsheetApp, LockService, CacheService, PropertiesService, Utilities, Logger, Date: FakeDate };
  google.pad = pad;
  return google;
}

module.exports = { createGoogle };
