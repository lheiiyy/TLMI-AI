// Writes audit rows and record history; reads them for audit.list and history.get (spec section 9).
const AuditService = (function () {
  const SECRET_KEYS = ['pin', 'password', 'token', 'hr_employee_no'];
  // History shows that these changed, never their value: record_history is append-only and cannot be cleaned.
  const HIDDEN_VALUES = ['password_hash', 'salt'];
  const FILTERS = ['event', 'entity', 'user_id', 'from', 'to'];
  const MAX_PAGE = 50;

  function strip(x) {
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === 'object') {
      const out = {};
      Object.keys(x).forEach((k) => { if (SECRET_KEYS.indexOf(k.toLowerCase()) < 0) out[k] = strip(x[k]); });
      return out;
    }
    return x;
  }

  function text(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  function actorOf(ctx) { return { userId: ctx.userId || '', now: ctx.now }; }

  // Detail is JSON text. Text that parses is stripped like an object; text that does not parse is kept as {text}.
  // Too long a detail is cut, so that the audit row can never fail the business write it belongs to.
  function detailText(raw) {
    if (raw === undefined || raw === null) return '';
    let obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch (e) { obj = null; }
      if (obj === null || typeof obj !== 'object') obj = { text: raw };
    }
    const s = JSON.stringify(strip(obj));
    if (s.length <= Validator.DEFAULT_MAX) return s;
    // 8000 characters, each at most 6 after escaping, plus the marker, stay under the field maximum.
    return JSON.stringify({ truncated: true, text: s.slice(0, 8000) });
  }

  function event(uow, ctx, e) {
    const detail = detailText(e.detail);
    return uow.append('audit_log', {
      hr_employee_no: text(ctx.hrEmployeeNo),
      event: e.event,
      entity: text(e.entity),
      entity_id: text(e.entityId),
      result: e.result || 'OK',
      request_id: text(ctx.requestId),
      detail: detail,
    }, actorOf(ctx));
  }

  // One record_history row for each field that differs. Tracked: every field of the table, and is_active.
  function changes(uow, ctx, entity, entityId, before, after) {
    const def = Schema.table(entity);
    const tracked = Object.keys(def.fields).concat(def.profile === 'MUT' ? ['is_active'] : []);
    const rows = [];
    tracked.forEach((f) => {
      if (text(before[f]) === text(after[f])) return;
      const hide = HIDDEN_VALUES.indexOf(f) >= 0;
      rows.push(uow.append('record_history', {
        entity: entity, entity_id: entityId, field: f,
        old_value: hide ? '[changed]' : text(before[f]), new_value: hide ? '[changed]' : text(after[f]),
        request_id: text(ctx.requestId),
      }, actorOf(ctx)));
    });
    return rows;
  }

  // Own transaction. A failure to write the log must never break the call that is being logged.
  function logOutcome(ctx, fields) {
    try {
      Repository.transact((uow) => { event(uow, ctx, fields); });
    } catch (e) {
      // swallowed on purpose
    }
  }

  function list(params, viewerRole) {
    const p = params || {};
    const pageSize = p.page_size === undefined ? MAX_PAGE : p.page_size;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE) {
      throw Errors.validation([{ path: 'page_size', code: 'RANGE', message: 'page_size must be 1 to ' + MAX_PAGE + '.' }]);
    }
    const f = p.filters || {};
    const bad = Object.keys(f).filter((k) => FILTERS.indexOf(k) < 0);
    if (bad.length) throw Errors.validation(bad.map((k) => ({ path: 'filters.' + k, code: 'UNKNOWN_FIELD', message: 'Unknown filter.' })));
    let rows = Repository.all('audit_log').filter((r) =>
      (!f.event || r.event === f.event)
      && (!f.entity || r.entity === f.entity)
      && (!f.user_id || r.user_id === f.user_id)
      && (!f.from || Clock.dateOfIso(r.at) >= f.from)
      && (!f.to || Clock.dateOfIso(r.at) <= f.to));
    rows.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    if (p.cursor) rows = rows.filter((r) => r.id < p.cursor);
    const page = rows.slice(0, pageSize);
    const nextCursor = rows.length > pageSize ? page[page.length - 1].id : null;
    // HR employee numbers are shown to an Admin only (spec section 6.1 known limit).
    const out = viewerRole === 'Admin' ? page : page.map((r) => { const c = Object.assign({}, r); delete c.hr_employee_no; return c; });
    return { rows: out, nextCursor: nextCursor };
  }

  function history(entity, id) {
    return Repository.all('record_history')
      .filter((r) => r.entity === entity && r.entity_id === id)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  return { event: event, changes: changes, logOutcome: logOutcome, list: list, history: history };
})();
