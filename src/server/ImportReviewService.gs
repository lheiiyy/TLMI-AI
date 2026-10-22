// Dry-run review of the legacy MASTER_LOG and UNIFORM_LOG (spec section 10). Reads a copy of the legacy sheet
// (LEGACY_COPY_ID) and writes only to a separate review sheet (REVIEW_SHEET_ID). In TLMI_DB only import_batches,
// id_counters and audit_log change. Nothing is merged or corrected here: problems and proposals are listed for officers.
const ImportReviewService = (function () {
  const TAIL = ['row_key', 'decision', 'corrected_value', 'decided_by', 'decided_on', 'needs_review'];
  const TABS = {
    persons_proposed: ['proposed_name', 'spellings', 'enrollments', 'entry_dates', 'source_rows',
      'proposed_last_name', 'proposed_first_name', 'proposed_middle_name', 'proposed_suffix'],
    possible_duplicates: ['name_a', 'name_b', 'reason', 'source_rows_a', 'source_rows_b'],
    name_mapping: ['kind', 'raw_value', 'normalized', 'status', 'match', 'candidates', 'note', 'occurrences', 'source_rows'],
    bad_values: ['source_tab', 'source_row', 'column', 'raw_value', 'code', 'proposed'],
    uniform_split: ['source', 'source_row', 'full_name', 'store', 'item', 'size', 'quantity', 'dr_no', 'issued_on', 'given_by'],
  };
  // The row key hashes only the first KEY_CELLS cells of a row, so that columns added later (the proposed name parts) do not
  // change the key of a row and every earlier decision stays attached to it. A tab not listed hashes all its cells.
  const KEY_CELLS = { persons_proposed: 5 };
  // Header text (upper case, trimmed, spaces collapsed) -> field name. The first column has no header.
  const HEADERS = {
    'DATE OF ENTRY': 'entry_date', 'BATCH #': 'batch', 'MOTHER STORE': 'mother_store', 'FULL NAME': 'full_name',
    'MOTHER STATION': 'mother_station', 'SUPPORT STORE': 'support_store', 'RESULT': 'result', 'UNIFORM RELEASE': 'uniform_release',
    'ENTRY BY': 'entry_by', 'ISTV GRADE': 'istv', 'TECHVAL FP': 'techval_fp', 'TECHVAL PM': 'techval_pm',
    'TL-ENTRY FOOD PREP EXAM': 'exam_fp', 'TL-ENTRY PIZZA MAKER EXAM': 'exam_pm', 'TL ENTRY AVERAGE': 'entry_average',
    'CERTIFICATION DEADLINE': 'cert_deadline', 'CERT BY:': 'cert_by', 'CERT BY': 'cert_by', 'DATE CERTIFIED': 'date_certified',
    'CERTFICATION GRADE': 'cert_grade', 'CERTIFICATION GRADE': 'cert_grade', 'EXAM GRADE': 'exam_grade', 'AVERAGE': 'cert_average',
    'STATUS': 'status',
  };
  const REQUIRED_HEADERS = ['DATE OF ENTRY', 'MOTHER STORE', 'FULL NAME', 'RESULT'];
  const SIZES = ['XSMALL', 'SMALL', 'MEDIUM', 'LARGE', 'XLARGE', 'XXLARGE', '2XLARGE'];

  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');
  const headerKey = (h) => tidy(h).toUpperCase();
  const isBlankRow = (r) => r.every((c) => tidy(c) === '');

  function sourceIds() {
    const legacy = Props.get('LEGACY_COPY_ID');
    const review = Props.get('REVIEW_SHEET_ID');
    if (!legacy) throw Errors.configMissing('LEGACY_COPY_ID');
    if (!review) throw Errors.configMissing('REVIEW_SHEET_ID');
    return { legacy: legacy, review: review };
  }

  // Rows of MASTER_LOG as objects of raw text, with their sheet row number.
  function readMasterLog(values) {
    if (!values.length) throw Errors.validation([{ path: 'MASTER_LOG', code: 'EMPTY', message: 'MASTER_LOG has no rows.' }]);
    const fields = values[0].map((h, i) => (i === 0 && tidy(h) === '' ? 'form_timestamp' : HEADERS[headerKey(h)] || null));
    REQUIRED_HEADERS.forEach((h) => {
      if (fields.indexOf(HEADERS[h]) < 0) throw Errors.validation([{ path: 'MASTER_LOG', code: 'HEADER_MISSING', message: 'MASTER_LOG has no column ' + h + '.' }]);
    });
    const rows = [];
    values.slice(1).forEach((r, i) => {
      if (isBlankRow(r)) return;
      const rec = { row: i + 2 };
      fields.forEach((f, c) => { if (f) rec[f] = tidy(r[c]); });
      rows.push(rec);
    });
    return rows;
  }

  function readUniformLog(values) {
    if (!values || !values.length) return [];
    const head = values[0].map(headerKey);
    const col = (name) => head.indexOf(name);
    const idx = { ts: col('TIMESTAMP'), name: col('FULL NAME'), store: col('MOTHER STORE'), size: col('SIZE'), qty: col('QUANTITY'), dr: col('DR #'), by: col('GIVEN BY') };
    const at = (r, i) => (i >= 0 ? tidy(r[i]) : '');
    const rows = [];
    values.slice(1).forEach((r, i) => {
      if (isBlankRow(r)) return;
      rows.push({ row: i + 2, ts: at(r, idx.ts), name: at(r, idx.name), store: at(r, idx.store), size: at(r, idx.size), qty: at(r, idx.qty), dr: at(r, idx.dr), by: at(r, idx.by) });
    });
    return rows;
  }

  // Confirmed aliases from the previous review (decision "confirm" on a name_mapping row). An alias is made only from
  // a typed corrected_value, or the match, or a single candidate, and the target must be an active master record of that
  // kind. Otherwise there is no alias and the row says why (CONFIRM_NEEDS_VALUE or ALIAS_TARGET_UNKNOWN). Nothing is guessed.
  function readAliases(reviewId, lists) {
    const out = { aliases: { store: {}, station: {}, officer: {} }, notes: {} };
    const old = Repository.readExternal(reviewId, 'name_mapping', { optional: true });
    if (!old || old.length < 2) return out;
    const masters = { store: lists.stores, station: lists.stations, officer: lists.users };
    const h = old[0];
    const i = (n) => h.indexOf(n);
    old.slice(1).forEach((r) => {
      if (tidy(r[i('decision')]).toLowerCase() !== 'confirm') return;
      const kind = r[i('kind')];
      const raw = tidy(r[i('raw_value')]);
      if (!masters[kind]) return;
      const cands = tidy(r[i('candidates')]) === '' ? [] : tidy(r[i('candidates')]).split(' | ');
      const target = tidy(r[i('corrected_value')]) || tidy(r[i('match')]) || (cands.length === 1 ? cands[0] : '');
      if (!target) { out.notes[kind + '|' + raw] = 'CONFIRM_NEEDS_VALUE'; return; }
      const hit = masters[kind].find((m) => ImportRules.normalizeName(m) === ImportRules.normalizeName(target));
      if (!hit) { out.notes[kind + '|' + raw] = 'ALIAS_TARGET_UNKNOWN'; return; }
      out.aliases[kind][raw] = hit;
    });
    return out;
  }

  function build(master, uniform, lists, aliases, today) {
    const bad = [];       // { id, cells }
    const mapping = new Map();
    const persons = new Map();
    const uniformRows = [];
    const statusCounts = {};
    let notMapped = 0, disq = 0, supportNone = 0;
    // The identity of a problem is its cell (source, row, column), not its code, so a value that changes from one
    // problem to another is a changed row, not a new one. A second problem in one cell gets a counter.
    const usedIds = new Set();
    const addBad = (tab, row, column, raw, code, proposed) => {
      const base = 'bad_values|' + tab + ':' + row + ':' + column;
      let id = base;
      for (let n = 2; usedIds.has(id); n++) id = base + ':' + n;
      usedIds.add(id);
      bad.push({ id: id, cells: [tab, row, column, raw, code, proposed === undefined ? '' : String(proposed)] });
    };
    const note = (kind, raw, row) => {
      const text = tidy(raw);
      if (text === '' || /^(NONE|N\/A)$/i.test(text)) return;
      const k = kind + '|' + text;
      if (!mapping.has(k)) mapping.set(k, { kind: kind, raw: text, count: 0, rows: [] });
      const m = mapping.get(k);
      m.count++;
      if (m.rows.indexOf(row) < 0) m.rows.push(row);
    };

    master.forEach((rec) => {
      ImportRules.checkRow(rec, today).forEach((i) => addBad('MASTER_LOG', rec.row, i.field, i.raw, i.code, i.proposed));
      // status
      const st = ImportRules.mapStatus(rec.result, rec.status);
      if (st.issue) {
        notMapped++;
        if (st.issue === 'UNKNOWN_STATUS') addBad('MASTER_LOG', rec.row, 'result', rec.result, st.issue);
      } else {
        statusCounts[st.status] = (statusCounts[st.status] || 0) + 1;
        if (st.closeReason === 'Disqualified') disq++;
      }
      if (st.statusIssue) addBad('MASTER_LOG', rec.row, 'status', rec.status, st.statusIssue);
      // names to map
      note('store', rec.mother_store, rec.row);
      if (/^(NONE|N\/A)$/i.test(rec.support_store || '')) supportNone++;
      note('store', rec.support_store, rec.row);
      note('station', rec.mother_station, rec.row);
      note('officer', rec.entry_by, rec.row);
      String(rec.cert_by || '').split('|').forEach((p) => note('officer', p, rec.row));
      // persons
      const n = ImportRules.normalizeName(rec.full_name);
      if (n !== '') {
        if (!persons.has(n)) persons.set(n, { n: n, spellings: [], dates: [], rows: [] });
        const p = persons.get(n);
        if (p.spellings.indexOf(rec.full_name) < 0) p.spellings.push(rec.full_name);
        const d = ImportRules.parseDate(rec.entry_date, today);
        p.dates.push(d.iso || rec.entry_date);
        p.rows.push(rec.row);
      }
      // uniform cell
      const split = ImportRules.splitUniform(rec.uniform_release);
      split.items.forEach((it, k) => {
        uniformRows.push({ id: 'uniform_split|MASTER_LOG:' + rec.row + ':' + (k + 1),
          cells: ['MASTER_LOG', rec.row, rec.full_name, rec.mother_store, '', it.size, it.qty, it.drNo || '', '', rec.entry_by] });
      });
      split.issues.forEach((is) => addBad('MASTER_LOG', rec.row, 'uniform_release', is.part, is.code));
    });

    uniform.forEach((u) => {
      note('store', u.store, u.row);
      note('officer', u.by, u.row);
      const size = u.size.toUpperCase();
      const sizeOk = SIZES.indexOf(size) >= 0;
      const qtyOk = /^\d+$/.test(u.qty) && Number(u.qty) >= 1;
      if (!sizeOk) addBad('UNIFORM_LOG', u.row, 'size', u.size, 'UNKNOWN_SIZE');
      if (!qtyOk) addBad('UNIFORM_LOG', u.row, 'quantity', u.qty, 'BAD_QUANTITY');
      if (sizeOk && qtyOk) {
        const d = ImportRules.parseDate(u.ts.split(' ')[0], today);
        uniformRows.push({ id: 'uniform_split|UNIFORM_LOG:' + u.row + ':1',
          cells: ['UNIFORM_LOG', u.row, u.name, u.store, '', size, Number(u.qty), u.dr, d.iso || '', u.by] });
      }
    });

    // name_mapping rows
    const mapRows = [];
    const counts = { exact: 0, candidate: 0, none: 0 };
    Array.from(mapping.values()).sort((a, b) => (a.kind + a.raw < b.kind + b.raw ? -1 : 1)).forEach((m) => {
      let r;
      const al = aliases.aliases[m.kind] || {};
      if (m.kind === 'officer') {
        r = ImportRules.looksLikeNote(m.raw) ? { status: 'none', note: 'LOOKS_LIKE_NOTE' }
          : (al[m.raw] ? { status: 'exact', match: al[m.raw], via: 'alias' } : ImportRules.matchOfficer(m.raw, lists.users));
      } else {
        r = ImportRules.matchMaster(m.raw, m.kind === 'store' ? lists.stores : lists.stations, al);
      }
      counts[r.status]++;
      const why = r.note || (r.status === 'exact' ? '' : aliases.notes[m.kind + '|' + m.raw] || '');
      mapRows.push({ id: 'name_mapping|' + m.kind + ':' + m.raw,
        cells: [m.kind, m.raw, ImportRules.normalizeName(m.raw), r.status, r.match || '', (r.candidates || []).join(' | '), why, m.count, m.rows.slice(0, 20).join(', ')] });
    });

    // persons and duplicates
    const personRows = Array.from(persons.values()).sort((a, b) => (a.n < b.n ? -1 : 1)).map((p) => {
      const np = ImportRules.proposeNameParts(p.spellings[0]);
      return {
        id: 'persons_proposed|' + p.n,
        cells: [p.n, p.spellings.join(' | '), p.rows.length, p.dates.slice().sort().join(' | '), p.rows.join(', '), np.last, np.first, np.middle, np.suffix],
      };
    });
    const rowsOf = (name) => (persons.get(ImportRules.normalizeName(name)) || { rows: [] }).rows.join(', ');
    const allNames = [];
    persons.forEach((p) => allNames.push(p.spellings[0]));
    const dupRows = ImportRules.findDuplicates(allNames).map((d) => ({
      id: 'possible_duplicates|' + ImportRules.normalizeName(d.a) + '~' + ImportRules.normalizeName(d.b),
      cells: [d.a, d.b, d.reason, rowsOf(d.a), rowsOf(d.b)],
    }));

    const byCode = {};
    bad.forEach((b) => { byCode[b.cells[4]] = (byCode[b.cells[4]] || 0) + 1; });
    const summary = [['source_rows.master_log', master.length], ['source_rows.uniform_log', uniform.length]];
    ['Certified', 'Promoted', 'Quit', 'Extended', 'Probationary', 'Failed'].forEach((s) => summary.push(['status.' + s, statusCounts[s] || 0]));
    summary.push(['status.Failed.of_which_Disqualified', disq], ['status.not_mapped', notMapped]);
    Object.keys(byCode).sort().forEach((c) => summary.push(['problems.' + c, byCode[c]]));
    summary.push(['persons_proposed', personRows.length], ['possible_duplicates', dupRows.length],
      ['name_mapping.exact', counts.exact], ['name_mapping.candidate', counts.candidate], ['name_mapping.none', counts.none],
      ['uniform_split_rows', uniformRows.length], ['support_store.none', supportNone],
      ['hand_kept_summary', 'not compared: the layout of that tab is not specified']);

    return {
      tabs: { persons_proposed: personRows, possible_duplicates: dupRows, name_mapping: mapRows, bad_values: bad, uniform_split: uniformRows },
      summary: summary,
      counts: {
        master_log_rows: master.length, uniform_log_rows: uniform.length, persons_proposed: personRows.length,
        possible_duplicates: dupRows.length, name_mapping: mapRows.length, bad_values: bad.length, uniform_split: uniformRows.length,
        summary: summary.length,
      },
    };
  }

  // Joins the new rows with the decisions already made in the review sheet. A decision is never cleared.
  function withDecisions(tab, rows, oldValues) {
    const header = TABS[tab].concat(TAIL);
    const width = TABS[tab].length;
    const keyCells = KEY_CELLS[tab] || width;
    const keyOf = (r) => r.id + '|' + ImportRules.hash(r.cells.slice(0, keyCells).join('\u0001'));
    const out = [];
    const old = { byKey: new Map(), byId: new Map() };
    if (oldValues && oldValues.length > 1) {
      const h = oldValues[0];
      const pos = (n) => h.indexOf(n);
      oldValues.slice(1).forEach((r) => {
        const key = r[pos('row_key')];
        if (!key) return;
        const rec = {
          // the content is read by column name, so a tab written before columns were added still reads (the new ones are empty)
          key: key, id: key.slice(0, key.lastIndexOf('|')), content: TABS[tab].map((c) => (pos(c) >= 0 ? r[pos(c)] : '')),
          tail: [r[pos('decision')], r[pos('corrected_value')], r[pos('decided_by')], r[pos('decided_on')], r[pos('needs_review')]],
        };
        old.byKey.set(key, rec);
        old.byId.set(rec.id, rec);
      });
    }
    const present = new Set();
    rows.forEach((r) => {
      const key = keyOf(r);
      present.add(r.id);
      let tail = ['', '', '', '', ''];
      const same = old.byKey.get(key);
      const prior = old.byId.get(r.id);
      if (same) {
        // The officer's needs_review is kept (an officer clears it after re-checking). A row that was SOURCE_CHANGED and
        // is back in the source is marked TRUE, so that someone looks once.
        tail = same.tail.slice();
        if (tail[4] === 'SOURCE_CHANGED') tail[4] = 'TRUE';
      } else if (prior && prior.tail.slice(0, 4).some((c) => tidy(c) !== '')) {
        tail = prior.tail.slice(0, 4).concat(['TRUE']);
      }
      out.push(r.cells.map((c) => String(c)).concat([key], tail));
    });
    // a decided row whose source is gone stays, marked
    old.byId.forEach((rec, id) => {
      if (present.has(id) || rec.tail.slice(0, 4).every((c) => tidy(c) === '')) return;
      out.push(rec.content.map((c) => String(c === undefined ? '' : c)).concat([rec.key], rec.tail.slice(0, 4), ['SOURCE_CHANGED']));
    });
    return { header: header, rows: out };
  }

  function run(ctx) {
    const ids = sourceIds();
    const started = ctx.now;
    const today = Clock.today();
    let built;
    let sourceRows = 0;
    try {
      const master = readMasterLog(Repository.readExternal(ids.legacy, 'MASTER_LOG'));
      const uniform = readUniformLog(Repository.readExternal(ids.legacy, 'UNIFORM_LOG', { optional: true }));
      sourceRows = master.length + uniform.length;
      const lists = {
        stores: Repository.all('locations').filter((l) => l.is_active).map((l) => l.name),
        stations: Repository.all('stations').filter((s) => s.is_active).map((s) => s.name),
        users: Repository.all('users').filter((u) => u.is_active).map((u) => u.display_name),
      };
      built = build(master, uniform, lists, readAliases(ids.review, lists), today);
      // everything is built before the first tab is written, so a failure above leaves the old review in place
      Object.keys(TABS).forEach((tab) => {
        const joined = withDecisions(tab, built.tabs[tab], Repository.readExternal(ids.review, tab, { optional: true }));
        Repository.writeReview(ids.review, tab, joined.header, joined.rows);
      });
      Repository.writeReview(ids.review, 'summary', ['metric', 'value'], built.summary);
    } catch (e) {
      const known = e instanceof AppError;
      const message = known ? (e.fields ? e.fields.map((f) => f.message).join(' ') : e.message) : 'Unexpected error.';
      const failed = recordBatch(ctx, started, 'Failed', sourceRows, {}, message);
      if (!known) throw e;
      return { batch_id: failed, status: 'Failed', counts: {}, message: message };
    }
    const batchId = recordBatch(ctx, started, 'Done', sourceRows, built.counts, '');
    return { batch_id: batchId, status: 'Done', counts: built.counts };
  }

  function recordBatch(ctx, started, status, sourceRows, counts, note) {
    return Repository.transact((uow) => {
      const batch = uow.insert('import_batches', {
        kind: 'IMPORT_REVIEW', status: status, source_row_count: sourceRows, counts: JSON.stringify(counts),
        started_at: started, finished_at: Clock.iso(), note: note.slice(0, 500),
      }, { userId: ctx.userId, now: ctx.now });
      AuditService.event(uow, ctx, {
        event: 'IMPORT.REVIEW_RUN', entity: 'import_batches', entityId: batch.id, result: status === 'Done' ? 'OK' : 'FAILED', detail: counts,
      });
      return batch.id;
    });
  }

  function get() {
    const batches = Repository.all('import_batches').filter((b) => b.kind === 'IMPORT_REVIEW');
    if (!batches.length) return { last_run: null, counts: {} };
    const last = batches[batches.length - 1];
    let counts = {};
    try { counts = JSON.parse(last.counts || '{}'); } catch (e) { counts = {}; }
    return {
      last_run: { batch_id: last.id, status: last.status, finished_at: last.finished_at, source_row_count: last.source_row_count, note: last.note },
      counts: counts,
    };
  }

  function methods() {
    return {
      'importReview.run': { kind: 'W', params: {}, handler: run },
      'importReview.get': { kind: 'R', params: {}, handler: get },
    };
  }

  // Shared with ImportService: the same reading of the legacy copy and of the confirmed aliases, so that the validation
  // maps names exactly as the review did.
  return { methods: methods, sourceIds: sourceIds, readMasterLog: readMasterLog, readAliases: readAliases };
})();
