// The legacy import (Phase 2 spec section 10): validation of every MASTER_LOG row against the officers' decisions in the
// review sheet, the rows list and skip, and (further down) the commit in chunks with the reconciliation.
// plan() and reconcile() are pure. The service reads the legacy copy and the review sheet only through the repository and
// never writes to either. Nothing here guesses: a value without an officer decision keeps the row NOT_READY (spec 10.7).
const ImportService = (function () {
  const TAB = 'MASTER_LOG';
  const KIND = 'LEGACY_TL';
  const CHUNK_ROWS = 25;
  const CHUNKS_PER_CALL = 4;
  const MAX_PAGE = 50;
  const SOURCE_FIELDS = ['form_timestamp', 'entry_date', 'batch', 'mother_store', 'full_name', 'mother_station', 'support_store', 'result',
    'uniform_release', 'entry_by', 'istv', 'techval_fp', 'techval_pm', 'exam_fp', 'exam_pm', 'entry_average', 'cert_deadline', 'cert_by',
    'date_certified', 'cert_grade', 'exam_grade', 'cert_average', 'status'];
  // Legacy grade column -> assessment component (spec 10.5). Column T is the TL course program grade, never the checklist (P2-13).
  const ENTRY_COMPONENT = {
    istv: 'ISTV', techval_fp: 'Tech Val Food Prep', techval_pm: 'Tech Val Pizza Maker',
    exam_fp: 'TL entry exam Food Prep', exam_pm: 'TL entry exam Pizza Maker',
  };
  const CERT_COMPONENT = { cert_grade: 'TL course program', exam_grade: 'Exam' };
  const NONE_TEXT = /^(NONE|N\/A)$/i;

  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');
  const norm = (s) => ImportRules.normalizeName(s);
  const low = (s) => tidy(s).toLowerCase();
  const badKey = (row, field, code) => TAB + '|' + row + '|' + field + '|' + code;

  // ---- the pure plan ------------------------------------------------------------------------------------------------
  function rowHash(rec) {
    return ImportRules.hash(SOURCE_FIELDS.map((f) => tidy(rec[f])).join('\u0001'));
  }

  // Resolves one date or grade cell. issuesByField comes from ImportRules.checkRow. A cell that parses cleanly is used as it is.
  // A cell with a problem is used only through an officer decision on its bad_values row (confirm takes the proposed value,
  // correct value takes the typed one, drop value leaves it empty). Returns { state, value, flagged }.
  function resolveCell(rec, field, kind, issuesByField, bad, today, allowDrop) {
    const raw = tidy(rec[field]);
    const found = issuesByField[field] || [];
    if (!found.length) {
      if (raw === '') return { state: 'empty' };
      const p = kind === 'date' ? ImportRules.parseDate(raw, today) : ImportRules.parseGrade(raw);
      return { state: 'value', value: kind === 'date' ? p.iso : p.value };
    }
    let value;
    let hasValue = false;
    let dropped = false;
    let undecided = false;
    let flagged = false;
    found.forEach((i) => {
      const row = bad[badKey(rec.row, field, i.code)];
      const dec = row ? low(row.decision) : '';
      if (row && row.flagged) flagged = true;
      let v;
      if (dec === 'confirm' && i.proposed !== undefined) {
        v = i.proposed;
      } else if (dec === 'correct value') {
        const p = kind === 'date' ? ImportRules.parseDate(row.corrected_value, today) : ImportRules.parseGrade(row.corrected_value);
        if (!p.issue && (kind === 'date' ? p.iso !== undefined : p.value !== undefined)) v = kind === 'date' ? p.iso : p.value;
      } else if (dec === 'drop value' && allowDrop) {
        dropped = true;
        return;
      }
      if (v === undefined) { undecided = true; return; }
      if (!hasValue) { value = v; hasValue = true; }
    });
    if (undecided) return { state: 'undecided', flagged: flagged };
    if (hasValue) return { state: 'value', value: value, flagged: flagged };
    return dropped ? { state: 'dropped', flagged: flagged } : { state: 'undecided', flagged: flagged };
  }

  // sourceRows: the MASTER_LOG rows as objects of text (ImportReviewService.readMasterLog).
  // decisions: { persons: {key: {decision, corrected_value, last, first, middle, suffix, flagged}}, duplicates: [{name_a, name_b, decision,
  //   flagged}], bad: {key: {decision, corrected_value, flagged}}, aliases: {store, station, officer} }.
  // lists: { today, stores: [{id, name, brand_id}], stations: [{id, name, brand_id}], officers: [{id, display_name}],
  //   components: {name: id}, disqualifiedId, months(entryIso) }.
  // state: { enrollmentsByRef: {ref: {id, status}}, refsByRow: {row: [ref]}, skips: {ref: reason}, openByPerson: {personRef: n} }.
  function plan(sourceRows, decisions, lists, state) {
    const today = lists.today;
    const dec = decisions || {};
    const bad = dec.bad || {};
    const aliases = dec.aliases || { store: {}, station: {}, officer: {} };
    const st = state || {};
    const byRef = st.enrollmentsByRef || {};
    const refsByRow = st.refsByRow || {};
    const skips = st.skips || {};
    const openByPerson = st.openByPerson || {};

    // ---- people: one key per normalised name, merged only where an officer confirmed a duplicate pair
    const order = [];
    const spellings = {};
    const firstRow = {};
    sourceRows.forEach((rec) => {
      const k = norm(rec.full_name);
      if (!k) return;
      if (!(k in spellings)) { spellings[k] = []; order.push(k); firstRow[k] = rec.row; }
      const sp = tidy(rec.full_name);
      if (spellings[k].indexOf(sp) < 0) spellings[k].push(sp);
    });
    const parent = {};
    order.forEach((k) => { parent[k] = k; });
    const find = (k) => { let x = k; while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const pairsOf = {};
    (dec.duplicates || []).forEach((p) => {
      const a = norm(p.name_a);
      const b = norm(p.name_b);
      if (!(a in parent) || !(b in parent) || a === b) return;
      const d = low(p.decision);
      (pairsOf[a] = pairsOf[a] || []).push({ other: b, decision: d, flagged: !!p.flagged });
      (pairsOf[b] = pairsOf[b] || []).push({ other: a, decision: d, flagged: !!p.flagged });
      if (d === 'confirm') { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; }
    });
    const groups = {};
    order.forEach((k) => { const r = find(k); (groups[r] = groups[r] || []).push(k); });
    const groupInfo = {};
    Object.keys(groups).forEach((root) => {
      const members = groups[root].slice().sort((a, b) => firstRow[a] - firstRow[b]);
      const anchor = members[0];
      let flagged = false;
      const partsOf = members.map((k) => {
        const row = (dec.persons || {})[k];
        if (row && row.flagged) flagged = true;
        if (!row) return null;
        const d = low(row.decision);
        if (d === 'confirm') {
          const p = { last: tidy(row.last).toUpperCase(), first: tidy(row.first).toUpperCase(), middle: tidy(row.middle).toUpperCase(), suffix: tidy(row.suffix).toUpperCase() };
          return p.last && p.first ? p : null;
        }
        if (d === 'correct value') return ImportRules.parseNameParts(row.corrected_value);
        return null;
      });
      const all = {};
      members.forEach((k) => { spellings[k].forEach((sp) => { all[sp] = true; }); });
      const spell = [];
      sourceRows.forEach((rec) => { const sp = tidy(rec.full_name); if (all[sp] && members.indexOf(norm(rec.full_name)) >= 0 && spell.indexOf(sp) < 0) spell.push(sp); });
      groupInfo[root] = {
        members: members, anchor: anchor, ok: partsOf.every((p) => p !== null), parts: partsOf[0], flagged: flagged,
        legacy_ref: 'LEGACY:' + anchor, spellings: spell,
      };
    });

    // ---- the rows (first pass: everything except OPEN_TWICE)
    const names = {
      stores: lists.stores,
      stations: lists.stations,
    };
    const resolveName = (raw, masters, aliasMap) => {
      const r = ImportRules.matchMaster(raw, masters.map((m) => m.name), aliasMap);
      if (r.status !== 'exact') return null;
      const hits = masters.filter((m) => norm(m.name) === norm(r.match));
      return hits.length === 1 ? hits[0] : null;
    };
    const userNames = lists.officers.map((u) => u.display_name);
    const userNamed = (name) => {
      const hits = lists.officers.filter((u) => norm(u.display_name) === norm(name));
      return hits.length === 1 ? hits[0] : null;
    };
    // { kind: 'none' | 'note' | 'user' | 'unmapped', user }
    const resolveOfficer = (raw) => {
      const t = tidy(raw);
      if (t === '' || NONE_TEXT.test(t)) return { kind: 'none' };
      if (ImportRules.looksLikeNote(t)) return { kind: 'note' };
      const hit = Object.keys(aliases.officer || {}).find((k) => norm(k) === norm(t));
      if (hit) { const u = userNamed(aliases.officer[hit]); return u ? { kind: 'user', user: u } : { kind: 'unmapped' }; }
      const m = ImportRules.matchOfficer(t, userNames);
      if (m.status === 'exact') { const u = userNamed(m.match); if (u) return { kind: 'user', user: u }; }
      return { kind: 'unmapped' };
    };

    const rows = sourceRows.map((rec) => {
      const hash = rowHash(rec);
      const legacyRef = TAB + '!' + rec.row + '#' + hash;
      const item = {
        source_row: rec.row, row_hash: hash, legacy_ref: legacyRef, result: '', issues: [], warnings: [], plan: null,
        planned_status: null, planned_close_reason: '', created_record_id: '', skip_reason: '', _group: null, _open: false,
      };
      const issue = (code, field, message) => item.issues.push({ code: code, field: field || '', message: message });
      const warn = (code, field, message) => item.warnings.push({ code: code, field: field || '', message: message });
      const notes = [];
      let flagged = false;

      // status first: the reconciliation needs it for every row, even a committed one
      const mapped = ImportRules.mapStatus(rec.result, rec.status);
      let status = null;
      let closeReason = '';
      if (!mapped.issue) {
        status = mapped.status;
        closeReason = mapped.closeReason || '';
      } else {
        const code = tidy(rec.result) === '' ? 'BLANK_REQUIRED' : 'UNKNOWN_STATUS';
        const row = bad[badKey(rec.row, 'result', code)];
        if (row && row.flagged) flagged = true;
        if (row && low(row.decision) === 'correct value') {
          const m2 = ImportRules.mapStatus(row.corrected_value, '');
          if (!m2.issue) { status = m2.status; closeReason = m2.closeReason || ''; }
        }
      }
      item.planned_status = status;
      item.planned_close_reason = closeReason;

      const committed = byRef[legacyRef];
      if (committed) {
        item.result = 'ALREADY_COMMITTED';
        item.created_record_id = committed.id;
        return item;
      }

      // person
      const key = norm(rec.full_name);
      const group = key ? groupInfo[find(key)] : null;
      item._group = group ? find(key) : null;
      if (!key) issue('PERSON_UNCONFIRMED', 'full_name', 'The full name is blank.');
      else if (!group.ok) issue('PERSON_UNCONFIRMED', 'full_name', 'The person is not confirmed in the review sheet.');
      if (key) {
        if (group.flagged) flagged = true;
        const pending = (pairsOf[key] || []).filter((p) => p.decision !== 'confirm' && p.decision !== 'different person');
        (pairsOf[key] || []).forEach((p) => { if (p.flagged) flagged = true; });
        if (pending.length) issue('DUPLICATE_UNDECIDED', 'full_name', 'A possible duplicate of this person has no decision in the review sheet.');
      }

      // stores and station
      const store = resolveName(rec.mother_store, names.stores, aliases.store);
      if (!store) issue('STORE_UNMAPPED', 'mother_store', 'The mother store is not mapped to a store.');
      let support = null;
      if (tidy(rec.support_store) !== '' && !NONE_TEXT.test(tidy(rec.support_store))) {
        support = resolveName(rec.support_store, names.stores, aliases.store);
        if (!support) issue('SUPPORT_STORE_UNMAPPED', 'support_store', 'The support store is not mapped to a store.');
      }
      let station = null;
      if (tidy(rec.mother_station) !== '') {
        const pool = store ? names.stations.filter((x) => x.brand_id === store.brand_id) : names.stations;
        station = resolveName(rec.mother_station, pool, aliases.station);
        if (!station) issue('STATION_UNMAPPED', 'mother_station', 'The mother station is not mapped to a station.');
      }

      // dates and grades
      const found = {};
      ImportRules.checkRow(rec, today).forEach((i) => { (found[i.field] = found[i.field] || []).push(i); });
      const cell = (field, kind, allowDrop) => {
        const c = resolveCell(rec, field, kind, found, bad, today, allowDrop);
        if (c.flagged) flagged = true;
        return c;
      };
      const entry = cell('entry_date', 'date', false);
      if (entry.state !== 'value') issue('ENTRY_DATE_BAD', 'entry_date', 'The entry date has no usable value or officer decision.');
      if (status === null) issue('STATUS_BAD', 'result', 'The RESULT has no usable value or officer decision.');
      if (status === 'Failed' && closeReason === 'Disqualified' && !lists.disqualifiedId) {
        issue('STATUS_BAD', 'result', 'The close reason Disqualified is not in the list of close reasons.');
      }
      const undecided = [];
      const val = (field, kind) => {
        const c = cell(field, kind, true);
        if (c.state === 'undecided') undecided.push(field);
        return c.state === 'value' ? c.value : undefined;
      };
      const deadlineGiven = val('cert_deadline', 'date');
      const certDate = val('date_certified', 'date');
      const grades = {};
      Object.keys(ENTRY_COMPONENT).forEach((f) => { grades[f] = val(f, 'grade'); });
      Object.keys(CERT_COMPONENT).forEach((f) => { grades[f] = val(f, 'grade'); });
      const average = val('cert_average', 'grade');
      undecided.forEach((f) => issue('VALUE_UNDECIDED', f, 'This value has no officer decision in the review sheet.'));

      // officers
      const entryBy = resolveOfficer(rec.entry_by);
      if (entryBy.kind === 'note') { warn('OFFICER_NOTE', 'entry_by', 'ENTRY BY holds a note. It is kept in the remarks.'); notes.push(tidy(rec.entry_by)); }
      if (entryBy.kind === 'unmapped') warn('OFFICER_UNMAPPED', 'entry_by', 'ENTRY BY is not mapped to an officer. It is not used.');
      const officers = [];
      tidy(rec.cert_by).split('|').map(tidy).filter((x) => x !== '').forEach((piece) => {
        const o = resolveOfficer(piece);
        if (o.kind === 'user') { if (officers.indexOf(o.user.id) < 0) officers.push(o.user.id); }
        else if (o.kind === 'note') { warn('OFFICER_NOTE', 'cert_by', 'CERT BY holds a note. It is kept in the remarks.'); notes.push(piece); }
        else if (o.kind === 'unmapped') warn('OFFICER_UNMAPPED', 'cert_by', 'CERT BY is not mapped to an officer. It is not used.');
      });

      // warnings about values
      const entryPresent = Object.keys(ENTRY_COMPONENT).map((f) => grades[f]).filter((v) => v !== undefined);
      const typedAverage = ImportRules.parseGrade(rec.entry_average);
      if (typedAverage.value !== undefined && entryPresent.length) {
        const computed = TlRules.round2(entryPresent.reduce((a, b) => a + b, 0) / entryPresent.length);
        if (Math.abs(computed - typedAverage.value) > 0.5) warn('ENTRY_AVERAGE_DIFFERS', 'entry_average', 'The typed entry average differs from the computed one. It is not used.');
      }
      if (flagged) warn('DECISION_FLAGGED', '', 'A review decision used by this row is marked needs_review.');

      // the plan for the commit
      const gradeRows = [];
      const addGrade = (field, componentName, retakeNo, on, by) => {
        const v = grades[field];
        if (v === undefined) return;
        if (!on) { warn('CERT_GRADE_NO_DATE', field, 'This certification grade has no DATE CERTIFIED, so it is not imported. It stays in the source row.'); return; }
        const r = TlRules.round2(v);
        if (r !== v) warn('GRADE_ROUNDED', field, 'The grade has more than 2 decimals and is rounded half up.');
        gradeRows.push({
          field: field, component_id: lists.components[componentName] || '', score: r, assessed_on: on, retake_no: retakeNo,
          assessed_by: by, legacy_ref: legacyRef + ':' + field,
        });
      };
      const entryUser = entryBy.kind === 'user' ? entryBy.user.id : '';
      Object.keys(ENTRY_COMPONENT).forEach((f) => addGrade(f, ENTRY_COMPONENT[f], 0, entry.state === 'value' ? entry.value : '', entryUser));
      Object.keys(CERT_COMPONENT).forEach((f) => addGrade(f, CERT_COMPONENT[f], 1, certDate, ''));
      if (entry.state === 'value') {
        const deadline = deadlineGiven !== undefined ? deadlineGiven : TlRules.deadline(entry.value, lists.months(entry.value));
        const closedWithDate = status === 'Certified' || status === 'Promoted';
        const fields = {
          mother_location_id: store ? store.id : '', entry_date: entry.value, deadline: deadline, status: status || '',
          weights_version: 'LEGACY', legacy_ref: legacyRef,
        };
        if (support) fields.support_location_id = support.id;
        if (station) fields.station_id = station.id;
        if (tidy(rec.batch) !== '') fields.batch_code = tidy(rec.batch);
        if (closeReason === 'Disqualified' && lists.disqualifiedId) fields.close_reason_id = lists.disqualifiedId;
        if (closedWithDate && certDate) fields.certified_on = certDate;
        if (average !== undefined) fields.final_grade = average;
        if (notes.length) fields.remarks = notes.map((n) => 'Legacy note: ' + n).join('; ').slice(0, 2000);
        item.plan = {
          person: group && group.ok ? {
            legacy_ref: group.legacy_ref, last_name: group.parts.last, first_name: group.parts.first, middle_name: group.parts.middle,
            suffix: group.parts.suffix, spellings: group.spellings,
          } : null,
          enrollment: fields,
          grades: gradeRows,
          officers: officers,
          status_date: fields.certified_on || entry.value,
        };
      }
      const prior = (refsByRow[rec.row] || []).filter((r) => r !== legacyRef);
      item._prior = prior.length > 0;
      item._skip = skips[legacyRef] || '';
      return item;
    });

    // ---- second pass: one open enrollment per person (RULE-100: only Failed, Quit and Promoted are closed)
    const open = {};
    rows.forEach((r) => {
      if (r.result === 'ALREADY_COMMITTED' || r._skip || r._group === null || !r.planned_status) return;
      if (TlRules.CLOSED.indexOf(r.planned_status) >= 0) return;
      (open[r._group] = open[r._group] || []).push(r);
    });
    Object.keys(open).forEach((root) => {
      const info = groupInfo[root];
      const existing = info.members.reduce((n, k) => n + (openByPerson['LEGACY:' + k] || 0), 0);
      if (existing + open[root].length < 2) return;
      open[root].forEach((r) => r.issues.push({ code: 'OPEN_TWICE', field: 'result', message: 'This person would have two open enrollments. An officer skips or corrects one row.' }));
    });

    return rows.map((r) => {
      if (r.result !== 'ALREADY_COMMITTED') {
        if (r._prior) r.issues.push({ code: 'CHANGED_AFTER_COMMIT', field: '', message: 'This row number was imported before with other content. It is not imported again.' });
        if (r._skip) { r.result = 'SKIPPED'; r.skip_reason = r._skip; }
        else r.result = r.issues.length ? 'NOT_READY' : 'READY';
        if (r.result !== 'READY') r.plan = null;
      }
      delete r._group; delete r._open; delete r._prior; delete r._skip;
      return r;
    });
  }

  // Counts by result, and by issue code (rows that carry the code).
  function summarize(items) {
    const byResult = { READY: 0, NOT_READY: 0, SKIPPED: 0, COMMITTED: 0, ALREADY_COMMITTED: 0 };
    const byIssue = {};
    items.forEach((it) => {
      byResult[it.result] = (byResult[it.result] || 0) + 1;
      const seen = {};
      (it.issues || []).forEach((i) => { if (!seen[i.code]) { seen[i.code] = true; byIssue[i.code] = (byIssue[i.code] || 0) + 1; } });
    });
    return { by_result: byResult, by_issue: byIssue };
  }

  // ---- the reconciliation (spec 10.6) -------------------------------------------------------------------------------
  // rows: the import rows of the batch, each with `legacy_result` (the RESULT text), `planned_status`, `planned_close_reason`,
  // `tlmi_status` and `tlmi_close_reason` (of the created enrollment, for a committed row) and `result`, `skip_reason`.
  function reconcile(batch, rows) {
    const summary = summarize(rows.map((r) => ({ result: r.result, issues: r.issues || [] })));
    const legacy = {};
    const expected = {};
    const actual = {};
    let expectedDisq = 0;
    let actualDisq = 0;
    let unresolved = 0;
    rows.forEach((r) => {
      const word = tidy(r.legacy_result).toUpperCase() || '(blank)';
      legacy[word] = (legacy[word] || 0) + 1;
      const done = r.result === 'COMMITTED' || r.result === 'ALREADY_COMMITTED';
      if (!done) { if (r.result !== 'SKIPPED' || !tidy(r.skip_reason)) unresolved++; return; }
      const want = r.planned_status || null;
      if (want) { expected[want] = (expected[want] || 0) + 1; if (r.planned_close_reason === 'Disqualified') expectedDisq++; }
      else expected['(unmapped)'] = (expected['(unmapped)'] || 0) + 1;
      const got = r.tlmi_status || '(missing)';
      actual[got] = (actual[got] || 0) + 1;
      if (r.tlmi_close_reason === 'Disqualified') actualDisq++;
    });
    const statuses = Array.from(new Set(Object.keys(expected).concat(Object.keys(actual)))).sort();
    const table = statuses.map((s) => ({ status: s, expected: expected[s] || 0, actual: actual[s] || 0, agree: (expected[s] || 0) === (actual[s] || 0) }));
    const disq = { expected: expectedDisq, actual: actualDisq, agree: expectedDisq === actualDisq };
    const countAgree = table.every((t) => t.agree) && disq.agree;
    const total = rows.length;
    return {
      source_rows: batch && batch.source_row_count !== undefined && batch.source_row_count !== null ? batch.source_row_count : total,
      by_result: summary.by_result,
      by_issue: summary.by_issue,
      legacy_result_counts: legacy,
      tlmi_status_counts: actual,
      status_table: table,
      failed_disqualified: disq,
      unresolved_rows: unresolved,
      reconciled: total > 0 && unresolved === 0 && countAgree && (!batch || batch.source_row_count === undefined || batch.source_row_count === null || batch.source_row_count === total),
    };
  }

  // ---- reading the sources ------------------------------------------------------------------------------------------
  function readTabObjects(reviewId, tab) {
    const v = Repository.readExternal(reviewId, tab, { optional: true });
    if (!v || v.length < 2) return [];
    const h = v[0];
    return v.slice(1).map((r) => {
      const o = {};
      h.forEach((c, i) => { o[c] = r[i] === undefined ? '' : r[i]; });
      return o;
    });
  }

  // The officers' decisions in the four decision tabs of the review sheet.
  function readDecisions(reviewId, nameLists) {
    const persons = {};
    readTabObjects(reviewId, 'persons_proposed').forEach((r) => {
      const k = norm(r.proposed_name);
      if (!k) return;
      persons[k] = {
        decision: r.decision, corrected_value: r.corrected_value, last: r.proposed_last_name, first: r.proposed_first_name,
        middle: r.proposed_middle_name, suffix: r.proposed_suffix, flagged: tidy(r.needs_review) !== '',
      };
    });
    const duplicates = readTabObjects(reviewId, 'possible_duplicates').map((r) => ({
      name_a: r.name_a, name_b: r.name_b, decision: r.decision, flagged: tidy(r.needs_review) !== '',
    }));
    const bad = {};
    readTabObjects(reviewId, 'bad_values').forEach((r) => {
      bad[badKey(r.source_row, r.column, r.code)] = { decision: r.decision, corrected_value: r.corrected_value, flagged: tidy(r.needs_review) !== '' };
    });
    const al = ImportReviewService.readAliases(reviewId, nameLists);
    return { persons: persons, duplicates: duplicates, bad: bad, aliases: al.aliases };
  }

  function buildLists(reader, today) {
    const stores = reader.all('locations').filter((l) => l.is_active && l.location_type === 'Store').map((l) => ({ id: l.id, name: l.name, brand_id: l.brand_id }));
    const stations = reader.all('stations').filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name, brand_id: s.brand_id }));
    const officers = reader.all('users').filter((u) => u.is_active).map((u) => ({ id: u.id, display_name: u.display_name }));
    const components = {};
    reader.all('assessment_components').forEach((c) => { components[c.name] = c.id; });
    Object.keys(ENTRY_COMPONENT).map((f) => ENTRY_COMPONENT[f]).concat(Object.keys(CERT_COMPONENT).map((f) => CERT_COMPONENT[f])).forEach((n) => {
      if (!components[n]) throw Errors.configMissing('assessment component ' + n);
    });
    const dq = reader.all('lookups').find((l) => l.category === 'tl_close_reason' && l.is_active && norm(l.value) === 'DISQUALIFIED');
    const cfg = SettingsService.versions('CFG-040');
    if (!cfg.length) throw Errors.configMissing('CFG-040');
    const months = (iso) => {
      const inForce = cfg.filter((r) => r.effective_from <= iso);
      return Number((inForce.length ? inForce[inForce.length - 1] : cfg[0]).value);
    };
    return { today: today, stores: stores, stations: stations, officers: officers, components: components, disqualifiedId: dq ? dq.id : '', months: months, cfg040: cfg.map((r) => [r.version, r.effective_from, r.value]) };
  }

  // Everything the plan reads that does not change while a commit runs. Read once per call, through the repository.
  function gather() {
    const ids = ImportReviewService.sourceIds();
    const master = ImportReviewService.readMasterLog(Repository.readExternal(ids.legacy, TAB));
    const lists = buildLists(Repository, Clock.today());
    const decisions = readDecisions(ids.review, {
      stores: lists.stores.map((s) => s.name), stations: lists.stations.map((s) => s.name), users: lists.officers.map((u) => u.display_name),
    });
    // A fingerprint of every input, kept in the batch. A commit whose inputs differ from the validated ones is refused.
    const material = JSON.stringify([
      master.map((r) => [r.row, rowHash(r)]), decisions,
      lists.today, lists.stores, lists.stations, lists.officers, lists.components, lists.disqualifiedId, lists.cfg040,
    ]);
    return { master: master, lists: lists, decisions: decisions, fingerprint: ImportRules.hash(material) + ImportRules.hash('#' + material) };
  }

  // What is already in TLMI_DB: committed enrollments by legacy_ref, carried skips, open enrollments of imported persons.
  function readState(reader) {
    const state = { enrollmentsByRef: {}, refsByRow: {}, skips: {}, openByPerson: {} };
    const personRef = {};
    reader.all('persons').forEach((p) => { if (p.legacy_ref) personRef[p.id] = p.legacy_ref; });
    reader.all('tl_enrollments').forEach((e) => {
      const m = /^MASTER_LOG!(\d+)#/.exec(e.legacy_ref || '');
      if (m) {
        state.enrollmentsByRef[e.legacy_ref] = { id: e.id, status: e.status };
        (state.refsByRow[Number(m[1])] = state.refsByRow[Number(m[1])] || []).push(e.legacy_ref);
      }
      const ref = personRef[e.person_id];
      if (ref && TlRules.CLOSED.indexOf(e.status) < 0) state.openByPerson[ref] = (state.openByPerson[ref] || 0) + 1;
    });
    reader.all('import_rows').forEach((r) => { if (r.result === 'SKIPPED' && r.legacy_ref) state.skips[r.legacy_ref] = r.skip_reason; });
    return state;
  }

  // ---- reading import rows ------------------------------------------------------------------------------------------
  function parseJson(text, fallback) {
    try { return text ? JSON.parse(text) : fallback; } catch (e) { return fallback; }
  }
  function packed(item) {
    return JSON.stringify({ issues: item.issues, warnings: item.warnings, planned: { status: item.planned_status, close_reason: item.planned_close_reason } });
  }
  function unpacked(row) {
    const x = parseJson(row.issues, {});
    return { issues: x.issues || [], warnings: x.warnings || [], planned: x.planned || { status: null, close_reason: '' } };
  }

  function latestBatch(reader) {
    const list = reader.all('import_batches').filter((b) => b.kind === KIND);
    return list.length ? list[list.length - 1] : null;
  }

  function batchView(b, latest) {
    return {
      id: b.id, kind: b.kind, status: b.status, row_version: b.row_version, source_row_count: b.source_row_count,
      started_at: b.started_at, finished_at: b.finished_at, is_latest: !!latest && latest.id === b.id,
    };
  }

  function needBatch(reader, id) {
    const b = reader.get('import_batches', id);
    if (!b || b.kind !== KIND) throw Errors.notFound('Import batch not found.');
    return b;
  }

  function rowView(r) {
    const u = unpacked(r);
    const raw = parseJson(r.raw, {});
    return {
      id: r.id, row_version: r.row_version, import_id: r.import_id, source_row: r.source_row, result: r.result, legacy_ref: r.legacy_ref,
      full_name: raw.full_name || '', entry_date: raw.entry_date || '', legacy_result: raw.result || '',
      issues: u.issues, warnings: u.warnings, skip_reason: r.skip_reason, created_record_id: r.created_record_id,
      issue_codes: u.issues.map((i) => i.code).join(' '),
    };
  }

  // The rows of a batch with what the reconciliation needs from the created enrollments.
  function reconcileRows(reader, batchId) {
    const enrollments = {};
    reader.all('tl_enrollments').forEach((e) => { enrollments[e.id] = e; });
    const lookups = {};
    reader.all('lookups').forEach((l) => { lookups[l.id] = l.value; });
    return reader.all('import_rows').filter((r) => r.import_id === batchId).sort((a, b) => a.source_row - b.source_row).map((r) => {
      const u = unpacked(r);
      const raw = parseJson(r.raw, {});
      const e = r.created_record_id ? enrollments[r.created_record_id] : null;
      return {
        result: r.result, issues: u.issues, skip_reason: r.skip_reason, legacy_result: raw.result || '',
        planned_status: u.planned.status, planned_close_reason: u.planned.close_reason,
        tlmi_status: e ? e.status : '', tlmi_close_reason: e && e.close_reason_id ? lookups[e.close_reason_id] || '' : '',
      };
    });
  }

  // ---- the methods --------------------------------------------------------------------------------------------------
  const actorOf = (ctx) => ({ userId: ctx.userId, now: ctx.now });

  function validate(ctx) {
    const g = gather();
    return Repository.transact((uow) => {
      const items = plan(g.master, g.decisions, g.lists, readState(uow));
      uow.all('import_batches').filter((b) => b.kind === KIND && b.status === 'Validated').forEach((b) => {
        uow.update('import_batches', b.id, { status: 'Superseded' }, { expectedVersion: b.row_version, actor: actorOf(ctx) });
      });
      const counts = summarize(items);
      const batch = uow.insert('import_batches', {
        kind: KIND, status: 'Validated', source_row_count: items.length,
        counts: JSON.stringify(Object.assign({ input_hash: g.fingerprint }, counts)), started_at: ctx.now, finished_at: Clock.iso(),
      }, actorOf(ctx));
      items.forEach((it) => {
        const row = {
          import_id: batch.id, source_tab: TAB, source_row: it.source_row, row_hash: it.row_hash,
          raw: JSON.stringify(g.master.find((m) => m.row === it.source_row)), result: it.result, issues: packed(it), legacy_ref: it.legacy_ref,
        };
        if (it.skip_reason) row.skip_reason = it.skip_reason;
        if (it.created_record_id) { row.created_record_type = 'tl_enrollments'; row.created_record_id = it.created_record_id; }
        uow.insert('import_rows', row, actorOf(ctx));
      });
      AuditService.event(uow, ctx, { event: 'IMPORT.VALIDATED', entity: 'import_batches', entityId: batch.id, detail: Object.assign({ source_rows: items.length }, counts) });
      return { import_id: batch.id, counts: counts };
    });
  }

  function get(ctx, p) {
    const latest = latestBatch(Repository);
    const b = p.import_id ? needBatch(Repository, p.import_id) : latest;
    if (!b) return { batch: null, counts: null, reconciliation: null };
    const rows = reconcileRows(Repository, b.id);
    const rec = reconcile(b, rows);
    return { batch: batchView(b, latest), counts: { by_result: rec.by_result, by_issue: rec.by_issue }, reconciliation: rec };
  }

  function rowsList(ctx, p) {
    needBatch(Repository, p.import_id);
    const rows = Repository.all('import_rows').filter((r) => r.import_id === p.import_id).map(rowView);
    const res = Lists.run(rows, p, { filters: ['result'], search: ['full_name', 'issue_codes'], sortable: ['source_row'], defaultSort: 'source_row' });
    return Api.paged(res.items.map((r) => { const c = Object.assign({}, r); delete c.issue_codes; return c; }), res.page);
  }

  function rowsSkip(ctx, p) {
    const reason = tidy(p.skip_reason);
    if (!reason) throw Errors.validation([{ path: 'skip_reason', code: 'REQUIRED', message: 'A reason is required.' }]);
    return Repository.transact((uow) => {
      const row = uow.get('import_rows', p.id);
      if (!row) throw Errors.notFound();
      uow.update('import_rows', p.id, {}, { expectedVersion: p.row_version, actor: actorOf(ctx) });
      const batch = needBatch(uow, row.import_id);
      if (batch.status !== 'Validated' && batch.status !== 'Committing') {
        throw Errors.validation([{ path: 'id', code: 'STATE', message: 'Only a row of the latest validated batch can be skipped.' }]);
      }
      if (row.result !== 'READY' && row.result !== 'NOT_READY') {
        throw Errors.validation([{ path: 'id', code: 'STATE', message: 'Only a READY or NOT_READY row can be skipped.' }]);
      }
      uow.update('import_rows', p.id, { result: 'SKIPPED', skip_reason: reason }, { expectedVersion: p.row_version, actor: actorOf(ctx) });
      AuditService.event(uow, ctx, { event: 'IMPORT.ROW_SKIPPED', entity: 'import_rows', entityId: p.id, detail: { import_id: row.import_id, source_row: row.source_row, skip_reason: reason } });
      return rowView(uow.get('import_rows', p.id));
    });
  }

  const ID = { id: { type: 'text', required: true, max: 40 } };

  function methods() {
    return {
      'import.validate': { kind: 'W', params: {}, handler: validate },
      'import.get': { kind: 'R', params: { import_id: { type: 'text', max: 40 } }, handler: get },
      'import.rows.list': { kind: 'R', params: Object.assign({ import_id: { type: 'text', required: true, max: 40 } }, Lists.PARAMS), handler: rowsList },
      'import.rows.skip': {
        kind: 'W',
        params: Object.assign({ row_version: { type: 'int', required: true }, skip_reason: { type: 'text', required: true, max: 500 } }, ID),
        handler: rowsSkip,
      },
    };
  }

  return {
    methods: methods, plan: plan, reconcile: reconcile, summarize: summarize, rowHash: rowHash,
    _internals: { gather: gather, readState: readState, latestBatch: latestBatch, needBatch: needBatch, batchView: batchView, packed: packed, unpacked: unpacked, reconcileRows: reconcileRows, actorOf: actorOf, parseJson: parseJson, CHUNK_ROWS: CHUNK_ROWS, CHUNKS_PER_CALL: CHUNKS_PER_CALL, KIND: KIND, TAB: TAB },
  };
})();
