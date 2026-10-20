// The ONLY file that calls SpreadsheetApp. One generic repository driven by Schema.
// Writes happen inside Repository.transact: the script lock is held, changes are buffered in a unit of work
// and written at the end (appends to one table are a single setValues). A throw before the end writes nothing.
const Repository = (function () {
  const COUNTERS = 'id_counters';

  function fail(msg) { return new AppError('SERVER', msg); }

  function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

  function openDb() {
    const id = Props.get('TLMI_DB_ID');
    if (!id) throw Errors.configMissing('TLMI_DB_ID');
    return SpreadsheetApp.openById(id);
  }

  function encode(def, col, v) {
    const type = Schema.columnType(def, col);
    if (v === null || v === undefined) return '';
    if (type === 'bool') return v === true;
    if (type === 'int' || type === 'number') return v;
    return String(v);
  }

  function decode(def, col, raw) {
    const type = Schema.columnType(def, col);
    if (type === 'bool') return raw === true || raw === 'TRUE' || raw === 'true';
    if (type === 'int' || type === 'number') {
      if (raw === '' || raw === null || raw === undefined) return null;
      return typeof raw === 'number' ? raw : Number(raw);
    }
    if (isDate(raw)) return type === 'timestamp' ? raw.toISOString() : Clock.dateText(raw);
    return raw === null || raw === undefined ? '' : String(raw);
  }

  function emptyValue(type) {
    if (type === 'int' || type === 'number') return null;
    if (type === 'bool') return false;
    return '';
  }

  function formatsFor(def, cols) {
    return cols.map((c) => {
      const t = Schema.columnType(def, c);
      return (t === 'int' || t === 'number' || t === 'bool') ? '0.######' : '@';
    });
  }

  function normKey(s) { return String(s).trim().replace(/\s+/g, ' ').toLowerCase(); }

  function sameValue(a, b) {
    return String(a === null || a === undefined ? '' : a) === String(b === null || b === undefined ? '' : b);
  }

  function readTable(ss, name) {
    const def = Schema.table(name);
    const cols = Schema.columns(name);
    const sheet = ss.getSheetByName(def.tab);
    if (!sheet) throw fail('Missing tab: ' + def.tab);
    const last = sheet.getLastRow();
    if (last < 1) throw fail('Missing header: ' + def.tab);
    const header = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
    for (let i = 0; i < cols.length; i++) {
      if (header[i] !== cols[i]) throw fail('Header mismatch in ' + def.tab + ' column ' + (i + 1));
    }
    const raw = last > 1 ? sheet.getRange(2, 1, last - 1, cols.length).getValues() : [];
    const state = { name: name, def: def, cols: cols, sheet: sheet, rows: [], byId: new Map(), nextRow: last + 1 };
    raw.forEach((r, i) => {
      if (r[0] === '' || r[0] === null) return;
      const obj = {};
      cols.forEach((c, j) => { obj[c] = decode(def, c, r[j]); });
      const entry = { obj: obj, rowIdx: i + 2, isNew: false, dirty: false };
      state.rows.push(entry);
      state.byId.set(obj.id, entry);
    });
    return state;
  }

  function clone(o) { return Object.assign({}, o); }

  function checkUnique(state, values, selfId, onlyChanged) {
    const errs = [];
    const def = state.def;
    const keys = Object.keys(def.fields);
    keys.forEach((f) => {
      const spec = def.fields[f];
      if (!spec.unique) return;
      if (onlyChanged && !(f in values) && !spec.unique.some((s) => s in values)) return;
      const self = selfId ? state.byId.get(selfId).obj : {};
      const val = f in values ? values[f] : self[f];
      if (val === null || val === undefined || String(val).trim() === '') return;
      const scopeVal = (s) => (s in values ? values[s] : self[s]);
      const dup = state.rows.some((e) => e.obj.id !== selfId
        && normKey(e.obj[f]) === normKey(val)
        && spec.unique.every((s) => normKey(e.obj[s]) === normKey(scopeVal(s))));
      if (dup) errs.push({ path: f, code: 'DUPLICATE', message: 'This value already exists.' });
    });
    if (errs.length) throw Errors.validation(errs);
  }

  class Uow {
    constructor(ss) { this.ss = ss; this.tables = new Map(); }

    _state(name) {
      let s = this.tables.get(name);
      if (!s) { s = readTable(this.ss, name); this.tables.set(name, s); }
      return s;
    }

    all(name) { return this._state(name).rows.map((e) => clone(e.obj)); }

    get(name, id) {
      const e = this._state(name).byId.get(id);
      return e ? clone(e.obj) : null;
    }

    // Next ID for a table. The counter row is written in the same commit as the row that uses it.
    nextId(name, year) {
      const def = Schema.table(name);
      const y = def.idYear ? (year || Number(Clock.today().slice(0, 4))) : 0;
      const key = def.idPrefix.replace(/-$/, '') + (def.idYear ? '-' + y : '');
      const state = this._state(COUNTERS);
      let entry = state.byId.get(key);
      let n;
      if (entry) {
        entry.obj.last_value += 1; entry.dirty = true; n = entry.obj.last_value;
      } else {
        const obj = { id: key, prefix: def.idPrefix, year: y, last_value: 1 };
        entry = { obj: obj, rowIdx: null, isNew: true, dirty: false };
        state.rows.push(entry); state.byId.set(key, entry); n = 1;
      }
      return Schema.formatId(name, n, y);
    }

    _add(name, values, actor) {
      const def = Schema.table(name);
      const state = this._state(name);
      const v = Validator.clean(Schema.inputDef(def), values, 'create');
      checkUnique(state, v, null, false);
      const now = (actor && actor.now) || Clock.iso();
      const who = (actor && actor.userId) || '';
      const obj = { id: this.nextId(name) };
      Object.keys(def.fields).forEach((f) => {
        obj[f] = v[f] !== undefined ? v[f] : emptyValue(def.fields[f].type);
      });
      if (def.profile === 'MUT') {
        Object.assign(obj, { created_at: now, created_by: who, updated_at: now, updated_by: who, is_active: true, row_version: 1 });
      } else if (def.profile === 'APP') {
        obj[def.stamp.at] = now; obj[def.stamp.by] = who;
      } else if (def.profile === 'VER') {
        obj.effective_from = v.effective_from; obj.supersedes_id = v.supersedes_id || '';
        obj.created_at = now; obj.created_by = who;
      }
      const entry = { obj: obj, rowIdx: null, isNew: true, dirty: false };
      state.rows.push(entry); state.byId.set(obj.id, entry);
      return clone(obj);
    }

    insert(name, values, actor) {
      const def = Schema.table(name);
      if (def.profile === 'SYS' || def.profile === 'APP') throw fail('insert() is not for ' + def.profile + ' tables: ' + name);
      return this._add(name, values, actor);
    }

    append(name, values, actor) {
      const def = Schema.table(name);
      if (def.profile !== 'APP') throw fail('append() is only for append-only tables: ' + name);
      return this._add(name, values, actor);
    }

    update(name, id, patch, opts) {
      const def = Schema.table(name);
      if (def.appendOnly) throw fail(name + ' is append-only');
      if (def.profile !== 'MUT') throw fail(name + ' is not mutable');
      const expected = opts && opts.expectedVersion;
      if (!Number.isInteger(expected)) {
        throw Errors.validation([{ path: 'row_version', code: 'REQUIRED', message: 'row_version is required.' }]);
      }
      const state = this._state(name);
      const entry = state.byId.get(id);
      if (!entry) throw Errors.notFound(name + ' ' + id + ' not found.');
      const row = entry.obj;
      if (row.row_version !== expected) {
        const u = row.updated_by ? this.get('users', row.updated_by) : null;
        throw Errors.conflict({ row_version: row.row_version, updated_by_name: u ? u.display_name : '', updated_at: row.updated_at });
      }
      const v = Validator.clean(def, patch, 'patch');
      const before = clone(row);
      const changed = [];
      Object.keys(v).forEach((f) => {
        const next = v[f] === null ? emptyValue(def.fields[f].type) : v[f];
        if (!sameValue(before[f], next)) changed.push(f);
      });
      // opts.isActive deactivates or reactivates; it is the only way to change is_active.
      if (typeof opts.isActive === 'boolean' && before.is_active !== opts.isActive) changed.push('is_active');
      if (changed.length === 0) return { before: before, after: clone(row), changed: [] };
      checkUnique(state, v, id, true);
      changed.forEach((f) => {
        if (f === 'is_active') row.is_active = opts.isActive;
        else row[f] = v[f] === null ? emptyValue(def.fields[f].type) : v[f];
      });
      row.row_version = before.row_version + 1;
      row.updated_at = (opts.actor && opts.actor.now) || Clock.iso();
      row.updated_by = (opts.actor && opts.actor.userId) || '';
      entry.dirty = true;
      return { before: before, after: clone(row), changed: changed };
    }

    // Apps Script has no transaction across ranges. The script lock plus a fixed write order is the mitigation:
    // counters first (an ID is never reused), then data tables, then record_history, and audit_log last, so a
    // failure part-way can leave a saved change without its audit row but never an audit row for a change that
    // was not saved. Appends to one table are one setValues; an edited row is one setValues each.
    commit() {
      const rank = (name) => (name === COUNTERS ? 0 : name === 'record_history' ? 2 : name === 'audit_log' ? 3 : 1);
      const order = Array.from(this.tables.keys()).sort((a, b) => rank(a) - rank(b));
      order.forEach((name) => {
        const state = this.tables.get(name);
        const fresh = state.rows.filter((e) => e.isNew);
        const edited = state.rows.filter((e) => !e.isNew && e.dirty);
        const ncols = state.cols.length;
        const fmts = formatsFor(state.def, state.cols);
        const line = (e) => state.cols.map((c) => encode(state.def, c, e.obj[c]));
        if (fresh.length) {
          const needed = state.nextRow + fresh.length - 1;
          if (needed > state.sheet.getMaxRows()) state.sheet.insertRowsAfter(state.sheet.getMaxRows(), needed - state.sheet.getMaxRows());
          const range = state.sheet.getRange(state.nextRow, 1, fresh.length, ncols);
          range.setNumberFormats(fresh.map(() => fmts));
          range.setValues(fresh.map(line));
        }
        edited.forEach((e) => {
          const range = state.sheet.getRange(e.rowIdx, 1, 1, ncols);
          range.setNumberFormats([fmts]);
          range.setValues([line(e)]);
        });
      });
    }
  }

  return {
    // Creates every missing tab with its header row. Never touches a tab that exists. Returns the names created.
    ensureTables() {
      const ss = openDb();
      const created = [];
      Schema.names().forEach((name) => {
        const def = Schema.table(name);
        if (ss.getSheetByName(def.tab)) return;
        const sheet = ss.insertSheet(def.tab);
        const cols = Schema.columns(name);
        const header = sheet.getRange(1, 1, 1, cols.length);
        header.setNumberFormat('@');
        header.setValues([cols]);
        sheet.setFrozenRows(1);
        created.push(name);
      });
      return created;
    },

    all(name) { return readTable(openDb(), name).rows.map((e) => clone(e.obj)); },

    get(name, id) {
      const e = readTable(openDb(), name).byId.get(id);
      return e ? clone(e.obj) : null;
    },

    // Takes the script lock (10 seconds, then BUSY), runs fn(uow), writes, releases.
    // opts.dryRun runs fn against the real data and writes nothing.
    transact(fn, opts) {
      return LockGuard.run(() => {
        const uow = new Uow(openDb());
        const result = fn(uow);
        if (!(opts && opts.dryRun)) uow.commit();
        return result;
      }, 10000);
    },

    // Reads a tab of another spreadsheet (the legacy copy, the review sheet) as display text, header row included.
    // A missing tab is NOT_FOUND, or null with opts.optional. No ID or link is ever put in an error message.
    readExternal(spreadsheetId, tabName, opts) {
      let ss;
      try { ss = SpreadsheetApp.openById(spreadsheetId); } catch (e) { throw new AppError('SERVER', 'A source spreadsheet could not be opened.'); }
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) {
        if (opts && opts.optional) return null;
        throw Errors.notFound('Source tab not found: ' + tabName);
      }
      const rows = sheet.getLastRow();
      const cols = sheet.getLastColumn();
      if (rows < 1 || cols < 1) return [];
      return sheet.getRange(1, 1, rows, cols).getDisplayValues();
    },

    // Replaces a tab of the review sheet: header row then rows, all written as text. Creates the tab if needed.
    // The whole tab is one setValues over the larger of the old and the new extent (old cells beyond the new rows
    // are written as empty text), and nothing is cleared first. A failed write therefore leaves the old tab as it was,
    // and no decision on it is lost.
    writeReview(spreadsheetId, tabName, header, rows) {
      let ss;
      try { ss = SpreadsheetApp.openById(spreadsheetId); } catch (e) { throw new AppError('SERVER', 'The review spreadsheet could not be opened.'); }
      const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
      const body = [header].concat(rows).map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
      const totalRows = Math.max(sheet.getLastRow(), body.length);
      const totalCols = Math.max(sheet.getLastColumn(), header.length);
      const grid = [];
      for (let i = 0; i < totalRows; i++) {
        const row = i < body.length ? body[i].slice() : [];
        while (row.length < totalCols) row.push('');
        grid.push(row);
      }
      if (totalRows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), totalRows - sheet.getMaxRows());
      if (totalCols > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), totalCols - sheet.getMaxColumns());
      const range = sheet.getRange(1, 1, totalRows, totalCols);
      range.setNumberFormat('@');
      range.setValues(grid);
      sheet.setFrozenRows(1);
    },
  };
})();
