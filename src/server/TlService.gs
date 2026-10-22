// Team Leader enrollments (Phase 2 spec sections 6 to 8): enroll, update, entry grades, the certification check and the
// actions after it, and the reads. The rules are in TlRules.gs (pure); this file reads and writes through the repository,
// in one transaction per call, with status_history, record_history and an audit row for every write.
const TlService = (function () {
  const S = TlRules.STATUS;
  const ENTRY_STAGE = 'entry';
  const CERT_STAGE = 'certification';
  const LIST_TTL = 60;
  const LIST_CACHE_MAX = 90000;
  const UPDATABLE = ['mother_location_id', 'support_location_id', 'station_id', 'batch_code', 'visit_report_url', 'remarks'];

  const actorOf = (ctx) => ({ userId: ctx.userId, now: ctx.now });
  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');
  const yearOf = (iso) => Number(String(iso).slice(0, 4));

  // ---------- settings in force ----------

  // The setting in force on a date; for a date before the first version, the first version (a rule that has never changed
  // has applied since the beginning). Returns { value, version } or null when the setting was never set.
  function settingOn(key, date) {
    const row = SettingsService.inForce(key, date) || SettingsService.versions(key)[0] || null;
    if (!row) return null;
    const value = row.value_type === 'int' ? Number(row.value) : row.value_type === 'intset' ? row.value.split('/').map(Number) : row.value;
    return { value: value, version: row.version };
  }

  function requireSetting(key, date) {
    const s = settingOn(key, date);
    if (!s) throw Errors.configMissing(key);
    return s;
  }

  // ---------- list cache ----------

  // Every Team Leader write raises this number, so a cached list is never older than the last write.
  function dataVersion() { return Number(Props.get('TL_DATA_VERSION')) || 0; }
  function bumpDataVersion() { Props.set('TL_DATA_VERSION', dataVersion() + 1); }

  // ---------- reading ----------

  function personName(p) { return p ? PersonService.displayName(p) : ''; }

  // The joined rows of the list, without anything that depends on today. Cached for a minute under the data version. The
  // cache holds at most 100 KB a value, so a list that is too big is simply not cached.
  function baseRows() {
    const key = 'tl:list:' + dataVersion();
    const hit = CacheStore.get(key);
    if (hit) return hit.rows;
    const persons = {};
    Repository.all('persons').forEach((p) => { persons[p.id] = p; });
    const aliases = {};
    Repository.all('person_aliases').filter((a) => a.alias_type === 'NAME').forEach((a) => { (aliases[a.person_id] = aliases[a.person_id] || []).push(a.value); });
    const locations = {};
    Repository.all('locations').forEach((l) => { locations[l.id] = l.name; });
    const stations = {};
    Repository.all('stations').forEach((s) => { stations[s.id] = s.name; });
    const rows = Repository.all('tl_enrollments').map((e) => {
      const p = persons[e.person_id];
      const name = personName(p);
      return {
        id: e.id, person_id: e.person_id, name: name, mother_location_id: e.mother_location_id, store: locations[e.mother_location_id] || '',
        station_id: e.station_id, station: stations[e.station_id] || '', batch_code: e.batch_code, entry_date: e.entry_date,
        deadline: e.deadline, status: e.status, final_grade: e.final_grade, open: TlRules.OPEN.indexOf(e.status) >= 0,
        search_text: [name, ImportRules.normalizeName(name)].concat(aliases[e.person_id] || []).join(' | '),
      };
    });
    const payload = { rows: rows };
    if (JSON.stringify(payload).length < LIST_CACHE_MAX) {
      try { CacheStore.put(key, payload, LIST_TTL); } catch (e) { /* a cache that refuses a value only makes the list slower */ }
    }
    return rows;
  }

  function listMethod(ctx, p) {
    const today = Clock.today();
    const rows = baseRows().map((r) => Object.assign({}, r, { overdue: TlRules.overdue(r.status, r.deadline, today) }));
    const res = Lists.run(rows, p, {
      filters: ['status', 'mother_location_id', 'station_id', 'batch_code', 'open', 'overdue'],
      search: ['search_text'], sortable: ['deadline', 'entry_date', 'name'], defaultSort: 'deadline',
    });
    const items = res.items.map((r) => {
      const c = Object.assign({}, r);
      delete c.search_text;
      return c;
    });
    return Api.paged(items, res.page);
  }

  // ---------- checks used by several actions ----------

  function loadEnrollment(uow, id) {
    const e = uow.get('tl_enrollments', id);
    if (!e) throw Errors.notFound();
    return e;
  }

  // The store (an active Location of type Store) for a field of the enrollment.
  function checkStore(uow, field, id, errs) {
    const l = uow.get('locations', id);
    if (!l || !l.is_active || l.location_type !== 'Store') errs.push({ path: field, code: 'LINK', message: 'Choose an active store.' });
    return l;
  }

  function checkLinks(uow, v, brandOf) {
    const errs = [];
    let mother = null;
    if (v.mother_location_id) mother = checkStore(uow, 'mother_location_id', v.mother_location_id, errs);
    if (v.support_location_id) checkStore(uow, 'support_location_id', v.support_location_id, errs);
    if (v.station_id) {
      const st = uow.get('stations', v.station_id);
      const brand = (mother || brandOf || {}).brand_id;
      if (!st || !st.is_active) errs.push({ path: 'station_id', code: 'LINK', message: 'Choose an active station.' });
      else if (brand && st.brand_id !== brand) errs.push({ path: 'station_id', code: 'LINK', message: 'The station belongs to another brand.' });
    }
    if (errs.length) throw Errors.validation(errs);
  }

  function checkDateNotFuture(path, iso) {
    if (iso > Clock.today()) throw Errors.validation([{ path: path, code: 'FUTURE_DATE', message: 'The date cannot be after today.' }]);
  }

  // One status_history row, and the new status on the enrollment (the caller passes the enrollment as read in this unit of work).
  function statusChange(uow, ctx, enrollment, toStatus, effectiveDate, remark, extraPatch) {
    uow.append('status_history', {
      entity: 'tl_enrollments', entity_id: enrollment.id, from_status: enrollment.status, to_status: toStatus,
      effective_date: effectiveDate, remark: remark || '', request_id: ctx.requestId || '',
    }, actorOf(ctx));
    const patch = Object.assign({ status: toStatus }, extraPatch || {});
    const r = uow.update('tl_enrollments', enrollment.id, patch, { expectedVersion: enrollment.row_version, actor: actorOf(ctx) });
    AuditService.changes(uow, ctx, 'tl_enrollments', enrollment.id, r.before, r.after);
    return r.after;
  }

  // The row_version check of an action that changes only other tables: a stale call is a CONFLICT and writes nothing.
  function checkVersion(uow, enrollment, expected) {
    const r = uow.update('tl_enrollments', enrollment.id, {}, { expectedVersion: expected, actor: { userId: '', now: '' } });
    return r.after;
  }

  function requiredEntryComponents(uow) {
    return uow.all('assessment_components').filter((c) => c.stage === ENTRY_STAGE && c.is_active && c.required);
  }

  function gradesOf(uow, enrollmentId, retake) {
    return TlRules.inForce(uow.all('assessments').filter((a) => a.subject_type === 'TL_ENROLLMENT' && a.subject_id === enrollmentId
      && (retake === undefined || (retake === 0 ? a.retake_no === 0 : a.retake_no === retake))));
  }

  function entryGrades(uow, enrollmentId) { return gradesOf(uow, enrollmentId, 0); }

  function certGrades(uow, enrollmentId) {
    return TlRules.inForce(uow.all('assessments').filter((a) => a.subject_type === 'TL_ENROLLMENT' && a.subject_id === enrollmentId && a.retake_no >= 1));
  }

  // ---------- enroll ----------

  const PERSON_PARAMS = {
    last_name: { type: 'text', required: true, max: 100 }, first_name: { type: 'text', required: true, max: 100 },
    middle_name: { type: 'text', max: 100 }, suffix: { type: 'text', max: 20 },
    hr_employee_no: { type: 'text', max: 20, pattern: /^\d{1,20}$/, patternMessage: 'Digits only.' },
  };

  function enroll(ctx, p) {
    if (!!p.person_id === !!p.person) {
      throw Errors.validation([{ path: p.person_id ? 'person' : 'person_id', code: 'REQUIRED', message: 'Give an existing person or the names of a new person, not both and not neither.' }]);
    }
    checkDateNotFuture('entry_date', p.entry_date);
    let newPerson = null;
    if (p.person) {
      newPerson = Validator.clean({ name: 'person', fields: PERSON_PARAMS }, p.person, 'create');
      const found = PersonService.candidates(Repository.all('persons'), Repository.all('person_aliases'), newPerson);
      if (found.some((c) => c.reason === 'SAME_HR_NO')) {
        throw Errors.validation([{ path: 'person.hr_employee_no', code: 'DUPLICATE', message: 'Another person has this HR employee number.' }]);
      }
      if (found.length && p.confirm !== true) {
        return { requires_confirm: true, warnings: [{ code: 'POSSIBLE_DUPLICATE', message: 'A similar person exists.', candidates: found }] };
      }
    }
    const months = requireSetting('CFG-040', p.entry_date).value;
    const result = Repository.transact((uow) => {
      let person;
      if (p.person_id) {
        person = uow.get('persons', p.person_id);
        if (!person || !person.is_active) throw Errors.validation([{ path: 'person_id', code: 'LINK', message: 'The person does not exist or is not active.' }]);
        const open = uow.all('tl_enrollments').filter((e) => e.person_id === person.id && TlRules.OPEN.indexOf(e.status) >= 0);
        if (open.length) throw Errors.blocked('RULE-100', 'This person already has an open enrollment (' + open[0].id + ').');
      }
      const values = { mother_location_id: p.mother_location_id, support_location_id: p.support_location_id, station_id: p.station_id };
      if (!p.station_id) throw Errors.validation([{ path: 'station_id', code: 'REQUIRED', message: 'A station is required.' }]);
      checkLinks(uow, values);
      if (newPerson) person = PersonService.create(uow, Object.assign({}, actorOf(ctx), { today: ctx.today || Clock.today() }), newPerson);
      const row = {
        person_id: person.id, mother_location_id: p.mother_location_id, station_id: p.station_id, entry_date: p.entry_date,
        deadline: TlRules.deadline(p.entry_date, months), status: S.ENTRY,
      };
      ['support_location_id', 'batch_code', 'remarks'].forEach((f) => { if (p[f]) row[f] = p[f]; });
      const e = uow.insert('tl_enrollments', row, actorOf(ctx), yearOf(p.entry_date));
      uow.append('status_history', {
        entity: 'tl_enrollments', entity_id: e.id, from_status: '', to_status: S.ENTRY, effective_date: p.entry_date,
        remark: 'Enrolled', request_id: ctx.requestId || '',
      }, actorOf(ctx));
      AuditService.event(uow, ctx, {
        event: 'TL.ENROLLED', entity: 'tl_enrollments', entityId: e.id,
        detail: { person_id: person.id, entry_date: e.entry_date, deadline: e.deadline, new_person: !!newPerson },
      });
      return { enrollment: e, person: person };
    });
    bumpDataVersion();
    return { enrollment: result.enrollment, person: Object.assign({}, result.person, { display_name: personName(result.person) }) };
  }

  // ---------- update ----------

  function update(ctx, p) {
    const bad = Object.keys(p.patch).filter((k) => UPDATABLE.indexOf(k) < 0);
    if (bad.length) throw Errors.validation(bad.map((k) => ({ path: 'patch.' + k, code: 'UNKNOWN_FIELD', message: 'This field cannot be changed here.' })));
    const result = Repository.transact((uow) => {
      const e = loadEnrollment(uow, p.id);
      const patch = Object.assign({}, p.patch);
      if ('mother_location_id' in patch && !patch.mother_location_id) throw Errors.validation([{ path: 'patch.mother_location_id', code: 'REQUIRED', message: 'A store is required.' }]);
      const mother = uow.get('locations', patch.mother_location_id || e.mother_location_id);
      checkLinks(uow, { mother_location_id: patch.mother_location_id, support_location_id: patch.support_location_id,
        station_id: 'station_id' in patch ? patch.station_id : (patch.mother_location_id ? e.station_id : '') }, mother);
      const r = uow.update('tl_enrollments', p.id, patch, { expectedVersion: p.row_version, actor: actorOf(ctx) });
      if (r.changed.length) {
        AuditService.changes(uow, ctx, 'tl_enrollments', p.id, r.before, r.after);
        AuditService.event(uow, ctx, { event: 'TL.UPDATED', entity: 'tl_enrollments', entityId: p.id, detail: { changed: r.changed } });
      }
      return r.after;
    });
    if (result) bumpDataVersion();
    return { enrollment: result };
  }

  // ---------- entry grades ----------

  function recordEntryGrade(ctx, p) {
    const result = Repository.transact((uow) => {
      const e = loadEnrollment(uow, p.id);
      const facts = {};
      const d = TlRules.decide('recordEntryGrade', e.status, ctx.role, facts);
      if (!d.ok) throw decisionError(d);
      const comp = uow.get('assessment_components', p.component_id);
      if (!comp || !comp.is_active || comp.stage !== ENTRY_STAGE) throw Errors.validation([{ path: 'component_id', code: 'LINK', message: 'Choose an active entry component.' }]);
      if (p.assessed_on > Clock.today()) throw Errors.validation([{ path: 'assessed_on', code: 'FUTURE_DATE', message: 'The date cannot be after today.' }]);
      if (p.assessed_on < e.entry_date) throw Errors.validation([{ path: 'assessed_on', code: 'BEFORE_ENTRY', message: 'The date cannot be before the entry date.' }]);
      const current = entryGrades(uow, e.id).filter((g) => g.component_id === comp.id)[0] || null;
      const row = {
        subject_type: 'TL_ENROLLMENT', subject_id: e.id, component_id: comp.id, score: p.score, assessed_on: p.assessed_on,
        assessed_by: ctx.userId, retake_no: 0,
      };
      if (current) {
        if (!p.correction_reason) throw Errors.validation([{ path: 'correction_reason', code: 'REQUIRED', message: 'A reason is required to correct a grade.' }]);
        row.supersedes_id = current.id;
        row.correction_reason = p.correction_reason;
      }
      const grade = uow.append('assessments', row, actorOf(ctx), yearOf(p.assessed_on));
      const state = TlRules.entryState(requiredEntryComponents(uow).map((c) => c.id), entryGrades(uow, e.id));
      let after = checkVersion(uow, e, p.row_version);
      // Interim X-2: probation starts when the last required entry grade is saved.
      if (state.complete && e.status === S.ENTRY) after = statusChange(uow, ctx, e, S.PROBATION, p.assessed_on, 'The last required entry grade was recorded.');
      AuditService.event(uow, ctx, {
        event: 'TL.ENTRY_GRADE_RECORDED', entity: 'tl_enrollments', entityId: e.id,
        detail: { component_id: comp.id, score: p.score, assessment_id: grade.id, supersedes_id: row.supersedes_id || null, status: after.status },
      });
      return { grade: grade, enrollment: after, entry: state };
    });
    bumpDataVersion();
    return result;
  }

  function decisionError(d) {
    if (d.code === 'FORBIDDEN') return Errors.forbidden(d.message);
    if (d.code === 'CONFIG_MISSING') return Errors.configMissing(d.key);
    return Errors.blocked(d.rule_id, d.message);
  }

  // ---------- reading one record ----------

  function userNames() {
    const m = {};
    Repository.all('users').forEach((u) => { m[u.id] = u.display_name; });
    return m;
  }

  // The facts TlRules.decide needs, for a record as it stands.
  function factsOf(e, role, grades) {
    const cert = grades.cert;
    const latestNo = cert.reduce((n, g) => Math.max(n, g.retake_no), 0);
    const checkDate = latestNo ? (cert.filter((g) => g.retake_no === latestNo)[0] || {}).assessed_on : null;
    const on = checkDate || Clock.today();
    const course = grades.courseId ? cert.filter((g) => g.component_id === grades.courseId)[0] : null;
    const pass = settingOn('CFG-041', on);
    const coursePass = settingOn('TLMI-001', on);
    const limit = SettingsService.inForce('CFG-047');
    return {
      entryComplete: grades.entry.complete, finalGrade: e.final_grade === null || e.final_grade === undefined || e.final_grade === '' ? null : e.final_grade,
      passMark: pass ? pass.value : null, courseGrade: course ? course.score : null, coursePassMark: coursePass ? coursePass.value : null,
      extensionsUsed: grades.extensions, extensionLimit: limit ? Number(limit.value) : null,
    };
  }

  function loadGrades(uow, e) {
    const comps = uow.all('assessment_components');
    const course = comps.filter((c) => c.stage === CERT_STAGE && c.name === 'TL course program')[0] || null;
    return {
      entry: TlRules.entryState(requiredEntryComponents(uow).map((c) => c.id), entryGrades(uow, e.id)),
      cert: certGrades(uow, e.id), courseId: course ? course.id : null,
      extensions: uow.all('tl_extensions').filter((x) => x.tl_enrollment_id === e.id).length,
    };
  }

  function get(ctx, p) {
    const e = Repository.get('tl_enrollments', p.id);
    if (!e) throw Errors.notFound();
    const person = Repository.get('persons', e.person_id);
    const comps = Repository.all('assessment_components');
    const compName = {};
    comps.forEach((c) => { compName[c.id] = c.name; });
    const names = userNames();
    const all = Repository.all('assessments').filter((a) => a.subject_type === 'TL_ENROLLMENT' && a.subject_id === e.id);
    const inForce = TlRules.inForce(all);
    const view = (a) => ({
      id: a.id, component_id: a.component_id, component: compName[a.component_id] || '', score: a.score, assessed_on: a.assessed_on,
      assessed_by: a.assessed_by, assessed_by_name: names[a.assessed_by] || '', retake_no: a.retake_no, remark: a.remark,
      supersedes_id: a.supersedes_id, correction_reason: a.correction_reason,
    });
    const required = comps.filter((c) => c.stage === ENTRY_STAGE && c.is_active && c.required);
    const entryRows = inForce.filter((a) => a.retake_no === 0);
    const entry = TlRules.entryState(required.map((c) => c.id), entryRows);
    const certRows = inForce.filter((a) => a.retake_no >= 1);
    const officers = Repository.all('tl_certifying_officers').filter((o) => o.tl_enrollment_id === e.id);
    const attempts = {};
    certRows.forEach((a) => { (attempts[a.retake_no] = attempts[a.retake_no] || []).push(a); });
    const checks = Object.keys(attempts).map(Number).sort((a, b) => a - b).map((n) => ({
      retake_no: n, assessed_on: attempts[n][0].assessed_on,
      scores: attempts[n].map(view),
      officers: officers.filter((o) => o.retake_no === n).map((o) => ({ user_id: o.user_id, name: names[o.user_id] || '' })),
    }));
    const course = courseOf(comps, certRows);
    const extensions = Repository.all('tl_extensions').filter((x) => x.tl_enrollment_id === e.id).sort((a, b) => a.extension_no - b.extension_no);
    const grades = { entry: entry, cert: certRows, courseId: course.id, extensions: extensions.length };
    const facts = factsOf(e, ctx.role, grades);
    const today = Clock.today();
    return {
      enrollment: e,
      person: person ? Object.assign({}, person, { display_name: personName(person) }) : null,
      overdue: TlRules.overdue(e.status, e.deadline, today),
      entry: {
        average: entry.average, complete: entry.complete, missing: entry.missing,
        components: required.map((c) => ({ component_id: c.id, name: c.name, grade: (entryRows.filter((a) => a.component_id === c.id).map(view)[0]) || null })),
        history: all.filter((a) => a.retake_no === 0).map(view),
      },
      checks: checks,
      course_program: course.row ? view(course.row) : null,
      course_pass_mark: facts.coursePassMark,
      pass_mark: facts.passMark,
      extensions: extensions,
      allowed_actions: TlRules.allowedActions(e.status, ctx.role, facts),
    };
  }

  function courseOf(comps, certRows) {
    const c = comps.filter((x) => x.stage === CERT_STAGE && x.name === 'TL course program')[0] || null;
    const row = c ? certRows.filter((a) => a.component_id === c.id)[0] || null : null;
    return { id: c ? c.id : null, row: row };
  }

  // ---------- history ----------

  // The record's history, newest first: its status changes and field changes, its grades (with the corrections), its
  // extensions and its certifying officers. A cursor is the `at` and id of the last event of the previous page.
  function history(ctx, p) {
    const e = Repository.get('tl_enrollments', p.id);
    if (!e) throw Errors.notFound();
    const names = userNames();
    const compName = {};
    Repository.all('assessment_components').forEach((c) => { compName[c.id] = c.name; });
    const events = [];
    Repository.all('status_history').filter((h) => h.entity === 'tl_enrollments' && h.entity_id === e.id).forEach((h) => {
      events.push({ kind: 'STATUS', id: h.id, at: h.at, user_id: h.user_id, from_status: h.from_status, to_status: h.to_status, effective_date: h.effective_date, remark: h.remark });
    });
    Repository.all('record_history').filter((h) => h.entity === 'tl_enrollments' && h.entity_id === e.id && h.field !== 'status').forEach((h) => {
      events.push({ kind: 'FIELD', id: h.id, at: h.at, user_id: h.user_id, field: h.field, old_value: h.old_value, new_value: h.new_value });
    });
    Repository.all('assessments').filter((a) => a.subject_type === 'TL_ENROLLMENT' && a.subject_id === e.id).forEach((a) => {
      events.push({ kind: 'GRADE', id: a.id, at: a.created_at, user_id: a.created_by, component: compName[a.component_id] || '', score: a.score,
        assessed_on: a.assessed_on, retake_no: a.retake_no, supersedes_id: a.supersedes_id, correction_reason: a.correction_reason });
    });
    Repository.all('tl_extensions').filter((x) => x.tl_enrollment_id === e.id).forEach((x) => {
      events.push({ kind: 'EXTENSION', id: x.id, at: x.created_at, user_id: x.created_by, extension_no: x.extension_no, old_deadline: x.old_deadline, new_deadline: x.new_deadline, reason: x.reason });
    });
    Repository.all('tl_certifying_officers').filter((o) => o.tl_enrollment_id === e.id).forEach((o) => {
      events.push({ kind: 'OFFICER', id: o.id, at: o.created_at, user_id: o.created_by, officer_id: o.user_id, officer_name: names[o.user_id] || '', retake_no: o.retake_no });
    });
    events.forEach((ev) => { ev.user_name = names[ev.user_id] || ''; });
    const order = (a, b) => (a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : (a.at < b.at ? 1 : -1));
    events.sort(order);
    const size = p.page_size === undefined ? 50 : p.page_size;
    if (!Number.isInteger(size) || size < 1 || size > Lists.MAX_PAGE) throw Errors.validation([{ path: 'page_size', code: 'RANGE', message: 'page_size must be 1 to ' + Lists.MAX_PAGE + '.' }]);
    let rest = events;
    if (p.cursor) {
      const at = p.cursor.split('|')[0];
      const id = p.cursor.split('|')[1] || '';
      rest = events.filter((ev) => ev.at < at || (ev.at === at && ev.id < id));
    }
    const page = rest.slice(0, size);
    const last = page[page.length - 1];
    return Api.paged(page, { next_cursor: rest.length > size && last ? last.at + '|' + last.id : null });
  }

  // ---------- methods ----------

  function methods() {
    const rv = { row_version: { type: 'int', required: true } };
    const id = { id: { type: 'text', required: true, max: 40 } };
    return {
      'tl.list': { kind: 'R', params: Lists.PARAMS, handler: listMethod },
      'tl.get': { kind: 'R', params: id, handler: get },
      'tl.history': { kind: 'R', params: Object.assign({ cursor: { type: 'text', max: 60 }, page_size: { type: 'int' } }, id), handler: history },
      'tl.enroll': {
        kind: 'W',
        params: {
          person_id: { type: 'text', max: 40 }, person: { type: 'object' },
          mother_location_id: { type: 'text', required: true, max: 40 }, support_location_id: { type: 'text', max: 40 },
          station_id: { type: 'text', max: 40 }, batch_code: { type: 'text', max: 50 },
          entry_date: { type: 'date', required: true }, remarks: { type: 'text', max: 2000 }, confirm: { type: 'bool' },
        },
        handler: enroll,
      },
      'tl.update': { kind: 'W', params: Object.assign({ patch: { type: 'object', required: true } }, id, rv), handler: update },
      'tl.recordEntryGrade': {
        kind: 'W',
        params: Object.assign({
          component_id: { type: 'text', required: true, max: 40 },
          score: { type: 'number', required: true, min: 0, max: 100, decimals: 2 },
          assessed_on: { type: 'date', required: true }, correction_reason: { type: 'text', max: 500 },
        }, id, rv),
        handler: recordEntryGrade,
      },
    };
  }

  return {
    methods: methods, statusChange: statusChange, settingOn: settingOn, bumpDataVersion: bumpDataVersion,
  };
})();
