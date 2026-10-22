// Screens. They call only Api (api.js). Markup comes from the templates in index.html and views/*.html; values from the
// server are always put in with textContent, never with innerHTML. Hiding a menu entry is not security: the server
// checks the role on every call.
(function () {
  'use strict';

  const ROLE = { officer: 'Training Officer', supervisor: 'Training Supervisor', manager: 'Training Manager', senior: 'Senior Training Manager', admin: 'Admin' };
  const ROLE_LIST = [ROLE.officer, ROLE.supervisor, ROLE.manager, ROLE.senior, ROLE.admin];
  const IDLE_MS = (window.TLMI_TEST_IDLE_MS || 30 * 60 * 1000);
  const PING_MS = 5 * 60 * 1000;

  const state = { user: null, view: null, lastActivity: 0, lastPing: 0, idleTimer: null };

  // ---------- small helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);

  function h(tag, attrs) {
    const el = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    Array.prototype.slice.call(arguments, 2).forEach(function add(c) {
      if (Array.isArray(c)) c.forEach(add);
      else if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function tpl(id) {
    const wrap = h('div');
    wrap.appendChild(document.getElementById(id).content.cloneNode(true));
    return wrap;
  }

  const slot = (root, name) => root.querySelector('[data-slot="' + name + '"]');

  function notice(kind, text, extra) {
    return h('div', { class: 'notice ' + kind }, text, extra || null);
  }

  function setMessage(el, kind, text, extra) {
    clear(el);
    if (text) el.appendChild(notice(kind, text, extra));
  }

  function errText(e) {
    if (!e) return 'Something went wrong.';
    if (e.code === 'CONFLICT') return 'Changed by ' + ((e.current && e.current.updated_by_name) || 'someone else') + ', reload.';
    if (e.code === 'VALIDATION' && e.fields && e.fields.length) return 'Check the marked fields. ' + e.fields.map((f) => f.message).join(' ');
    return e.message || 'Something went wrong.';
  }

  const stamp = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '');
  const isAdmin = () => state.user && state.user.role === ROLE.admin;

  function statusTag(row) {
    return h('span', { class: 'tag' + (row.is_active ? '' : ' off') }, row.is_active ? 'Active' : 'Inactive');
  }

  // cols: [{ label, value(row) | key }]. On a phone every row shows its labels (CSS).
  function grid(cols, rows, empty) {
    const body = rows.length
      ? rows.map((r) => h('tr', {}, cols.map((c) => {
        if (c.actions) return h('td', { class: 'row-actions' }, c.actions(r));
        const v = c.value ? c.value(r) : r[c.key];
        return h('td', { 'data-label': c.label }, v === null || v === undefined ? '' : v);
      })))
      : [h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, empty || 'Nothing here yet.'))];
    return h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c.actions ? 'Actions' : c.label)))),
      h('tbody', {}, body)));
  }

  async function fetchAll(method, params) {
    let page = 1;
    let out = [];
    for (;;) {
      const env = await Api.callFull(method, Object.assign({ page: page, page_size: 50 }, params || {}));
      out = out.concat(env.data);
      if (!env.meta.page || out.length >= env.meta.page.total || env.data.length === 0) return out;
      page += 1;
    }
  }

  // ---------- sign-in, sign-out, idle ----------
  function showScreen(name) {
    $('#screen-signin').hidden = name !== 'signin';
    $('#screen-password').hidden = name !== 'password';
    $('#screen-app').hidden = name !== 'app';
  }

  function stopIdle() { if (state.idleTimer) { clearInterval(state.idleTimer); state.idleTimer = null; } }

  function startIdle() {
    stopIdle();
    state.lastActivity = Date.now();
    state.lastPing = Date.now();
    state.idleTimer = setInterval(() => {
      if (Date.now() - state.lastActivity > IDLE_MS) endSession('You were signed out after 30 minutes without activity.');
    }, 1000);
  }

  // Activity keeps the server session alive too, at most once in five minutes.
  function onActivity() {
    if (!state.user) return;
    state.lastActivity = Date.now();
    if (Date.now() - state.lastPing > PING_MS) {
      state.lastPing = Date.now();
      Api.call('auth.me').catch(() => {});
    }
  }

  function endSession(message, kind) {
    stopIdle();
    state.user = null;
    Api.setToken(null);
    clear($('#main')); // a temporary-password box left open must not stay in the hidden page
    showSignIn(message, kind);
  }

  function showSignIn(message, kind) {
    showScreen('signin');
    const msg = $('#signin-message');
    msg.hidden = !message;
    setMessage(msg, kind || 'error', message || '');
    $('#signin-password').value = '';
    $('#signin-employee').value = '';
    $('#signin-employee').focus();
  }

  async function submitSignIn(ev) {
    ev.preventDefault();
    const msg = $('#signin-message');
    const employee = $('#signin-employee').value.trim();
    const password = $('#signin-password').value;
    if (!employee || !password) { msg.hidden = false; setMessage(msg, 'error', 'Type your employee ID and your password.'); return; }
    if (!/^\d+$/.test(employee)) { msg.hidden = false; setMessage(msg, 'error', 'The employee ID is digits only.'); return; }
    const btn = $('#signin-submit');
    btn.disabled = true;
    try {
      const data = await Api.call('auth.signIn', { employee_id: employee, password: password });
      $('#signin-password').value = '';
      Api.setToken(data.token);
      state.user = data.user;
      msg.hidden = true;
      if (data.must_change_password) showPassword(true); else showApp();
    } catch (e) {
      $('#signin-password').value = '';
      msg.hidden = false;
      if (e.code === 'AUTH_FAILED') setMessage(msg, 'error', 'Sign-in failed. Check the employee ID and the password.');
      else if (e.code === 'AUTH_LOCKED') setMessage(msg, 'error', 'Too many tries. Try again in ' + Math.max(1, Math.ceil((e.retry_after || 60) / 60)) + ' minutes.');
      else setMessage(msg, 'error', errText(e));
    } finally {
      btn.disabled = false;
    }
  }

  // The change-password screen. forced: a temporary password is in use, so nothing else is open until it is changed.
  function showPassword(forced) {
    state.forcedPassword = forced;
    showScreen('password');
    stopIdle();
    startIdle();
    ['#pw-current', '#pw-new', '#pw-repeat'].forEach((sel) => { $(sel).value = ''; });
    $('#pw-message').hidden = true;
    $('#pw-lead').textContent = forced ? 'Your password is temporary. Choose your own before you continue.' : 'Choose a new password.';
    $('#pw-cancel').hidden = !!forced;
    $('#pw-current').focus();
  }

  async function submitPassword(ev) {
    ev.preventDefault();
    const msg = $('#pw-message');
    const current = $('#pw-current').value;
    const next = $('#pw-new').value;
    const fail = (text) => { msg.hidden = false; setMessage(msg, 'error', text); };
    if (!current || !next) { fail('Type the current password and a new password.'); return; }
    if (next !== $('#pw-repeat').value) { fail('The two new passwords are not the same.'); return; }
    const btn = $('#pw-submit');
    btn.disabled = true;
    try {
      const data = await Api.call('auth.changePassword', { current: current, new: next });
      Api.setToken(data.token);
      ['#pw-current', '#pw-new', '#pw-repeat'].forEach((sel) => { $(sel).value = ''; });
      msg.hidden = true;
      showApp();
    } catch (e) {
      ['#pw-current', '#pw-new', '#pw-repeat'].forEach((sel) => { $(sel).value = ''; });
      if (e.code === 'VALIDATION' && e.fields && e.fields.length) fail(e.fields[0].message);
      else fail(errText(e));
    } finally {
      btn.disabled = false;
    }
  }

  async function signOut() {
    try { await Api.call('auth.signOut'); } catch (e) { /* the session may already be gone */ }
    endSession('You are signed out.', 'ok');
  }

  // ---------- shell and navigation ----------
  const NAV = [
    { id: 'home', label: 'Master lists', roles: null, render: renderHome },
    { id: 'settings', label: 'Settings', roles: [ROLE.manager, ROLE.senior, ROLE.admin], render: renderSettings },
    { id: 'audit', label: 'Audit log', roles: [ROLE.senior, ROLE.admin], render: renderAudit },
    { sep: 'Admin', roles: [ROLE.admin] },
    { id: 'stores', label: 'Stores', roles: [ROLE.admin], render: (m) => renderManagers(m, ['stores']) },
    { id: 'stations', label: 'Stations', roles: [ROLE.admin], render: (m) => renderManagers(m, ['stations']) },
    { id: 'brands-regions', label: 'Brands and regions', roles: [ROLE.admin], render: (m) => renderManagers(m, ['brands', 'regions']) },
    { id: 'lookups', label: 'Lookups', roles: [ROLE.admin], render: (m) => renderManagers(m, ['lookups']) },
    { id: 'components', label: 'Components', roles: [ROLE.admin], render: (m) => renderManagers(m, ['components']) },
    { id: 'users', label: 'Users', roles: [ROLE.admin], render: (m) => renderManagers(m, ['users']) },
    { id: 'seed', label: 'Seed', roles: [ROLE.admin], render: renderSeed },
    { id: 'import', label: 'Import review', roles: [ROLE.admin], render: renderImport },
  ];

  const allowed = (item) => !item.roles || item.roles.indexOf(state.user.role) >= 0;

  // Other client scripts (tl.js) add their menu entry here; a first entry goes before the others. roles: null is everyone.
  function registerNav(item, first) {
    if (first) NAV.unshift(item); else NAV.push(item);
  }

  function showApp() {
    showScreen('app');
    clear($('#who'));
    $('#who').append(state.user.name, ' ', h('small', {}, '(' + state.user.role + ')'));
    const ul = $('#nav');
    clear(ul);
    NAV.filter(allowed).forEach((item) => {
      if (item.sep) ul.appendChild(h('li', { class: 'sep' }, item.sep));
      else ul.appendChild(h('li', {}, h('button', { type: 'button', 'data-nav': item.id, onclick: () => go(item.id) }, item.label)));
    });
    startIdle();
    go('home');
  }

  async function go(id) {
    const item = NAV.find((n) => n.id === id);
    if (!item || !state.user || !allowed(item)) return;
    state.view = id;
    document.querySelectorAll('#nav button').forEach((b) => {
      if (b.getAttribute('data-nav') === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const main = $('#main');
    clear(main);
    try {
      await item.render(main);
    } catch (e) {
      if (state.view === id && state.user) main.appendChild(notice('error', errText(e)));
    }
  }

  // ---------- master lists (everyone, read only) ----------
  async function renderHome(main) {
    const v = tpl('view-home');
    main.appendChild(v);
    const out = slot(v, 'lists');
    const [brands, regions, locations, stations, lookups] = await Promise.all([
      fetchAll('brands.list'), fetchAll('regions.list'), fetchAll('locations.list'), fetchAll('stations.list'), fetchAll('lookups.list'),
    ]);
    const name = (list) => Object.fromEntries(list.map((r) => [r.id, r.name]));
    const brandName = name(brands), regionName = name(regions);
    const section = (key, title, cols, rows) => h('section', { class: 'section', 'data-section': key },
      h('header', {}, h('h2', {}, title), h('span', { class: 'count' }, rows.length + (rows.length === 1 ? ' row' : ' rows'))),
      grid(cols, rows));
    const state_ = { label: 'Status', value: statusTag };
    out.append(
      section('brands', 'Brands', [{ label: 'Name', key: 'name' }, { label: 'Code', key: 'code' }, state_], brands),
      section('regions', 'Regions', [{ label: 'Name', key: 'name' }, state_], regions),
      section('stores', 'Stores', [{ label: 'Name', key: 'name' }, { label: 'Type', key: 'location_type' },
        { label: 'Brand', value: (r) => brandName[r.brand_id] }, { label: 'Region', value: (r) => regionName[r.region_id] || '' }, state_], locations),
      section('stations', 'Stations', [{ label: 'Name', key: 'name' }, { label: 'Brand', value: (r) => brandName[r.brand_id] }, state_], stations),
      section('lookups', 'Lookup values', [{ label: 'List', key: 'category' }, { label: 'Value', key: 'value' }, { label: 'Label', key: 'label' }, state_], lookups));
  }

  // ---------- Admin: one generic manager for the simple lists ----------
  const activeOf = (rows) => rows.filter((r) => r.is_active);
  const MANAGERS = {
    stores: {
      method: 'locations', title: 'Stores', noun: 'store', needs: ['brands', 'regions', 'locationTypes'],
      columns: (refs) => [{ label: 'Name', key: 'name' }, { label: 'Type', key: 'location_type' },
        { label: 'Brand', value: (r) => refs.brandName[r.brand_id] }, { label: 'Region', value: (r) => refs.regionName[r.region_id] || '' }],
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'location_type', label: 'Type', type: 'select', source: 'locationTypes', required: true },
        { name: 'brand_id', label: 'Brand', type: 'select', source: 'brands', required: true },
        { name: 'region_id', label: 'Region', type: 'select', source: 'regions' },
      ],
    },
    stations: {
      method: 'stations', title: 'Stations', noun: 'station', needs: ['brands'],
      columns: (refs) => [{ label: 'Name', key: 'name' }, { label: 'Brand', value: (r) => refs.brandName[r.brand_id] }],
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'brand_id', label: 'Brand', type: 'select', source: 'brands', required: true },
      ],
    },
    brands: {
      method: 'brands', title: 'Brands', noun: 'brand', needs: [],
      columns: () => [{ label: 'Name', key: 'name' }, { label: 'Code', key: 'code' }],
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'code', label: 'Code', type: 'text', required: true, fixed: true, hint: 'The code cannot be changed after the brand is added.' },
      ],
    },
    regions: {
      method: 'regions', title: 'Regions', noun: 'region', needs: [],
      columns: () => [{ label: 'Name', key: 'name' }],
      fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
    },
    lookups: {
      method: 'lookups', title: 'Lookup values', noun: 'lookup value', needs: [],
      columns: () => [{ label: 'List', key: 'category' }, { label: 'Value', key: 'value' }, { label: 'Label', key: 'label' }, { label: 'Order', key: 'sort_order' },
        { label: 'Kind', value: (r) => (r.is_system ? 'System' : '') }],
      fields: [
        { name: 'category', label: 'List', type: 'text', required: true, fixed: true, hint: 'For example location_type. It cannot be changed later.' },
        { name: 'value', label: 'Value', type: 'text', required: true },
        { name: 'label', label: 'Label', type: 'text', required: true },
        { name: 'sort_order', label: 'Order', type: 'number' },
      ],
    },
    components: {
      method: 'components', title: 'Assessment components', noun: 'component', needs: [], create: false, activate: false,
      columns: () => [{ label: 'Name', key: 'name' }, { label: 'Stage', key: 'stage' }, { label: 'Required', value: (r) => (r.required ? 'Yes' : 'No') }],
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'required', label: 'Required for certification', type: 'checkbox' },
      ],
    },
    users: {
      method: 'users', title: 'Users', noun: 'user', needs: [], passwordActions: true,
      columns: () => [{ label: 'Name', key: 'display_name' }, { label: 'Role', key: 'role' }, { label: 'Employee ID', key: 'hr_employee_no' },
        { label: 'Password', value: (r) => (r.paused ? 'Paused after wrong tries' : r.must_change_password ? 'Temporary' : r.has_password === false ? 'None yet' : 'Set') }],
      fields: [
        { name: 'display_name', label: 'Name', type: 'text', required: true },
        { name: 'role', label: 'Role', type: 'select', source: 'roles', required: true },
        { name: 'hr_employee_no', label: 'HR employee number', type: 'text', required: true, hint: 'Digits only. This is the number the user signs in with.' },
      ],
    },
  };

  async function loadRefs(needs) {
    const refs = { brandName: {}, regionName: {}, options: { roles: ROLE_LIST.map((r) => ({ value: r, label: r })), brands: [], regions: [], locationTypes: [] } };
    if (needs.indexOf('brands') >= 0) {
      const rows = await fetchAll('brands.list');
      rows.forEach((r) => { refs.brandName[r.id] = r.name; });
      refs.options.brands = activeOf(rows).map((r) => ({ value: r.id, label: r.name }));
    }
    if (needs.indexOf('regions') >= 0) {
      const rows = await fetchAll('regions.list');
      rows.forEach((r) => { refs.regionName[r.id] = r.name; });
      refs.options.regions = activeOf(rows).map((r) => ({ value: r.id, label: r.name }));
    }
    if (needs.indexOf('locationTypes') >= 0) {
      const rows = await fetchAll('lookups.list', { filters: { category: 'location_type', is_active: true } });
      refs.options.locationTypes = rows.map((r) => ({ value: r.value, label: r.label }));
    }
    return refs;
  }

  async function renderManagers(main, keys) {
    for (const key of keys) {
      const box = h('div', { 'data-manager': key });
      main.appendChild(box);
      await manager(box, MANAGERS[key]);
    }
  }

  async function manager(box, cfg) {
    const v = tpl('view-manager');
    box.appendChild(v);
    slot(v, 'title').textContent = cfg.title;
    const msg = slot(v, 'message');
    const formBox = slot(v, 'form');
    const tableBox = slot(v, 'table');
    const addBtn = slot(v, 'add');
    const search = slot(v, 'search');
    addBtn.textContent = 'Add ' + cfg.noun;
    addBtn.hidden = cfg.create === false;
    let rows = [];
    let refs = null;

    async function reload(okText) {
      rows = await fetchAll(cfg.method + '.list');
      refs = await loadRefs(cfg.needs);
      draw();
      if (okText) setMessage(msg, 'ok', okText);
    }

    function draw() {
      const q = search.value.trim().toLowerCase();
      const cols = cfg.columns(refs);
      const shown = rows.filter((r) => !q || cols.concat([{ key: 'id' }]).some((c) => String(c.value ? c.value(r) : r[c.key] || '').toLowerCase().indexOf(q) >= 0));
      slot(v, 'count').textContent = rows.length + (rows.length === 1 ? ' row' : ' rows');
      clear(tableBox);
      tableBox.appendChild(grid(cols.concat([{ label: 'Status', value: statusTag }, { actions: rowActions }]), shown,
        rows.length ? 'No match. Clear the search.' : 'Nothing here yet. Use Add ' + cfg.noun + '.'));
    }

    function rowActions(r) {
      const out = [h('button', { type: 'button', class: 'secondary small', 'data-action': 'edit', 'aria-label': 'Edit ' + (r.name || r.display_name || r.value || r.id), onclick: () => openForm(r) }, 'Edit')];
      if (cfg.activate !== false) {
        const on = r.is_active;
        out.push(h('button', {
          type: 'button', class: 'small ' + (on ? 'danger' : 'secondary'), 'data-action': on ? 'deactivate' : 'reactivate',
          'aria-label': (on ? 'Deactivate ' : 'Reactivate ') + (r.name || r.display_name || r.value || r.id),
          onclick: () => toggle(r),
        }, on ? 'Deactivate' : 'Reactivate'));
      }
      if (cfg.passwordActions && r.is_active) {
        const who = r.display_name || r.id;
        out.push(h('button', { type: 'button', class: 'secondary small', 'data-action': 'reset-password', 'aria-label': 'Reset password of ' + who, onclick: () => askReset(r) }, 'Reset password'));
        if (r.paused) out.push(h('button', { type: 'button', class: 'secondary small', 'data-action': 'clear-pause', 'aria-label': 'Clear the pause of ' + who, onclick: () => clearPause(r) }, 'Clear pause'));
      }
      return out;
    }

    // A temporary password is shown once, here, and never again (spec 4.6).
    function showTemp(name, password) {
      clear(formBox);
      const code = h('code', { 'data-slot': 'temp-value' }, password);
      const copied = h('span', { role: 'status', 'data-slot': 'copied' });
      const copy = h('button', { type: 'button', class: 'secondary small', 'data-action': 'copy-password', onclick: async () => {
        try { await navigator.clipboard.writeText(password); copied.textContent = ' Copied.'; } catch (e) { copied.textContent = ' Select the password and copy it by hand.'; }
      } }, 'Copy');
      formBox.appendChild(h('div', { class: 'panel temp-password', 'data-slot': 'temp-password', role: 'alert' },
        h('h3', {}, 'Temporary password for ' + name),
        h('p', {}, code, ' ', copy, copied),
        h('p', {}, 'Give this password to the user in person. It is not shown again. They must choose their own password at the first sign-in.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', onclick: closeForm }, 'Done'))));
    }

    function askReset(r) {
      clear(formBox);
      const name = r.display_name || r.id;
      formBox.appendChild(h('div', { class: 'panel', 'data-slot': 'confirm-reset' },
        h('h3', {}, 'Reset the password of ' + name + '?'),
        h('p', {}, 'A new temporary password is made. Their sessions end now, and they must choose a new password at the next sign-in.'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', 'data-action': 'confirm-reset', onclick: () => doReset(r) }, 'Reset password'),
          h('button', { type: 'button', class: 'secondary', onclick: closeForm }, 'Cancel'))));
    }

    async function doReset(r) {
      setMessage(msg, 'ok', '');
      try {
        const out = await Api.call(cfg.method + '.resetPassword', { id: r.id, row_version: r.row_version });
        await reload('Password reset.');
        showTemp(r.display_name, out.temporary_password);
      } catch (e) {
        closeForm();
        conflictOrError(e);
      }
    }

    async function clearPause(r) {
      setMessage(msg, 'ok', '');
      try {
        await Api.call(cfg.method + '.clearCooldown', { id: r.id, row_version: r.row_version });
        await reload('The pause was cleared.');
      } catch (e) {
        conflictOrError(e);
      }
    }

    async function toggle(r) {
      setMessage(msg, 'ok', '');
      try {
        await Api.call(cfg.method + (r.is_active ? '.deactivate' : '.reactivate'), { id: r.id, row_version: r.row_version });
        await reload(r.is_active ? 'Deactivated.' : 'Reactivated.');
      } catch (e) {
        conflictOrError(e);
      }
    }

    function conflictOrError(e) {
      if (e.code === 'CONFLICT') {
        const btn = h('button', { type: 'button', class: 'secondary small', onclick: () => { closeForm(); reload('Reloaded.').catch((x) => setMessage(msg, 'error', errText(x))); } }, 'Reload');
        setMessage(msg, 'error', errText(e) + ' ', btn);
      } else {
        setMessage(msg, 'error', errText(e));
      }
    }

    function closeForm() { clear(formBox); }

    function control(f, value, editing) {
      const id = 'f-' + cfg.method + '-' + f.name;
      const disabled = editing && f.fixed;
      let input;
      if (f.type === 'select') {
        input = h('select', { id: id, name: f.name, disabled: disabled });
        input.appendChild(h('option', { value: '' }, f.required ? 'Choose' : 'None'));
        const opts = refs.options[f.source].slice();
        if (value && !opts.some((o) => o.value === value)) opts.push({ value: value, label: (refs.brandName[value] || refs.regionName[value] || value) + ' (inactive)' });
        opts.forEach((o) => input.appendChild(h('option', { value: o.value }, o.label)));
        input.value = value || '';
      } else if (f.type === 'checkbox') {
        input = h('input', { id: id, name: f.name, type: 'checkbox', checked: !!value });
        return h('div', { class: 'field', 'data-field': f.name }, h('label', { for: id }, input, ' ', f.label));
      } else {
        input = h('input', { id: id, name: f.name, type: f.type === 'number' ? 'number' : 'text', value: value === null || value === undefined ? '' : String(value), disabled: disabled, autocomplete: 'off' });
      }
      return h('div', { class: 'field', 'data-field': f.name },
        h('label', { for: id }, h('span', {}, f.label + (f.required ? '' : ' (optional)'))), input,
        f.hint ? h('small', {}, f.hint) : null);
    }

    function readValue(form, f) {
      const el = form.elements[f.name];
      if (f.type === 'checkbox') return el.checked;
      const raw = el.value.trim();
      if (f.type === 'number') return raw === '' ? null : Number(raw);
      return raw === '' ? null : raw;
    }

    function openForm(row) {
      clear(formBox);
      setMessage(msg, 'ok', '');
      const editing = !!row;
      const form = h('form', { class: 'panel', novalidate: true, 'aria-label': (editing ? 'Edit ' : 'Add ') + cfg.noun });
      form.appendChild(h('h3', {}, (editing ? 'Edit ' : 'Add ') + cfg.noun));
      form.appendChild(h('div', { 'data-slot': 'form-message', role: 'alert' }));
      form.appendChild(h('div', { class: 'form-grid' }, cfg.fields.map((f) => control(f, row ? row[f.name] : '', editing))));
      const save = h('button', { type: 'submit' }, editing ? 'Save changes' : 'Add ' + cfg.noun);
      form.appendChild(h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'secondary', onclick: closeForm }, 'Cancel')));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        let created = null;
        form.querySelectorAll('.has-error').forEach((x) => x.classList.remove('has-error'));
        form.querySelectorAll('.error-text').forEach((x) => x.remove());
        setMessage(slot(form, 'form-message'), 'error', '');
        save.disabled = true;
        try {
          if (editing) {
            const patch = {};
            cfg.fields.forEach((f) => {
              if (f.fixed) return;
              const now = readValue(form, f);
              const was = row[f.name] === undefined || row[f.name] === '' ? null : row[f.name];
              if (now !== was) patch[f.name] = now;
            });
            await Api.call(cfg.method + '.update', { id: row.id, row_version: row.row_version, patch: patch });
          } else {
            const values = {};
            cfg.fields.forEach((f) => { const x = readValue(form, f); if (x !== null && x !== '') values[f.name] = x; else if (f.type === 'checkbox') values[f.name] = false; });
            created = await Api.call(cfg.method + '.create', values);
          }
          closeForm();
          await reload(editing ? 'Saved.' : 'Added.');
          if (created && created.temporary_password) showTemp(created.user.display_name, created.temporary_password);
        } catch (e) {
          save.disabled = false;
          if (e.code === 'CONFLICT') { conflictOrError(e); closeForm(); return; }
          if (e.code === 'VALIDATION' && e.fields) {
            e.fields.forEach((fe) => {
              const wrap = form.querySelector('[data-field="' + String(fe.path).replace(/^patch\./, '') + '"]');
              if (wrap) { wrap.classList.add('has-error'); wrap.appendChild(h('div', { class: 'error-text' }, fe.message)); }
            });
          }
          setMessage(slot(form, 'form-message'), 'error', errText(e));
        }
      });
      formBox.appendChild(form);
      const first = form.querySelector('input:not([disabled]), select:not([disabled])');
      if (first) first.focus();
    }

    addBtn.addEventListener('click', () => openForm(null));
    search.addEventListener('input', draw);
    await reload();
  }

  // ---------- settings ----------
  async function renderSettings(main) {
    const v = tpl('view-settings');
    main.appendChild(v);
    const msg = slot(v, 'message'), formBox = slot(v, 'form'), tableBox = slot(v, 'table'), histBox = slot(v, 'history');
    slot(v, 'intro').textContent = isAdmin()
      ? 'Each change is a new version with a reason. Older versions stay in the history.'
      : 'You can read the settings. Only Admin changes them.';

    async function load(okText) {
      const items = await Api.call('settings.list');
      clear(tableBox);
      const cols = [
        { label: 'Setting', key: 'label' }, { label: 'Group', key: 'group' },
        { label: 'Value', value: (r) => (r.value === null ? 'Not set' : r.value) },
        { label: 'Version', key: 'version' }, { label: 'In force since', key: 'effective_from' },
        { actions: (r) => [
          h('button', { type: 'button', class: 'secondary small', 'data-action': 'history', 'aria-label': 'History of ' + r.label, onclick: () => history(r) }, 'History'),
          isAdmin() ? h('button', { type: 'button', class: 'small', 'data-action': 'change', 'aria-label': 'Change ' + r.label, onclick: () => change(r) }, 'Change') : null,
        ] },
      ];
      tableBox.appendChild(grid(cols, items));
      if (okText) setMessage(msg, 'ok', okText);
    }

    async function history(item) {
      clear(histBox);
      const data = await Api.call('settings.get', { setting_key: item.setting_key });
      histBox.appendChild(h('section', { class: 'section', 'data-section': 'history' },
        h('h2', {}, 'History of ' + item.label),
        grid([{ label: 'Version', key: 'version' }, { label: 'Value', key: 'value' }, { label: 'From', key: 'effective_from' }, { label: 'Reason', key: 'reason' }],
          data.versions.slice().reverse())));
    }

    function change(item) {
      clear(formBox);
      setMessage(msg, 'ok', '');
      const form = h('form', { class: 'panel', novalidate: true, 'aria-label': 'Change ' + item.label },
        h('h3', {}, 'Change: ' + item.label),
        h('div', { 'data-slot': 'form-message', role: 'alert' }),
        h('p', {}, 'Now: ' + (item.value === null ? 'not set' : item.value) + (item.value_type === 'intset' ? '. Type whole numbers separated by /, for example 30/40/30.' : '.')),
        h('div', { class: 'field', 'data-field': 'value' }, h('label', { for: 's-value' }, h('span', {}, 'New value')), h('input', { id: 's-value', name: 'value', type: 'text', autocomplete: 'off' })),
        h('div', { class: 'field', 'data-field': 'reason' }, h('label', { for: 's-reason' }, h('span', {}, 'Reason')), h('textarea', { id: 's-reason', name: 'reason' }),
          h('small', {}, 'Required. It is kept with the new version.')),
        h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save new version'), h('button', { type: 'button', class: 'secondary', onclick: () => clear(formBox) }, 'Cancel')));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        form.querySelectorAll('.has-error').forEach((x) => x.classList.remove('has-error'));
        form.querySelectorAll('.error-text').forEach((x) => x.remove());
        const params = { setting_key: item.setting_key, value: form.elements.value.value, reason: form.elements.reason.value };
        if (item.id) params.supersedes_id = item.id;
        try {
          await Api.call('settings.set', params);
          clear(formBox);
          await load('Saved as a new version.');
          if (histBox.firstChild) await history(item);
        } catch (e) {
          if (e.code === 'CONFLICT') { clear(formBox); setMessage(msg, 'error', errText(e), h('button', { type: 'button', class: 'secondary small', onclick: () => load('Reloaded.') }, 'Reload')); return; }
          (e.fields || []).forEach((fe) => {
            const wrap = form.querySelector('[data-field="' + fe.path + '"]');
            if (wrap) { wrap.classList.add('has-error'); wrap.appendChild(h('div', { class: 'error-text' }, fe.message)); }
          });
          setMessage(slot(form, 'form-message'), 'error', errText(e));
        }
      });
      formBox.appendChild(form);
      form.elements.value.focus();
    }

    await load();
  }

  // ---------- seed ----------
  function countsTable(created) {
    return grid([{ label: 'Table', key: 'table' }, { label: 'Records', key: 'n' }], Object.keys(created).map((t) => ({ table: t, n: created[t] })));
  }

  function problemsTable(title, rows, withRow) {
    if (!rows.length) return null;
    const cols = [{ label: 'Table', key: 'table' }].concat(withRow ? [{ label: 'Row', key: 'row' }] : [], [{ label: 'Value', key: 'value' }, { label: 'Reason', key: 'reason' }]);
    return h('section', { class: 'section' }, h('h3', {}, title + ' (' + rows.length + ')'), grid(cols, rows));
  }

  async function renderSeed(main) {
    const v = tpl('view-seed');
    main.appendChild(v);
    const msg = slot(v, 'message'), out = slot(v, 'result'), check = slot(v, 'check'), run = slot(v, 'run');

    function show(res, heading) {
      clear(out);
      out.append(h('h2', {}, heading), countsTable(res.created),
        problemsTable('Skipped', res.skipped, false) || '', problemsTable('Rejected', res.rejected, true) || '');
    }

    check.addEventListener('click', async () => {
      check.disabled = true;
      setMessage(msg, 'ok', '');
      try {
        const res = await Api.call('seed.run', { dry_run: true });
        show(res, 'Check result: what the seed would create');
        run.disabled = false;
      } catch (e) { setMessage(msg, 'error', errText(e)); } finally { check.disabled = false; }
    });
    run.addEventListener('click', async () => {
      run.disabled = true;
      setMessage(msg, 'ok', '');
      try {
        const res = await Api.call('seed.run', {});
        show(res, 'Seed done: what was created');
        setMessage(msg, 'ok', 'The seed ran. Batch ' + res.batch_id + '.');
      } catch (e) { setMessage(msg, 'error', errText(e)); }
    });
  }

  // ---------- import review ----------
  const REVIEW_TABS = ['persons_proposed', 'possible_duplicates', 'name_mapping', 'bad_values', 'uniform_split'];

  async function renderImport(main) {
    const v = tpl('view-import');
    main.appendChild(v);
    const msg = slot(v, 'message'), out = slot(v, 'result'), run = slot(v, 'run');

    function show(status, counts, heading) {
      clear(out);
      const rows = REVIEW_TABS.map((t) => ({ tab: t, rows: counts[t] === undefined ? '' : counts[t] }))
        .concat([{ tab: 'summary', rows: counts.summary === undefined ? '' : counts.summary }]);
      out.append(h('h2', {}, heading),
        h('dl', { class: 'kv' }, h('dt', {}, 'Status'), h('dd', { 'data-slot': 'status' }, status),
          h('dt', {}, 'MASTER_LOG rows'), h('dd', {}, counts.master_log_rows === undefined ? '' : counts.master_log_rows),
          h('dt', {}, 'UNIFORM_LOG rows'), h('dd', {}, counts.uniform_log_rows === undefined ? '' : counts.uniform_log_rows)),
        grid([{ label: 'Review tab', key: 'tab' }, { label: 'Rows', key: 'rows' }], rows));
    }

    const last = await Api.call('importReview.get');
    if (last.last_run) show(last.last_run.status, last.counts, 'Last run, ' + stamp(last.last_run.finished_at));

    run.addEventListener('click', async () => {
      run.disabled = true;
      setMessage(msg, 'ok', '');
      try {
        const res = await Api.call('importReview.run');
        if (res.status === 'Failed') { setMessage(msg, 'error', 'The review failed: ' + res.message); clear(out); } else {
          show(res.status, res.counts, 'Run finished');
          setMessage(msg, 'ok', 'The review is written to the review sheet.');
        }
      } catch (e) { setMessage(msg, 'error', errText(e)); } finally { run.disabled = false; }
    });
  }

  // ---------- audit log ----------
  async function renderAudit(main) {
    const v = tpl('view-audit');
    main.appendChild(v);
    const msg = slot(v, 'message'), tableBox = slot(v, 'table'), more = slot(v, 'more'), filters = slot(v, 'filters');
    let rows = [];
    let cursor = null;

    function draw() {
      clear(tableBox);
      const cols = [{ label: 'When', value: (r) => stamp(r.at) }, { label: 'User', key: 'user_id' }, { label: 'Event', key: 'event' },
        { label: 'Table', key: 'entity' }, { label: 'Record', key: 'entity_id' }, { label: 'Result', value: (r) => h('span', { class: 'tag' + (r.result === 'OK' ? '' : ' bad') }, r.result) }];
      if (rows.length && 'hr_employee_no' in rows[0]) cols.splice(2, 0, { label: 'HR number', key: 'hr_employee_no' });
      tableBox.appendChild(grid(cols, rows, 'No audit rows match.'));
      more.hidden = !cursor;
    }

    async function load(reset) {
      const f = {};
      ['event', 'entity'].forEach((k) => { const x = filters.elements[k].value.trim(); if (x) f[k] = x; });
      const params = { page_size: 25 };
      if (Object.keys(f).length) params.filters = f;
      if (!reset && cursor) params.cursor = cursor;
      setMessage(msg, 'ok', '');
      try {
        const env = await Api.callFull('audit.list', params);
        rows = reset ? env.data : rows.concat(env.data);
        cursor = env.meta.page ? env.meta.page.next_cursor : null;
        draw();
      } catch (e) { setMessage(msg, 'error', errText(e)); }
    }

    filters.addEventListener('submit', (ev) => { ev.preventDefault(); load(true); });
    more.addEventListener('click', () => load(false));
    await load(true);
  }

  // ---------- start ----------
  function start() {
    Api.configure({ onSessionEnd: () => endSession('Your session has ended. Sign in again.') });
    $('#signin-form').addEventListener('submit', submitSignIn);
    $('#pw-form').addEventListener('submit', submitPassword);
    $('#pw-cancel').addEventListener('click', () => showApp());
    $('#pw-signout').addEventListener('click', signOut);
    $('#change-password').addEventListener('click', () => showPassword(false));
    $('#signout').addEventListener('click', signOut);
    ['click', 'keydown', 'pointerdown', 'touchstart'].forEach((t) => document.addEventListener(t, onActivity, { passive: true }));
    showSignIn('');
  }

  window.TLMI = { start: start };
  // What the other client scripts share. They still reach the server only through Api.
  window.App = {
    ROLE: ROLE, h: h, clear: clear, tpl: tpl, slot: slot, notice: notice, setMessage: setMessage, errText: errText,
    grid: grid, fetchAll: fetchAll, registerNav: registerNav, user: () => state.user, go: go,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
