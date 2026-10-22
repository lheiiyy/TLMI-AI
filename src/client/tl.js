// Team Leader screens (Phase 2 spec section 8): the list, enrolling, and the record with its actions and history.
// They call only Api (api.js). Text from the server (names, reasons, messages) goes into the page with textContent
// (through App.h), never as markup. Which buttons show comes from `allowed_actions` in the server's answer: this file
// holds no copy of the transition table or of the role rules. The deadline, the averages, the final grade and the pass
// marks are all the server's values; the browser computes none of them. Hiding a button is not security: the server
// checks the role on every call.
(function () {
  'use strict';

  const A = window.App;
  const { h, clear, tpl, slot, notice, setMessage, errText, grid, fetchAll } = A;

  // The names of the statuses, for the filter only. What a record may do next comes from the server.
  const STATUSES = ['Entry', 'Probationary', 'Certification check', 'Extended', 'Certified', 'Failed', 'Quit', 'Promoted'];
  const PAGE_SIZE = 20;

  const ACTION_LABEL = {
    recordCertCheck: 'Record a certification check', certify: 'Certify', extend: 'Extend the deadline', close: 'Fail',
    quit: 'Record a quit', returnToProbation: 'Return to probation', promote: 'Promote',
  };

  // ---------- small helpers ----------
  const dash = (v) => (v === null || v === undefined || v === '' ? '' : v);
  const num = (v) => (v === null || v === undefined ? '' : String(v));
  const text = (v) => (v === null || v === undefined ? '' : String(v));

  function control(f, value) {
    let el;
    if (f.type === 'select') {
      el = h('select', { name: f.name, required: !!f.required },
        h('option', { value: '' }, f.placeholder || 'Choose...'),
        (f.options || []).map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
    } else if (f.type === 'textarea') {
      el = h('textarea', { name: f.name, required: !!f.required, maxlength: f.max || false });
      el.value = value === undefined || value === null ? '' : String(value);
    } else {
      el = h('input', { name: f.name, type: f.type || 'text', required: !!f.required, maxlength: f.max || false, step: f.type === 'number' ? 'any' : false, min: f.type === 'number' ? '0' : false, max: f.type === 'number' ? '100' : false, autocomplete: 'off' });
      el.value = value === undefined || value === null ? '' : String(value);
    }
    return h('label', { class: 'field', 'data-field': f.name }, h('span', {}, f.label + (f.required ? '' : ' (optional)')), el, f.hint ? h('small', {}, f.hint) : null);
  }

  function valueOf(form, f) {
    const el = form.querySelector('[name="' + f.name + '"]');
    const v = el ? el.value.trim() : '';
    if (v === '') return null;
    return f.type === 'number' ? Number(v) : v;
  }

  function markFieldErrors(form, e) {
    if (!(e && e.code === 'VALIDATION' && e.fields)) return;
    e.fields.forEach((fe) => {
      const wrap = form.querySelector('[data-field="' + String(fe.path).replace(/^(person|patch)\./, '') + '"]');
      if (wrap) { wrap.classList.add('has-error'); wrap.appendChild(h('div', { class: 'error-text' }, fe.message)); }
    });
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.has-error').forEach((x) => x.classList.remove('has-error'));
    form.querySelectorAll('.error-text').forEach((x) => x.remove());
  }

  // The server's message for a refusal; a rule id is added when the server sends one.
  function refusalText(e) {
    const base = errText(e);
    return e && e.rule_id && e.code === 'BLOCKED_BY_RULE' ? base + ' (' + e.rule_id + ')' : base;
  }

  function safeLink(url) {
    const s = text(url).trim();
    if (!/^https?:\/\/[^\s]+$/i.test(s)) return s ? h('span', {}, s) : '';
    return h('a', { href: s, target: '_blank', rel: 'noopener noreferrer' }, s);
  }

  const statusTag = (status, overdue) => h('span', { class: 'tag status' + (overdue ? ' bad' : '') }, status);

  // Reference lists shared by the screens: active stores and stations, and the close and quit reasons.
  async function loadRefs() {
    const [locations, stations, lookups] = await Promise.all([fetchAll('locations.list'), fetchAll('stations.list'), fetchAll('lookups.list')]);
    const stores = locations.filter((l) => l.is_active && l.location_type === 'Store');
    const lookup = (cat) => lookups.filter((l) => l.is_active && l.category === cat).map((l) => ({ value: l.id, label: l.label || l.value }));
    return {
      stores: stores,
      storeOptions: stores.map((s) => ({ value: s.id, label: s.name })),
      stations: stations.filter((s) => s.is_active),
      closeReasons: lookup('tl_close_reason'),
      quitReasons: lookup('tl_quit_reason'),
    };
  }

  // Runs a screen; a failure shows the server's message instead of a blank page.
  function guard(main, promise) {
    return promise.catch((e) => { if (!main.querySelector('.notice.error')) main.appendChild(notice('error', errText(e))); });
  }
  const openRec = (main, id) => { clear(main); return guard(main, renderRecord(main, id)); };
  const openEnroll = (main, refs) => { clear(main); return guard(main, renderEnroll(main, refs)); };

  // ---------- list ----------
  async function renderList(main) {
    const v = tpl('view-tl-list');
    main.appendChild(v);
    const msg = slot(v, 'message');
    const filters = slot(v, 'filters');
    const refs = await loadRefs();
    const fill = (name, opts, first) => {
      const el = filters.querySelector('[name="' + name + '"]');
      el.appendChild(h('option', { value: '' }, first));
      opts.forEach((o) => el.appendChild(h('option', { value: o.value }, o.label)));
    };
    fill('status', STATUSES.map((s) => ({ value: s, label: s })), 'Any status');
    fill('mother_location_id', refs.storeOptions, 'Any store');
    fill('station_id', refs.stations.map((s) => ({ value: s.id, label: s.name })), 'Any station');
    let page = 1;

    async function load() {
      const params = { page: page, page_size: PAGE_SIZE };
      const q = filters.querySelector('[name="q"]').value.trim();
      if (q) params.q = q;
      params.filters = {};
      ['status', 'mother_location_id', 'station_id', 'batch_code'].forEach((n) => {
        const val = filters.querySelector('[name="' + n + '"]').value.trim();
        if (val) params.filters[n] = val;
      });
      ['open', 'overdue'].forEach((n) => { if (filters.querySelector('[name="' + n + '"]').checked) params.filters[n] = true; });
      params.sort = filters.querySelector('[name="sort"]').value;
      setMessage(msg, 'error', '');
      let env;
      try { env = await Api.callFull('tl.list', params); } catch (e) { setMessage(msg, 'error', errText(e)); return; }
      const rows = env.data;
      const total = env.meta.page ? env.meta.page.total : rows.length;
      slot(v, 'count').textContent = total + (total === 1 ? ' record' : ' records');
      const table = grid([
        { label: 'Name', value: (r) => h('button', { type: 'button', class: 'link', 'data-open': r.id, onclick: () => openRec(main, r.id) }, r.name) },
        { label: 'Store', key: 'store' },
        { label: 'Station', key: 'station' },
        { label: 'Batch', value: (r) => dash(r.batch_code) },
        { label: 'Entry date', key: 'entry_date' },
        { label: 'Deadline', value: (r) => h('span', {}, r.deadline, r.overdue ? [' ', h('span', { class: 'tag bad' }, 'Overdue')] : null) },
        { label: 'Status', value: (r) => statusTag(r.status, false) },
        { label: 'Final grade', value: (r) => num(r.final_grade) },
      ], rows, 'No Team Leader records match.');
      table.querySelectorAll('tbody tr').forEach((tr, i) => { if (rows[i] && rows[i].overdue) tr.classList.add('overdue'); });
      const box = slot(v, 'table');
      clear(box);
      box.appendChild(table);
      const pager = slot(v, 'pager');
      clear(pager);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      pager.append(
        h('button', { type: 'button', class: 'secondary small', 'data-pager': 'prev', disabled: page <= 1, onclick: () => { page -= 1; load(); } }, 'Previous'),
        h('span', { class: 'count' }, 'Page ' + page + ' of ' + pages),
        h('button', { type: 'button', class: 'secondary small', 'data-pager': 'next', disabled: page >= pages, onclick: () => { page += 1; load(); } }, 'Next'));
    }

    filters.addEventListener('submit', (ev) => ev.preventDefault());
    filters.addEventListener('change', () => { page = 1; load(); });
    let timer = null;
    filters.querySelectorAll('input[type="search"], input[type="text"]').forEach((el) => el.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { page = 1; load(); }, 250);
    }));
    slot(v, 'enroll').addEventListener('click', () => openEnroll(main, refs));
    await load();
  }

  // ---------- enroll ----------
  async function renderEnroll(main, knownRefs) {
    const refs = knownRefs || await loadRefs();
    const v = tpl('view-tl-enroll');
    main.appendChild(v);
    const msg = slot(v, 'message');
    const form = slot(v, 'form');
    const back = () => A.go('tl');
    slot(v, 'back').addEventListener('click', back);
    slot(v, 'cancel').addEventListener('click', back);
    let chosen = null; // a person found by the duplicate check: { person_id, name }

    const personFields = [
      { name: 'last_name', label: 'Last name', required: true, max: 100 },
      { name: 'first_name', label: 'First name', required: true, max: 100 },
      { name: 'middle_name', label: 'Middle name', max: 100 },
      { name: 'suffix', label: 'Suffix', max: 20 },
      { name: 'hr_employee_no', label: 'HR employee number', max: 20 },
    ];
    const personBox = slot(v, 'person-fields');
    personFields.forEach((f) => personBox.appendChild(control(f)));

    const storeSelect = { name: 'mother_location_id', label: 'Store', type: 'select', required: true, options: refs.storeOptions };
    const enrollFields = [
      storeSelect,
      { name: 'support_location_id', label: 'Support store', type: 'select', options: refs.storeOptions },
      { name: 'station_id', label: 'Station', type: 'select', required: true, options: [] },
      { name: 'batch_code', label: 'Batch', max: 50 },
      { name: 'entry_date', label: 'Entry date', type: 'date', required: true },
      { name: 'remarks', label: 'Remarks', type: 'textarea', max: 2000 },
    ];
    const enrollBox = slot(v, 'enrollment-fields');
    enrollFields.forEach((f) => enrollBox.appendChild(control(f)));
    slot(v, 'deadline-note').textContent = 'The deadline is calculated by the server when you save (the entry date plus the course months in the settings). It is shown on the record.';

    // A station belongs to a brand, and a store has a brand: offer only the stations of the chosen store's brand.
    const storeEl = form.querySelector('[name="mother_location_id"]');
    const stationEl = form.querySelector('[name="station_id"]');
    function fillStations() {
      const store = refs.stores.find((s) => s.id === storeEl.value);
      clear(stationEl);
      stationEl.appendChild(h('option', { value: '' }, store ? 'Choose...' : 'Choose a store first'));
      refs.stations.filter((s) => store && s.brand_id === store.brand_id).forEach((s) => stationEl.appendChild(h('option', { value: s.id }, s.name)));
    }
    storeEl.addEventListener('change', fillStations);
    fillStations();

    const chosenBox = slot(v, 'chosen');
    const candBox = slot(v, 'candidates');
    const warnBox = slot(v, 'warning');
    function showChosen() {
      clear(chosenBox);
      personBox.hidden = !!chosen;
      slot(v, 'find').hidden = !!chosen;
      if (!chosen) return;
      chosenBox.appendChild(notice('ok', 'Existing person: ' + chosen.name + ' ',
        h('button', { type: 'button', class: 'secondary small', 'data-action': 'person.clear', onclick: () => { chosen = null; clear(candBox); showChosen(); } }, 'Choose someone else')));
    }

    function personValues() {
      const p = {};
      personFields.forEach((f) => { const x = valueOf(form, f); if (x !== null) p[f.name] = x; });
      return p;
    }

    function listCandidates(cands, onUse, extra) {
      const list = h('ul', { class: 'candidates' }, cands.map((c) => h('li', {},
        h('span', {}, c.name + ' '), h('span', { class: 'tag' }, c.reason === 'SAME_HR_NO' ? 'Same HR number' : c.reason === 'SAME_NAME' ? 'Same name' : 'Similar name'), ' ',
        h('button', { type: 'button', class: 'secondary small', 'data-use-person': c.person_id, onclick: () => onUse(c) }, 'Use this person'))));
      return h('div', { class: 'panel' }, h('h3', {}, 'Possible matches'), list, extra || null);
    }

    function usePerson(c) { chosen = { person_id: c.person_id, name: c.name }; clear(candBox); clear(warnBox); showChosen(); }

    slot(v, 'find').addEventListener('click', async () => {
      clearFieldErrors(form);
      const p = personValues();
      clear(candBox);
      if (!p.last_name || !p.first_name) { setMessage(msg, 'error', 'Type the last name and the first name first.'); return; }
      setMessage(msg, 'error', '');
      try {
        const params = { last_name: p.last_name, first_name: p.first_name };
        if (p.middle_name) params.middle_name = p.middle_name;
        if (p.hr_employee_no) params.hr_employee_no = p.hr_employee_no;
        const cands = await Api.call('persons.matchCandidates', params);
        candBox.appendChild(cands.length ? listCandidates(cands, usePerson) : notice('ok', 'No similar person is on file.'));
      } catch (e) { setMessage(msg, 'error', errText(e)); }
    });

    const saveBtn = slot(v, 'save');
    async function submit(confirm) {
      clearFieldErrors(form);
      setMessage(msg, 'error', '');
      clear(warnBox);
      const params = {};
      enrollFields.forEach((f) => { const x = valueOf(form, f); if (x !== null) params[f.name] = x; });
      if (chosen) params.person_id = chosen.person_id; else params.person = personValues();
      if (confirm) params.confirm = true;
      saveBtn.disabled = true;
      try {
        const data = await Api.call('tl.enroll', params);
        if (data && data.requires_confirm) {
          saveBtn.disabled = false;
          const w = (data.warnings && data.warnings[0]) || {};
          warnBox.appendChild(listCandidates(w.candidates || [], usePerson, h('div', {},
            h('p', {}, w.message || 'A similar person already exists.'),
            h('button', { type: 'button', 'data-action': 'tl.enroll.confirm', onclick: () => submit(true) }, 'This is a different person'))));
          return;
        }
        clear(main);
        await guard(main, renderRecord(main, data.enrollment.id, 'Enrolled.', data));
      } catch (e) {
        saveBtn.disabled = false;
        markFieldErrors(form, e);
        setMessage(msg, 'error', refusalText(e));
      }
    }
    form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(false); });
    showChosen();
    form.querySelector('input').focus();
  }

  // ---------- record ----------
  async function renderRecord(main, id, okText, known) {
    const v = tpl('view-tl-record');
    main.appendChild(v);
    const msg = slot(v, 'message');
    slot(v, 'back').addEventListener('click', () => A.go('tl'));
    const refs = await loadRefs();
    let serverDate = '';
    let rec = known;
    if (!rec) {
      const env = await Api.callFull('tl.get', { id: id });
      rec = env.data;
      serverDate = env.meta.server_date || '';
    }
    const me = A.user();
    let historyLoaded = false;

    function reloadButton(extra) {
      return h('button', { type: 'button', class: 'secondary small', 'data-action': 'reload', onclick: () => reload() }, extra || 'Reload');
    }

    async function reload(okMessage) {
      try {
        const env = await Api.callFull('tl.get', { id: id });
        rec = env.data;
        serverDate = env.meta.server_date || serverDate;
      } catch (e) { setMessage(msg, 'error', errText(e)); return; }
      historyLoaded = false;
      draw();
      if (okMessage) setMessage(msg, 'ok', okMessage);
      if (!v.querySelector('[data-pane="history"]').hidden) loadHistory(true);
    }

    function tabs() {
      v.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
        const which = b.getAttribute('data-tab');
        v.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
        v.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.getAttribute('data-pane') !== which; });
        if (which === 'history' && !historyLoaded) loadHistory(true);
      }));
    }

    function can(action) { return rec.allowed_actions.indexOf(action) >= 0; }
    function actionButton(action, label, onclick, cls) {
      return can(action) ? h('button', { type: 'button', class: cls || '', 'data-action': 'tl.' + action, onclick: onclick }, label) : null;
    }

    // Only for display: the deadline itself is the server's value; the days left use the server's date when it sent one.
    function daysLeftText(deadline) {
      if (!rec.open || !serverDate || rec.overdue) return '';
      const d = Math.round((Date.parse(deadline + 'T00:00:00Z') - Date.parse(serverDate + 'T00:00:00Z')) / 86400000);
      return ' (' + d + (d === 1 ? ' day left)' : ' days left)');
    }

    function drawHeader() {
      const e = rec.enrollment;
      slot(v, 'title').textContent = rec.person.name;
      const box = slot(v, 'header');
      clear(box);
      const kv = [
        ['Status', h('span', {}, statusTag(e.status, false), rec.overdue ? [' ', h('span', { class: 'tag bad' }, 'Overdue')] : null)],
        ['Store', rec.store], ['Support store', rec.support_store], ['Station', rec.station], ['Batch', dash(e.batch_code)],
        ['Entry date', e.entry_date],
        ['Deadline', h('span', { 'data-field-value': 'deadline', class: rec.overdue ? 'overdue-text' : '' }, e.deadline, daysLeftText(e.deadline))],
        ['Final grade', e.final_grade === null || e.final_grade === undefined ? 'Not yet' : num(e.final_grade) + (rec.pass_mark !== null && rec.pass_mark !== undefined ? ' (pass mark ' + rec.pass_mark + ')' : '')],
        ['Entry average', rec.entry.average === null || rec.entry.average === undefined ? recorded() + ' of ' + rec.entry.required.length + ' recorded' : num(rec.entry.average)],
      ];
      if (e.visit_report_url) kv.push(['Visit report', safeLink(e.visit_report_url)]);
      if (e.remarks) kv.push(['Remarks', e.remarks]);
      box.appendChild(h('dl', { class: 'kv' }, kv.map((p) => [h('dt', {}, p[0]), h('dd', {}, p[1])])));
    }

    function recorded() { return rec.entry.required.filter((c) => gradeFor(c.id)).length; }
    function gradeFor(componentId) { return rec.entry.grades.find((g) => g.component_id === componentId); }

    function drawEntryGrades() {
      const box = slot(v, 'entry-grades');
      clear(box);
      box.appendChild(h('h2', {}, 'Entry grades'));
      box.appendChild(h('p', { class: 'count' }, recorded() + ' of ' + rec.entry.required.length + ' recorded'));
      const rows = rec.entry.required.map((c) => ({ comp: c, grade: gradeFor(c.id) }));
      box.appendChild(grid([
        { label: 'Component', value: (r) => r.comp.name },
        { label: 'Score', value: (r) => (r.grade ? num(r.grade.score) : 'Not recorded') },
        { label: 'Date', value: (r) => (r.grade ? r.grade.assessed_on : '') },
        { label: 'Recorded by', value: (r) => (r.grade ? text(r.grade.assessed_by_name) : '') },
        { label: 'Action', value: (r) => actionButton('recordEntryGrade', r.grade ? 'Correct' : 'Record', () => entryGradeForm(r.comp, r.grade), 'secondary small') },
      ], rows, 'No entry components are set up.'));
      const course = rec.course_program;
      box.appendChild(h('h3', {}, 'TL course program grade'));
      box.appendChild(h('p', { 'data-slot': 'course' }, course
        ? num(course.score) + ' on ' + course.assessed_on + (rec.course_pass_mark !== null && rec.course_pass_mark !== undefined ? ' (course pass mark ' + rec.course_pass_mark + ')' : '')
        : 'Not recorded yet. It is recorded with the first certification check.'));
      box.appendChild(h('div', { 'data-slot': 'entry-form' }));
    }

    function drawChecks() {
      const box = slot(v, 'checks');
      clear(box);
      box.appendChild(h('h2', {}, 'Certification checks'));
      box.appendChild(grid([
        { label: 'Attempt', key: 'retake_no' },
        { label: 'Date', key: 'assessed_on' },
        { label: 'Checklist', value: (a) => num(a.scores.checklist) },
        { label: 'Exam', value: (a) => num(a.scores.exam) },
        { label: 'Kitchen feedback', value: (a) => num(a.scores.kitchen) },
        { label: 'Manager feedback', value: (a) => num(a.scores.manager) },
        { label: 'Final', value: (a) => num(a.final_grade) },
        { label: 'Officers', value: (a) => a.officers.map((o) => o.name).join(', ') },
        { label: 'Corrections', value: (a) => (a.corrections ? String(a.corrections) : '') },
        { label: 'Visit report', value: (a) => safeLink(a.visit_report_url) },
      ], rec.attempts, 'No certification check yet.'));
    }

    function drawExtensions() {
      const box = slot(v, 'extensions');
      clear(box);
      box.appendChild(h('h2', {}, 'Extensions'));
      const limit = rec.extension_limit;
      box.appendChild(h('p', { class: 'count' }, rec.extensions.length + ' used' + (limit === null || limit === undefined ? ' (no limit is set yet: Admin sets it in the settings)' : ' of ' + limit)));
      box.appendChild(grid([
        { label: 'No.', key: 'extension_no' }, { label: 'Old deadline', key: 'old_deadline' }, { label: 'New deadline', key: 'new_deadline' }, { label: 'Reason', key: 'reason' },
      ], rec.extensions, 'No extension yet.'));
    }

    function drawActions() {
      const box = slot(v, 'actions');
      clear(box);
      box.appendChild(h('h2', {}, 'Actions'));
      const buttons = [
        actionButton('recordCertCheck', rec.enrollment.status === 'Certification check' ? 'Correct the certification check' : ACTION_LABEL.recordCertCheck, () => certCheckForm()),
        actionButton('certify', ACTION_LABEL.certify, () => confirmForm('certify', 'Certify ' + rec.person.name + '?',
          'The server checks the final grade and the course program grade against the pass marks in force.', 'Certify')),
        actionButton('extend', ACTION_LABEL.extend, () => simpleForm('extend', 'Extend the deadline', [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, max: 500 }], 'Extend')),
        actionButton('close', ACTION_LABEL.close, () => closeForm(), 'danger'),
        actionButton('quit', ACTION_LABEL.quit, () => quitForm(), 'danger'),
        actionButton('returnToProbation', ACTION_LABEL.returnToProbation, () => simpleForm('returnToProbation', 'Return to probation', [{ name: 'note', label: 'Note', type: 'textarea', required: true, max: 1000 }], 'Return to probation'), 'secondary'),
        actionButton('promote', ACTION_LABEL.promote, () => simpleForm('promote', 'Promote', [{ name: 'promoted_on', label: 'Promotion date', type: 'date', required: true }], 'Promote')),
      ].filter(Boolean);
      box.appendChild(buttons.length ? h('div', { class: 'actions', 'data-slot': 'action-buttons' }, buttons) : h('p', { class: 'count' }, 'No action is open to you for this record now.'));
      box.appendChild(h('div', { 'data-slot': 'action-form' }));
    }

    function draw() {
      setMessage(msg, 'ok', '');
      drawHeader();
      drawEntryGrades();
      drawChecks();
      drawExtensions();
      drawActions();
    }

    // One small form: fields in, one call, the server's message on refusal.
    function openForm(target, cfg) {
      const form = h('form', { class: 'panel wide', novalidate: true, 'aria-label': cfg.title, 'data-form': cfg.method });
      form.appendChild(h('h3', {}, cfg.title));
      if (cfg.intro) form.appendChild(h('p', {}, cfg.intro));
      const note = h('div', { 'data-slot': 'form-message', role: 'alert' });
      form.appendChild(note);
      if (cfg.fields.length) form.appendChild(h('div', { class: 'form-grid' }, cfg.fields.map((f) => control(f, cfg.values ? cfg.values[f.name] : undefined))));
      const save = h('button', { type: 'submit', class: cfg.danger ? 'danger' : '' }, cfg.submit);
      if (cfg.disabled) save.disabled = true;
      form.appendChild(h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'secondary', onclick: () => clear(target) }, 'Cancel')));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearFieldErrors(form);
        setMessage(note, 'error', '');
        const params = { id: id, row_version: rec.enrollment.row_version };
        cfg.fields.forEach((f) => { const x = valueOf(form, f); if (x !== null) params[f.name] = x; });
        if (cfg.extra) Object.assign(params, cfg.extra());
        save.disabled = true;
        try {
          rec = await Api.call(cfg.method, params);
          historyLoaded = false;
          draw();
          setMessage(msg, 'ok', cfg.done || 'Saved.');
          if (!v.querySelector('[data-pane="history"]').hidden) loadHistory(true);
        } catch (e) {
          save.disabled = false;
          markFieldErrors(form, e);
          setMessage(note, 'error', refusalText(e), e && e.code === 'CONFLICT' ? reloadButton() : null);
        }
      });
      clear(target);
      target.appendChild(form);
      const first = form.querySelector('input:not([disabled]), select:not([disabled]), textarea');
      (first || save).focus();
    }

    const actionTarget = () => slot(v, 'action-form');

    function simpleForm(action, title, fields, submit) {
      openForm(actionTarget(), { method: 'tl.' + action, title: title, fields: fields, submit: submit });
    }

    function confirmForm(action, title, intro, submit) {
      openForm(actionTarget(), { method: 'tl.' + action, title: title, intro: intro, fields: [], submit: submit });
    }

    function closeForm() {
      openForm(actionTarget(), {
        method: 'tl.close', title: 'Fail this record', danger: true, submit: 'Fail',
        fields: [
          { name: 'close_reason_id', label: 'Reason', type: 'select', required: true, options: refs.closeReasons },
          { name: 'remark', label: 'Remark', type: 'textarea', max: 1000 },
        ],
      });
    }

    function quitForm() {
      const none = !refs.quitReasons.length;
      openForm(actionTarget(), {
        method: 'tl.quit', title: 'Record a quit', danger: true, submit: 'Record the quit', disabled: none,
        intro: none ? 'No quit reasons are set up yet (CFG-018). Ask Admin to add them under Lookups, then try again.' : null,
        fields: [
          { name: 'quit_date', label: 'Quit date', type: 'date', required: true },
          { name: 'quit_reason_lookup_id', label: 'Reason', type: 'select', required: true, options: refs.quitReasons },
          { name: 'remark', label: 'Remark', type: 'textarea', max: 1000 },
        ],
      });
    }

    function entryGradeForm(comp, grade) {
      openForm(slot(v, 'entry-form'), {
        method: 'tl.recordEntryGrade', title: (grade ? 'Correct ' : 'Record ') + comp.name, submit: grade ? 'Save the correction' : 'Save the grade',
        done: grade ? 'Correction saved as a new row.' : 'Grade saved.',
        intro: grade ? 'The old grade stays in the History. A correction needs a reason.' : null,
        fields: [
          { name: 'score', label: 'Score (0 to 100)', type: 'number', required: true },
          { name: 'assessed_on', label: 'Assessed on', type: 'date', required: true },
        ].concat(grade ? [{ name: 'correction_reason', label: 'Reason for the correction', type: 'textarea', required: true, max: 500 }] : []),
        extra: () => ({ component_id: comp.id }),
      });
    }

    function certCheckForm() {
      const correcting = rec.enrollment.status === 'Certification check' && rec.attempts.length;
      const last = correcting ? rec.attempts[rec.attempts.length - 1] : null;
      const needCourse = !rec.course_program;
      const values = last ? {
        assessed_on: last.assessed_on, checklist: last.scores.checklist, exam: last.scores.exam,
        kitchen_feedback: last.scores.kitchen, manager_feedback: last.scores.manager, course_program: rec.course_program ? rec.course_program.score : undefined,
        visit_report_url: last.visit_report_url || undefined,
      } : {};
      openForm(actionTarget(), {
        method: 'tl.recordCertCheck', title: correcting ? 'Correct the certification check' : 'Record a certification check', values: values,
        submit: correcting ? 'Save the correction' : 'Save the check',
        done: correcting ? 'Correction saved. The final grade was recomputed by the server.' : 'Check saved. The final grade was computed by the server.',
        intro: 'Give the checklist and the exam, and at least one of the two feedback scores. The certifying officer is you (' + me.name + ').',
        fields: [
          { name: 'assessed_on', label: 'Assessed on', type: 'date', required: true },
          { name: 'checklist', label: 'Checklist (0 to 100)', type: 'number', required: true },
          { name: 'exam', label: 'Exam (0 to 100)', type: 'number', required: true },
          { name: 'kitchen_feedback', label: 'Kitchen feedback (0 to 100)', type: 'number' },
          { name: 'manager_feedback', label: 'Manager feedback (0 to 100)', type: 'number' },
          { name: 'course_program', label: 'TL course program grade (0 to 100)', type: 'number', required: needCourse, hint: needCourse ? 'Required with the first check.' : 'Leave it as it is, or change it with a reason.' },
          { name: 'visit_report_url', label: 'Visit report link', type: 'text', max: 500 },
        ].concat(correcting ? [{ name: 'correction_reason', label: 'Reason for the correction', type: 'textarea', required: true, max: 500 }] : []),
        extra: () => ({ officer_ids: [me.id] }),
      });
    }

    // ----- history (newest first, a cursor, a "Show more" button) -----
    function describe(it) {
      const compName = (cid) => {
        const g = rec.entry.required.find((c) => c.id === cid);
        if (g) return g.name;
        if (rec.course_program && rec.course_program.component_id === cid) return rec.course_program.component;
        return 'Certification score (' + cid + ')';
      };
      if (it.kind === 'STATUS') return 'Status ' + (it.from_status ? it.from_status + ' to ' : 'set to ') + it.to_status + (it.effective_date ? ' (effective ' + it.effective_date + ')' : '') + (it.remark ? ': ' + it.remark : '');
      if (it.kind === 'FIELD') return 'Field ' + it.field + ': ' + text(it.old_value) + ' to ' + text(it.new_value);
      if (it.kind === 'ASSESSMENT') {
        return compName(it.component_id) + ' ' + num(it.score) + ' assessed ' + it.assessed_on + (it.retake_no ? ' (attempt ' + it.retake_no + ')' : '')
          + (it.supersedes_id ? ' - correction of ' + it.supersedes_id + (it.correction_reason ? ': ' + it.correction_reason : '') : '');
      }
      if (it.kind === 'EXTENSION') return 'Extension ' + it.extension_no + ': ' + it.old_deadline + ' to ' + it.new_deadline + (it.reason ? ': ' + it.reason : '');
      if (it.kind === 'OFFICER') return 'Certifying officer recorded for attempt ' + it.retake_no;
      return it.kind;
    }

    async function loadHistory(reset, cursor) {
      const box = slot(v, 'history');
      if (reset) { clear(box); box.appendChild(h('h2', {}, 'History')); box.appendChild(h('ul', { class: 'timeline', 'data-slot': 'timeline' })); box.appendChild(h('div', { 'data-slot': 'more' })); }
      const more = slot(box, 'more');
      try {
        const params = { id: id, page_size: 25 };
        if (cursor) params.cursor = cursor;
        const env = await Api.callFull('tl.history', params);
        historyLoaded = true;
        const list = slot(box, 'timeline');
        env.data.forEach((it) => list.appendChild(h('li', { 'data-kind': it.kind, class: it.supersedes_id ? 'corrected' : '' },
          h('span', { class: 'when' }, (it.at || '').replace('T', ' ').slice(0, 16)), ' ', h('span', { class: 'tag' }, it.kind.toLowerCase()), ' ', describe(it))));
        clear(more);
        const next = env.meta && env.meta.page && env.meta.page.next_cursor;
        if (next) more.appendChild(h('button', { type: 'button', class: 'secondary small', 'data-action': 'history.more', onclick: () => loadHistory(false, next) }, 'Show more'));
        else if (!env.data.length && reset) list.appendChild(h('li', {}, 'No history yet.'));
      } catch (e) { setMessage(more, 'error', errText(e)); }
    }

    tabs();
    draw();
    if (okText) setMessage(msg, 'ok', okText);
  }

  A.registerNav({ id: 'tl', label: 'Team Leaders', roles: null, render: renderList }, true);
})();
