// The Team Leader workflow (Phase 2 spec sections 6 and 7): enrollment, entry grades, certification, extension, closing,
// return to probation and promotion. Every write is one transaction under the script lock: the version check, the rule check
// (TlRules.decide), the rows, the status_history row on a status change, the record_history rows on a field change and one
// audit row with the spec's event code. Deadlines, averages, final grades and the pass mark used are computed here and are
// never taken from the caller. A correction is a new assessments row that supersedes the old one; nothing is overwritten.
const TlService = (function () {
  const DATA_VERSION = 'TL_DATA_VERSION';
  const LIST_TTL = 60;
  const MAX_PAGE = 50;
  const ACTIONS = ['recordEntryGrade', 'recordCertCheck', 'certify', 'extend', 'close', 'quit', 'returnToProbation', 'promote'];
  const EDITABLE = ['mother_location_id', 'support_location_id', 'station_id', 'batch_code', 'visit_report_url', 'remarks'];
  const NAMES = { checklist: 'Checklist', exam: 'Exam', kitchen: 'Kitchen feedback', manager: 'Manager feedback', course: 'TL course program' };

  const actorOf = (ctx) => ({ userId: ctx.userId, now: ctx.now });
  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');
  const key = (s) => tidy(s).toLowerCase();
  const yearOf = (iso) => Number(String(iso).slice(0, 4));
  const bad = (path, code, message) => Errors.validation([{ path: path, code: code, message: message }]);

  // ---- settings in force --------------------------------------------------------------------------------------------
  // The version in force on a date. Before the first version existed, the first version applies, so that an entry dated
  // before the settings were seeded can still be enrolled (noted in the pull request as a deviation to confirm).
  function settingRow(settingKey, onDate) {
    const row = SettingsService.inForce(settingKey, onDate) || SettingsService.versions(settingKey)[0];
    if (!row) throw Errors.configMissing(settingKey);
    return row;
  }
  function settingInt(settingKey, onDate) { return Number(settingRow(settingKey, onDate).value); }
  function settingSet(settingKey, onDate) { return settingRow(settingKey, onDate).value.split('/').map(Number); }
  function weightsAt(onDate) { return { cert: settingSet('CFG-044', onDate), feedback: settingSet('CFG-045', onDate) }; }
  function weightsVersion(onDate) {
    return ['CFG-041', 'CFG-044', 'CFG-045'].map((k) => k + '@v' + settingRow(k, onDate).version).join(';');
  }
  // TLMI-001 has no fallback: when no version is in force on the date, a recorded course grade is enough (spec 7.5).
  function coursePassMark(onDate) {
    const row = SettingsService.inForce('TLMI-001', onDate);
    return row ? Number(row.value) : null;
  }
  function extensionLimit() {
    const row = SettingsService.inForce('CFG-047');
    return row ? Number(row.value) : null;
  }

  function touch() { Props.set(DATA_VERSION, (Number(Props.get(DATA_VERSION)) || 0) + 1); }

  // ---- reading one enrollment ---------------------------------------------------------------------------------------
  // reader is the repository (outside a transaction) or the unit of work (inside one): both have all() and get().
  function load(reader, id) {
    const e = reader.get('tl_enrollments', id);
    if (!e) throw Errors.notFound();
    return {
      e: e,
      comps: reader.all('assessment_components'),
      rows: reader.all('assessments').filter((a) => a.subject_type === 'TL_ENROLLMENT' && a.subject_id === id),
      exts: reader.all('tl_extensions').filter((x) => x.tl_enrollment_id === id).sort((a, b) => a.extension_no - b.extension_no),
      officers: reader.all('tl_certifying_officers').filter((o) => o.tl_enrollment_id === id),
    };
  }

  function compNamed(comps, name) {
    const c = comps.find((x) => key(x.name) === key(name));
    if (!c) throw Errors.configMissing('assessment component ' + name);
    return c;
  }

  // The grades in force, the entry state, the course program grade and the certification attempts.
  function derive(snap) {
    const byId = {};
    snap.comps.forEach((c) => { byId[c.id] = c; });
    const force = TlRules.inForce(snap.rows);
    const requiredIds = snap.comps.filter((c) => c.stage === 'entry' && c.required && c.is_active).map((c) => c.id);
    const entryRows = force.filter((r) => byId[r.component_id] && byId[r.component_id].stage === 'entry');
    const entry = TlRules.entryState(requiredIds, entryRows);
    const courseRows = force.filter((r) => byId[r.component_id] && key(byId[r.component_id].name) === key(NAMES.course));
    const course = courseRows.length ? courseRows.slice().sort((a, b) => b.retake_no - a.retake_no || (a.id < b.id ? 1 : -1))[0] : null;
    const certRows = force.filter((r) => byId[r.component_id] && byId[r.component_id].stage === 'certification' && key(byId[r.component_id].name) !== key(NAMES.course));
    const nos = Array.from(new Set(snap.rows.filter((r) => byId[r.component_id] && byId[r.component_id].stage === 'certification' && r.retake_no >= 1).map((r) => r.retake_no)));
    nos.sort((a, b) => a - b);
    const attempts = nos.map((no) => {
      const mine = certRows.filter((r) => r.retake_no === no);
      const scores = {};
      Object.keys(NAMES).forEach((k) => {
        if (k === 'course') return;
        const row = mine.find((r) => key(byId[r.component_id].name) === key(NAMES[k]));
        if (row) scores[k] = row.score;
      });
      const date = mine.reduce((m, r) => (r.assessed_on > m ? r.assessed_on : m), '');
      return {
        retake_no: no, assessed_on: date, scores: scores, rows: mine,
        officers: snap.officers.filter((o) => o.retake_no === no).map((o) => o.user_id),
        corrections: snap.rows.filter((r) => r.retake_no === no && r.supersedes_id).length,
      };
    });
    return { byId: byId, force: force, entry: entry, entryRows: entryRows, course: course, attempts: attempts, latest: attempts.length ? attempts[attempts.length - 1] : null };
  }

  function finalOf(attempt) {
    if (attempt.scores.checklist === undefined || attempt.scores.exam === undefined) return null;
    if (attempt.scores.kitchen === undefined && attempt.scores.manager === undefined) return null;
    return TlRules.finalGrade(attempt.scores, weightsAt(attempt.assessed_on));
  }

  // strict: a missing setting is an error (an action); otherwise it is only unknown (a read).
  function factsOf(snap, d, strict) {
    const date = d.latest ? d.latest.assessed_on : Clock.today();
    let passMark = null;
    try { passMark = settingInt('CFG-041', date); } catch (e) { if (strict) throw e; }
    return {
      entryComplete: d.entry.complete,
      finalGrade: snap.e.final_grade === null ? null : snap.e.final_grade,
      passMark: passMark,
      extensionsUsed: snap.exts.length,
      extensionLimit: extensionLimit(),
      courseGrade: d.course ? d.course.score : null,
      coursePassMark: coursePassMark(date),
    };
  }

  function refuse(dec) {
    if (dec.ok) return;
    if (dec.code === 'FORBIDDEN') throw Errors.forbidden();
    if (dec.code === 'CONFIG_MISSING') throw Errors.configMissing(dec.key);
    throw Errors.blocked(dec.rule_id, dec.message);
  }

  function nameOf(reader, id) {
    const u = reader.get('users', id);
    return u ? u.display_name : '';
  }

  // The full read model of one enrollment (tl.get).
  function view(id, role) {
    const snap = load(Repository, id);
    const d = derive(snap);
    const e = snap.e;
    const person = Repository.get('persons', e.person_id);
    const today = Clock.today();
    const facts = factsOf(snap, d, false);
    const store = (lid) => { const l = lid ? Repository.get('locations', lid) : null; return l ? l.name : ''; };
    const station = e.station_id ? Repository.get('stations', e.station_id) : null;
    const comp = (cid) => (d.byId[cid] ? d.byId[cid].name : '');
    const users = {};
    const uname = (uid) => { if (!(uid in users)) users[uid] = nameOf(Repository, uid); return users[uid]; };
    const gradeView = (r) => ({
      id: r.id, component_id: r.component_id, component: comp(r.component_id), score: r.score, assessed_on: r.assessed_on,
      assessed_by: r.assessed_by, assessed_by_name: r.assessed_by ? uname(r.assessed_by) : '', retake_no: r.retake_no,
    });
    return {
      enrollment: e,
      person: Object.assign({}, person, { name: PersonService.displayName(person) }),
      aliases: Repository.all('person_aliases').filter((a) => a.person_id === person.id),
      store: store(e.mother_location_id),
      support_store: store(e.support_location_id),
      station: station ? station.name : '',
      overdue: TlRules.overdue(e.status, e.deadline, today),
      open: TlRules.OPEN.indexOf(e.status) >= 0,
      entry: {
        required: snap.comps.filter((c) => c.stage === 'entry' && c.required && c.is_active).map((c) => ({ id: c.id, name: c.name })),
        grades: d.entryRows.map(gradeView), missing: d.entry.missing, complete: d.entry.complete, average: d.entry.average,
      },
      course_program: d.course ? gradeView(d.course) : null,
      attempts: d.attempts.map((a) => ({
        retake_no: a.retake_no, assessed_on: a.assessed_on, scores: a.scores, final_grade: (function () { try { return finalOf(a); } catch (x) { return null; } })(),
        officers: a.officers.map((u) => ({ user_id: u, name: uname(u) })), corrections: a.corrections,
        visit_report_url: a === d.latest ? e.visit_report_url : '',
      })),
      extensions: snap.exts,
      pass_mark: facts.passMark,
      course_pass_mark: facts.coursePassMark,
      extension_limit: facts.extensionLimit,
      allowed_actions: ACTIONS.filter((a) => TlRules.decide(a, e.status, role, facts).ok),
    };
  }

  // ---- writing ------------------------------------------------------------------------------------------------------
  // Runs fn in one transaction after the row_version check. The enrollment is read again inside the lock.
  function act(ctx, p, fn) {
    Repository.transact((uow) => {
      const e0 = uow.get('tl_enrollments', p.id);
      if (!e0) throw Errors.notFound();
      uow.update('tl_enrollments', p.id, {}, { expectedVersion: p.row_version, actor: actorOf(ctx) });
      fn(uow, e0, Clock.today());
    });
    touch();
    return view(p.id, ctx.role);
  }

  function statusChange(uow, ctx, enrollment, toStatus, effectiveDate, remark) {
    return uow.append('status_history', {
      entity: 'tl_enrollments', entity_id: enrollment.id, from_status: enrollment.status || '', to_status: toStatus,
      effective_date: effectiveDate, remark: remark || '', request_id: ctx.requestId || '',
    }, actorOf(ctx));
  }

  // Updates the enrollment and writes its record_history rows. Returns the update result.
  function save(uow, ctx, e0, patch) {
    const res = uow.update('tl_enrollments', e0.id, patch, { expectedVersion: e0.row_version, actor: actorOf(ctx) });
    AuditService.changes(uow, ctx, 'tl_enrollments', e0.id, res.before, res.after);
    return res;
  }

  function audit(uow, ctx, event, id, detail) {
    AuditService.event(uow, ctx, { event: event, entity: 'tl_enrollments', entityId: id, detail: detail });
  }

  function checkStore(uow, field, id) {
    const l = uow.get('locations', id);
    if (!l || !l.is_active || l.location_type !== 'Store') throw bad(field, 'LINK', 'Not an active store.');
    return l;
  }
  function checkStation(uow, field, id, store) {
    const s = uow.get('stations', id);
    if (!s || !s.is_active || s.brand_id !== store.brand_id) throw bad(field, 'LINK', 'Not an active station of the store\'s brand.');
    return s;
  }
  function checkScore(path, v) {
    if (TlRules.round2(v) !== v) throw bad(path, 'RANGE', 'At most 2 decimals.');
  }
  function checkDate(uow, e, onDate, path) {
    if (onDate < e.entry_date || onDate > Clock.today()) throw bad(path, 'RANGE', 'The date must be from the entry date to today.');
  }
  function hasOpen(uow, personId) {
    return uow.all('tl_enrollments').some((x) => x.person_id === personId && TlRules.OPEN.indexOf(x.status) >= 0);
  }

  function enroll(ctx, p) {
    const today = Clock.today();
    if (p.entry_date > today) throw bad('entry_date', 'RANGE', 'The entry date cannot be in the future.');
    if ((p.person_id && p.person) || (!p.person_id && !p.person)) throw bad('person', 'REQUIRED', 'Give person_id or person, not both.');
    const out = Repository.transact((uow) => {
      const store = checkStore(uow, 'mother_location_id', p.mother_location_id);
      if (p.support_location_id) checkStore(uow, 'support_location_id', p.support_location_id);
      checkStation(uow, 'station_id', p.station_id, store);
      let person;
      let created = false;
      if (p.person_id) {
        person = uow.get('persons', p.person_id);
        if (!person) throw bad('person_id', 'LINK', 'The person does not exist.');
        if (hasOpen(uow, person.id)) throw Errors.blocked('RULE-100', 'This person already has an open Team Leader record.');
      } else {
        const np = p.person;
        if (!tidy(np.last_name)) throw bad('person.last_name', 'REQUIRED', 'A value is required.');
        if (!tidy(np.first_name)) throw bad('person.first_name', 'REQUIRED', 'A value is required.');
        const no = tidy(np.hr_employee_no);
        if (no && (uow.all('persons').some((x) => x.hr_employee_no === no)
          || uow.all('person_aliases').some((a) => a.alias_type === 'HR_NO' && a.value === no))) {
          throw bad('person.hr_employee_no', 'DUPLICATE', 'A person with this HR employee number already exists.');
        }
        const cands = PersonService.candidates(uow.all('persons'), uow.all('person_aliases'), np);
        if (cands.length && p.confirm !== true) {
          return {
            requires_confirm: true,
            warnings: [{ code: 'POSSIBLE_DUPLICATE', message: 'A similar person already exists. Confirm that this is a different person.', candidates: cands }],
          };
        }
        person = PersonService.create(uow, ctx, np);
        created = true;
      }
      const months = settingInt('CFG-040', p.entry_date);
      const fields = {
        person_id: person.id, mother_location_id: p.mother_location_id, station_id: p.station_id, batch_code: p.batch_code,
        entry_date: p.entry_date, deadline: TlRules.deadline(p.entry_date, months), status: 'Entry', remarks: p.remarks,
      };
      if (p.support_location_id) fields.support_location_id = p.support_location_id;
      Object.keys(fields).forEach((k) => { if (fields[k] === undefined) delete fields[k]; });
      const row = uow.insert('tl_enrollments', fields, actorOf(ctx), yearOf(p.entry_date));
      statusChange(uow, ctx, { id: row.id, status: '' }, 'Entry', p.entry_date, '');
      audit(uow, ctx, 'TL.ENROLLED', row.id, { person_id: person.id, person_created: created, entry_date: p.entry_date, deadline: row.deadline });
      return { id: row.id };
    });
    if (out.requires_confirm) return out;
    touch();
    return view(out.id, ctx.role);
  }

  function update(ctx, p) {
    const errs = [];
    Object.keys(p.patch).forEach((k) => {
      if (EDITABLE.indexOf(k) >= 0) return;
      if (['entry_date', 'deadline', 'status', 'person_id'].indexOf(k) >= 0) errs.push({ path: 'patch.' + k, code: 'IMMUTABLE', message: 'This field cannot be changed here.' });
      else errs.push({ path: 'patch.' + k, code: 'UNKNOWN_FIELD', message: 'Unknown field.' });
    });
    if (errs.length) throw Errors.validation(errs);
    return act(ctx, p, (uow, e0) => {
      const merged = Object.assign({}, e0, p.patch);
      if ('mother_location_id' in p.patch || 'station_id' in p.patch) {
        const store = checkStore(uow, 'patch.mother_location_id', merged.mother_location_id);
        if (merged.station_id) checkStation(uow, 'patch.station_id', merged.station_id, store);
      }
      if (p.patch.support_location_id) checkStore(uow, 'patch.support_location_id', p.patch.support_location_id);
      const res = save(uow, ctx, e0, p.patch);
      if (res.changed.length) audit(uow, ctx, 'TL.UPDATED', e0.id, { changed: res.changed });
    });
  }

  function recordEntryGrade(ctx, p) {
    return act(ctx, p, (uow, e0, today) => {
      refuse(TlRules.decide('recordEntryGrade', e0.status, ctx.role, {}));
      const comp = uow.get('assessment_components', p.component_id);
      if (!comp || !comp.is_active || comp.stage !== 'entry') throw bad('component_id', 'LINK', 'Not an active entry component.');
      checkScore('score', p.score);
      checkDate(uow, e0, p.assessed_on, 'assessed_on');
      const snap = load(uow, e0.id);
      const d = derive(snap);
      const current = d.entryRows.find((r) => r.component_id === comp.id);
      const row = {
        subject_type: 'TL_ENROLLMENT', subject_id: e0.id, component_id: comp.id, score: p.score, assessed_on: p.assessed_on,
        assessed_by: ctx.userId, retake_no: 0,
      };
      if (current) {
        if (!tidy(p.correction_reason)) throw bad('correction_reason', 'REQUIRED', 'A reason is required to correct a grade.');
        row.supersedes_id = current.id;
        row.correction_reason = tidy(p.correction_reason);
      }
      const made = uow.append('assessments', row, actorOf(ctx), yearOf(p.assessed_on));
      const after = derive(load(uow, e0.id));
      let moved = false;
      if (e0.status === 'Entry' && after.entry.complete) {
        save(uow, ctx, e0, { status: 'Probationary' });
        statusChange(uow, ctx, e0, 'Probationary', p.assessed_on, 'All required entry grades recorded');
        moved = true;
      }
      audit(uow, ctx, 'TL.ENTRY_GRADE_RECORDED', e0.id, {
        assessment_id: made.id, component_id: comp.id, supersedes_id: current ? current.id : null, moved_to_probationary: moved,
      });
    });
  }

  // ---- reads --------------------------------------------------------------------------------------------------------
  function baseRows() {
    const cacheKey = 'tl:list:' + (Props.get(DATA_VERSION) || '0');
    const hit = CacheStore.get(cacheKey);
    if (hit) return hit.rows;
    const persons = {};
    Repository.all('persons').forEach((x) => { persons[x.id] = x; });
    const aliases = Repository.all('person_aliases');
    const stores = {};
    Repository.all('locations').forEach((x) => { stores[x.id] = x.name; });
    const stations = {};
    Repository.all('stations').forEach((x) => { stations[x.id] = x.name; });
    const rows = Repository.all('tl_enrollments').map((e) => {
      const per = persons[e.person_id] || { last_name: '', first_name: '' };
      const name = PersonService.displayName(per);
      const search = [ImportRules.normalizeName(name)].concat(
        aliases.filter((a) => a.person_id === e.person_id && a.alias_type === 'NAME').map((a) => ImportRules.normalizeName(a.value)),
        ImportRules.normalizeName(per.last_name + ' ' + per.first_name)).join(' | ');
      return {
        id: e.id, person_id: e.person_id, name: name, search_text: search, mother_location_id: e.mother_location_id,
        store: stores[e.mother_location_id] || '', station_id: e.station_id, station: stations[e.station_id] || '',
        batch_code: e.batch_code, entry_date: e.entry_date, deadline: e.deadline, status: e.status, final_grade: e.final_grade,
        open: TlRules.OPEN.indexOf(e.status) >= 0,
      };
    });
    try { CacheStore.put(cacheKey, { rows: rows }, LIST_TTL); } catch (err) { /* too large for the cache: read again next time */ }
    return rows;
  }

  function list(ctx, p) {
    const today = Clock.today();
    const rows = baseRows().map((r) => Object.assign({}, r, { overdue: TlRules.overdue(r.status, r.deadline, today) }));
    const q = p.q ? ImportRules.normalizeName(p.q) : '';
    const params = Object.assign({}, p, { q: q });
    const res = Lists.run(rows, params, {
      filters: ['status', 'mother_location_id', 'station_id', 'batch_code', 'open', 'overdue'],
      search: ['search_text'], sortable: ['deadline', 'entry_date', 'name'], defaultSort: 'deadline',
    });
    return Api.paged(res.items.map((r) => { const c = Object.assign({}, r); delete c.search_text; return c; }), res.page);
  }

  function history(ctx, p) {
    const snap = load(Repository, p.id);
    const items = [];
    Repository.all('status_history').filter((h) => h.entity === 'tl_enrollments' && h.entity_id === p.id).forEach((h) => items.push({
      id: h.id, kind: 'STATUS', at: h.at, by: h.user_id, from_status: h.from_status, to_status: h.to_status, effective_date: h.effective_date, remark: h.remark,
    }));
    Repository.all('record_history').filter((h) => h.entity === 'tl_enrollments' && h.entity_id === p.id).forEach((h) => items.push({
      id: h.id, kind: 'FIELD', at: h.at, by: h.user_id, field: h.field, old_value: h.old_value, new_value: h.new_value,
    }));
    snap.rows.forEach((a) => items.push({
      id: a.id, kind: 'ASSESSMENT', at: a.created_at, by: a.created_by, component_id: a.component_id, score: a.score, assessed_on: a.assessed_on,
      retake_no: a.retake_no, supersedes_id: a.supersedes_id, correction_reason: a.correction_reason,
    }));
    snap.exts.forEach((x) => items.push({
      id: x.id, kind: 'EXTENSION', at: x.created_at, by: x.created_by, extension_no: x.extension_no, old_deadline: x.old_deadline, new_deadline: x.new_deadline, reason: x.reason,
    }));
    snap.officers.forEach((o) => items.push({ id: o.id, kind: 'OFFICER', at: o.created_at, by: o.created_by, user_id: o.user_id, retake_no: o.retake_no }));
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)));
    const size = p.page_size === undefined ? MAX_PAGE : p.page_size;
    if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) throw bad('page_size', 'RANGE', 'page_size must be 1 to ' + MAX_PAGE + '.');
    let start = 0;
    if (p.cursor) {
      if (!/^\d{1,6}$/.test(p.cursor)) throw bad('cursor', 'TYPE', 'Not a valid cursor.');
      start = Number(p.cursor);
    }
    const slice = items.slice(start, start + size);
    return Api.paged(slice, { next_cursor: start + size < items.length ? String(start + size) : null });
  }

  const ID = { id: { type: 'text', required: true, max: 40 } };
  const IDRV = { id: { type: 'text', required: true, max: 40 }, row_version: { type: 'int', required: true } };

  function methods() {
    return {
      'tl.list': { kind: 'R', params: Lists.PARAMS, handler: list },
      'tl.get': { kind: 'R', params: ID, handler: (ctx, p) => view(p.id, ctx.role) },
      'tl.history': { kind: 'R', params: Object.assign({ cursor: { type: 'text', max: 20 }, page_size: { type: 'int' } }, ID), handler: history },
      'tl.enroll': {
        kind: 'W',
        params: {
          person_id: { type: 'text', max: 40 }, person: { type: 'object' },
          mother_location_id: { type: 'text', required: true, max: 40 }, support_location_id: { type: 'text', max: 40 },
          station_id: { type: 'text', required: true, max: 40 }, batch_code: { type: 'text', max: 50 },
          entry_date: { type: 'date', required: true }, remarks: { type: 'text', max: 2000 }, confirm: { type: 'bool' },
        },
        handler: enroll,
      },
      'tl.update': { kind: 'W', params: Object.assign({ patch: { type: 'object', required: true } }, IDRV), handler: update },
      'tl.recordEntryGrade': {
        kind: 'W',
        params: Object.assign({
          component_id: { type: 'text', required: true, max: 40 }, score: { type: 'number', required: true, min: 0, max: 100 },
          assessed_on: { type: 'date', required: true }, correction_reason: { type: 'text', max: 500 },
        }, IDRV),
        handler: recordEntryGrade,
      },
    };
  }

  return { methods: methods, view: view, statusChange: statusChange };
})();
