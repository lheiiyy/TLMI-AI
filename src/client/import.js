// The legacy import screen (Admin only): check, counts, reconciliation, rows, skip, commit in steps.
// Server text is set with textContent only (App.h). Issue codes are shown in words.
(function (root) {
  'use strict';
  const A = root.App;
  const h = A.h;

  const RESULT_WORDS = {
    READY: 'Ready', NOT_READY: 'Not ready', SKIPPED: 'Skipped', COMMITTED: 'Committed', ALREADY_COMMITTED: 'Already committed',
  };
  const ISSUE_WORDS = {
    PERSON_UNCONFIRMED: 'The person is not confirmed in the review sheet',
    DUPLICATE_UNDECIDED: 'A possible duplicate has no decision',
    STORE_UNMAPPED: 'The store is not matched to a known store',
    SUPPORT_STORE_UNMAPPED: 'The support store is not matched to a known store',
    STATION_UNMAPPED: 'The station is not matched to a known station',
    ENTRY_DATE_BAD: 'The entry date is missing or not a date',
    STATUS_BAD: 'The legacy result is not one the import understands',
    VALUE_UNDECIDED: 'A value has no decision in the review sheet',
    OPEN_TWICE: 'The same person has two open records',
    CHANGED_AFTER_COMMIT: 'The legacy row changed after it was committed',
    OFFICER_NOTE: 'The officer cell holds a note, not a name',
    OFFICER_UNMAPPED: 'The officer is not matched to a user',
    ENTRY_AVERAGE_DIFFERS: 'The legacy entry average differs from the computed one',
    DECISION_FLAGGED: 'A decision was marked for another look',
    CERT_GRADE_NO_DATE: 'A certification grade has no date',
    GRADE_ROUNDED: 'A grade was rounded to a whole number',
  };
  const word = (code) => ISSUE_WORDS[code] || 'Problem code ' + code;
  const resultWord = (r) => RESULT_WORDS[r] || r;
  const PAGE_SIZE = 25;

  async function render(main) {
    const v = A.tpl('view-legacy-import');
    main.appendChild(v);
    const slot = (n) => A.slot(v, n);
    const msg = slot('message');
    const state = { batch: null, page: 1, filters: { result: '', search: '' } };

    function facts(batch) {
      const clear = A.clear;
      const box = slot('batch-facts');
      clear(box);
      const pair = (k, val) => { box.append(h('dt', {}, k), h('dd', {}, val)); };
      pair('Batch', batch.id);
      pair('Status', batch.status);
      pair('Legacy rows', batch.source_row_count);
      pair('Newest check', batch.is_latest ? 'Yes' : 'No: run the check again');
    }

    function drawCounts(data) {
      const by = data.counts.by_result;
      const results = Object.keys(RESULT_WORDS);
      A.clear(slot('by-result'));
      slot('by-result').appendChild(A.grid([{ label: 'Result', key: 'result' }, { label: 'Rows', key: 'rows' }],
        results.map((r) => ({ result: resultWord(r), rows: by[r] || 0 })), 'No rows.'));
      const issues = data.counts.by_issue || {};
      A.clear(slot('by-issue'));
      slot('by-issue').appendChild(A.grid([{ label: 'Problem', key: 'problem' }, { label: 'Rows', key: 'rows' }],
        Object.keys(issues).sort().map((c) => ({ problem: word(c), rows: issues[c] })), 'No problems.'));
      const rec = data.reconciliation;
      const box = slot('reconciliation');
      A.clear(box);
      box.append(
        h('dl', { class: 'kv' },
          h('dt', {}, 'Rows needing action'), h('dd', {}, rec.unresolved_rows),
          h('dt', {}, 'Reconciled'), h('dd', { 'data-slot': 'reconciled' }, rec.reconciled ? 'Yes' : 'Not yet'),
          h('dt', {}, 'Failed with Disqualified (expected, actual)'), h('dd', {}, rec.failed_disqualified.expected + ', ' + rec.failed_disqualified.actual)),
        A.grid([{ label: 'Legacy result', key: 'legacy' }, { label: 'Rows', key: 'rows' }],
          Object.keys(rec.legacy_result_counts).sort().map((k) => ({ legacy: k, rows: rec.legacy_result_counts[k] })), 'Nothing counted.'),
        A.grid([{ label: 'Status in the app', key: 'status' }, { label: 'Expected', key: 'expected' }, { label: 'Actual', key: 'actual' }, { label: 'Agree', value: (r) => (r.agree ? 'Yes' : 'No') }],
          rec.status_table, 'No committed rows yet.'));
    }

    async function loadBatch(importId) {
      const data = await Api.call('import.get', importId ? { import_id: importId } : {});
      if (!data.batch) { slot('batch').hidden = true; return; }
      state.batch = data.batch;
      slot('batch').hidden = false;
      facts(data.batch);
      drawCounts(data);
      const open = data.batch.status === 'Validated' && data.batch.is_latest;
      const stepping = data.batch.status === 'Committing';
      slot('commit').hidden = !open;
      slot('continue').hidden = !stepping;
      slot('commit-form').hidden = !(open || stepping);
      slot('commit-form').elements.backup_date.hidden = !open && !stepping;
    }

    function skipForm(row) {
      const box = slot('skip-form');
      A.clear(box);
      const note = h('div', { role: 'status' });
      const reason = h('textarea', { name: 'skip_reason', rows: '2', maxlength: '500', 'aria-label': 'Reason for skipping' });
      box.appendChild(h('form', {
        class: 'panel',
        onsubmit: async (ev) => {
          ev.preventDefault();
          try {
            await Api.call('import.rows.skip', { id: row.id, row_version: row.row_version, skip_reason: reason.value });
            A.clear(box);
            A.setMessage(msg, 'ok', 'Row ' + row.source_row + ' is skipped.');
            await loadBatch(state.batch.id);
            await loadRows();
          } catch (e) { A.setMessage(note, 'error', A.errText(e)); }
        },
      }, h('h3', {}, 'Skip row ' + row.source_row + ' (' + row.full_name + ')'),
      h('label', {}, 'Reason', reason), note,
      h('div', { class: 'toolbar' },
        h('button', { type: 'submit' }, 'Skip this row'),
        h('button', { type: 'button', class: 'secondary', onclick: () => A.clear(box) }, 'Cancel'))));
      reason.focus();
    }

    async function loadRows() {
      if (!state.batch) return;
      const params = { import_id: state.batch.id, page: state.page, page_size: PAGE_SIZE };
      if (state.filters.result) params.filters = { result: state.filters.result };
      if (state.filters.search) params.q = state.filters.search;
      const env = await Api.callFull('import.rows.list', params);
      const rows = env.data;
      const total = (env.meta.page && env.meta.page.total) || rows.length;
      A.clear(slot('rows'));
      slot('rows').appendChild(A.grid([
        { label: 'Row', key: 'source_row' },
        { label: 'Name', key: 'full_name' },
        { label: 'Entry date', key: 'entry_date' },
        { label: 'Legacy result', key: 'legacy_result' },
        { label: 'Result', value: (r) => resultWord(r.result) },
        { label: 'Problems', value: (r) => r.issues.map((i) => word(i.code)).join('; ') + (r.skip_reason ? 'Skipped: ' + r.skip_reason : '') },
        { actions: (r) => ((r.result === 'READY' || r.result === 'NOT_READY') && state.batch.status === 'Validated'
          ? h('button', { type: 'button', class: 'secondary', 'data-skip': r.source_row, onclick: () => skipForm(r) }, 'Skip') : null) },
      ], rows, 'No rows match.'));
      const pager = slot('pager');
      A.clear(pager);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      pager.append(
        h('button', { type: 'button', class: 'secondary', disabled: state.page <= 1, 'data-pager': 'prev', onclick: () => { state.page -= 1; loadRows(); } }, 'Previous'),
        h('span', {}, ' Page ' + state.page + ' of ' + pages + ' (' + total + ' rows) '),
        h('button', { type: 'button', class: 'secondary', disabled: state.page >= pages, 'data-pager': 'next', onclick: () => { state.page += 1; loadRows(); } }, 'Next'));
    }

    async function commit(button) {
      const form = slot('commit-form');
      button.disabled = true;
      try {
        const res = await Api.call('import.commit', { import_id: state.batch.id, row_version: state.batch.row_version, backup_date: form.elements.backup_date.value });
        let text = res.committed + ' rows committed, ' + res.held + ' held back.';
        if (res.remaining > 0) text += ' ' + res.remaining + ' rows remain. Press Continue.';
        else text += ' The commit is complete.';
        if (res.stopped === 'BUSY') text += ' The data sheet was busy; press Continue.';
        A.setMessage(msg, 'ok', text);
        await loadBatch(state.batch.id);
        await loadRows();
      } catch (e) { A.setMessage(msg, 'error', A.errText(e)); } finally { button.disabled = false; }
    }

    slot('validate').addEventListener('click', async (ev) => {
      const button = ev.currentTarget;
      button.disabled = true;
      A.setMessage(msg, 'ok', '');
      try {
        const res = await Api.call('import.validate');
        state.page = 1;
        A.setMessage(msg, 'ok', 'The check is done. Batch ' + res.import_id + '. Nothing was imported yet.');
        await loadBatch(res.import_id);
        await loadRows();
      } catch (e) { A.setMessage(msg, 'error', A.errText(e)); } finally { button.disabled = false; }
    });
    slot('commit-form').addEventListener('submit', (ev) => { ev.preventDefault(); commit(slot('commit')); });
    slot('continue').addEventListener('click', (ev) => commit(ev.currentTarget));
    slot('filters').addEventListener('submit', (ev) => {
      ev.preventDefault();
      state.filters = { result: ev.currentTarget.elements.result.value, search: ev.currentTarget.elements.search.value.trim() };
      state.page = 1;
      loadRows().catch((e) => A.setMessage(msg, 'error', A.errText(e)));
    });

    try {
      await loadBatch();
      await loadRows();
    } catch (e) { A.setMessage(msg, 'error', A.errText(e)); }
  }

  A.registerNav({ id: 'legacy-import', label: 'Legacy import', roles: [A.ROLE.admin], render: render });
})(window);
