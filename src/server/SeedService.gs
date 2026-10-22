// One-time, re-runnable seed of the master data from a copy of the legacy sheet (spec section 7).
// Reads only the copy (LEGACY_COPY_ID). Skips rows that exist, validates each row on its own, writes one
// import_batches row per real run. dry_run reports the same counts and writes nothing.
const SeedService = (function () {
  const BRAND = { name: "Angel's Pizza", code: 'AP' };
  const LOCATION_TYPES = [['Store', true], ['Commissary', false], ['Office', false], ['Call Center', false], ['Warehouse', false]];
  const STATIONS = ['Food Prep', 'Pizza Maker', 'Cashier', 'Service', 'Commis', 'Dough Maker'];
  const ENTRY_COMPONENTS = ['ISTV', 'Tech Val Food Prep', 'Tech Val Pizza Maker', 'TL entry exam Food Prep', 'TL entry exam Pizza Maker'];
  const CERT_COMPONENTS = [['Checklist', true], ['Exam', true], ['Kitchen feedback', false], ['Manager feedback', false], ['TL course program', true]];
  // CFG-047 (extension limit) is deliberately absent: it stays unset until Admin decides (RULE-104).
  // TLMI-001 (TL course program pass mark) is seeded at 90 (spec section 5).
  const SETTING_VALUES = [
    ['CFG-001', '30'], ['CFG-002', '5'], ['CFG-003', '15'], ['CFG-040', '3'],
    ['CFG-041', '85'], ['CFG-042', '30'], ['CFG-044', '30/40/30'], ['CFG-045', '60/40'],
    ['TLMI-001', '90'],
  ];

  const key = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');

  function legacyId() {
    const id = Props.get('LEGACY_COPY_ID');
    if (!id) throw Errors.configMissing('LEGACY_COPY_ID');
    return id;
  }

  function run(ctx, p) {
    const dry = p.dry_run === true;
    const id = legacyId();
    const settingsTab = Repository.readExternal(id, 'SETTINGS');
    const officersTab = Repository.readExternal(id, 'SEED_OFFICERS');
    const startedAt = ctx.now;
    const sourceRows = settingsTab.length + Math.max(0, officersTab.length - 1);

    return Repository.transact((uow) => {
      const actor = { userId: ctx.userId, now: ctx.now };
      const created = { brands: 0, regions: 0, lookups: 0, stations: 0, assessment_components: 0, settings: 0, locations: 0, users: 0 };
      const skipped = [];
      const rejected = [];
      const exists = (table, value) => skipped.push({ table: table, value: value, reason: 'EXISTS' });
      // One audit row per created record, with the event names the services use (CLAUDE.md: every change is audited).
      const made = (event, table, row, extra) => {
        AuditService.event(uow, ctx, { event: event, entity: table, entityId: row.id, detail: Object.assign({ source: 'SEED' }, extra || {}) });
        return row;
      };

      // 1. brand
      let brand = uow.all('brands').find((b) => b.code === BRAND.code);
      if (brand) exists('brands', BRAND.name);
      else { brand = made('MASTER.BRAND.CREATED', 'brands', uow.insert('brands', BRAND, actor)); created.brands++; }

      // 2. regions: distinct values of column B, first spelling wins. A different spelling of a region seen before
      // (case or spacing only) is skipped and reported once; an exact repeat is not reported (every store repeats its region).
      const regionByKey = new Map();
      uow.all('regions').forEach((r) => regionByKey.set(key(r.name), r));
      const seenRegion = new Map();
      settingsTab.forEach((row) => {
        const name = tidy(row[1]);
        if (name === '') return;
        if (seenRegion.has(key(name))) {
          const spellings = seenRegion.get(key(name));
          if (!spellings.has(name)) { spellings.add(name); skipped.push({ table: 'regions', value: name, reason: 'DUPLICATE_IN_SOURCE' }); }
          return;
        }
        seenRegion.set(key(name), new Set([name]));
        if (regionByKey.has(key(name))) { exists('regions', name); return; }
        regionByKey.set(key(name), made('MASTER.REGION.CREATED', 'regions', uow.insert('regions', { name: name }, actor)));
        created.regions++;
      });

      // 3. lookups
      const haveLookup = (cat, val) => uow.all('lookups').some((l) => l.category === cat && key(l.value) === key(val));
      const addLookup = (cat, val, system, order) => {
        if (haveLookup(cat, val)) { exists('lookups', cat + ':' + val); return; }
        made('LOOKUP.CREATED', 'lookups', uow.insert('lookups', { category: cat, value: val, label: val, sort_order: order, is_system: system }, actor));
        created.lookups++;
      };
      LOCATION_TYPES.forEach((t, i) => addLookup('location_type', t[0], t[1], i + 1));
      addLookup('tl_close_reason', 'Disqualified', true, 1);

      // 4. stations
      STATIONS.forEach((name) => {
        if (uow.all('stations').some((s) => s.brand_id === brand.id && key(s.name) === key(name))) { exists('stations', name); return; }
        made('MASTER.STATION.CREATED', 'stations', uow.insert('stations', { name: name, brand_id: brand.id }, actor));
        created.stations++;
      });

      // 5. assessment components
      const addComponent = (name, stage, required) => {
        if (uow.all('assessment_components').some((c) => key(c.name) === key(name))) { exists('assessment_components', name); return; }
        made('COMPONENT.CREATED', 'assessment_components', uow.insert('assessment_components', { name: name, stage: stage, required: required }, actor));
        created.assessment_components++;
      };
      ENTRY_COMPONENTS.forEach((n) => addComponent(n, 'entry', true));
      CERT_COMPONENTS.forEach((c) => addComponent(c[0], 'certification', c[1]));

      // 6. settings (version 1)
      SETTING_VALUES.forEach((s) => {
        if (uow.all('settings').some((r) => r.setting_key === s[0])) { exists('settings', s[0]); return; }
        const def = SettingsService.SETTING_DEFS[s[0]];
        const row = uow.insert('settings', {
          setting_key: s[0], value: s[1], value_type: def.value_type, version: 1, reason: 'Initial seed', effective_from: Clock.today(),
        }, actor);
        made('SETTING.CHANGED', 'settings', row, { setting_key: s[0], old_value: null, new_value: s[1], effective_from: row.effective_from, reason: 'Initial seed' });
        created.settings++;
      });

      // 7. locations (stores)
      const existingStore = new Set(uow.all('locations').map((l) => key(l.name)));
      const seenStore = new Set();
      settingsTab.forEach((row, i) => {
        const rowNo = i + 1;
        const raw = String(row[0] === undefined ? '' : row[0]).trim();
        const name = tidy(row[0]);
        if (name === '') { rejected.push({ table: 'locations', row: rowNo, value: '', reason: 'NAME_MISSING' }); return; }
        if (existingStore.has(key(name))) { skipped.push({ table: 'locations', value: raw, reason: 'EXISTS' }); return; }
        if (seenStore.has(key(name))) { skipped.push({ table: 'locations', value: raw, reason: 'DUPLICATE_IN_SOURCE' }); return; }
        const region = regionByKey.get(key(tidy(row[1])));
        if (!region) { rejected.push({ table: 'locations', row: rowNo, value: name, reason: 'REGION_MISSING' }); return; }
        seenStore.add(key(name));
        made('LOCATION.CREATED', 'locations', uow.insert('locations', { name: name, location_type: 'Store', brand_id: brand.id, region_id: region.id }, actor));
        created.locations++;
      });

      // 8. users (officers)
      const head = (officersTab[0] || []).map((h) => tidy(h).toLowerCase());
      const col = (name) => head.indexOf(name);
      const iName = col('display_name'), iRole = col('role'), iNo = col('hr_employee_no'), iActive = col('is_active');
      if (iName < 0 || iRole < 0) {
        throw Errors.validation([{ path: 'SEED_OFFICERS', code: 'HEADER_MISSING', message: 'SEED_OFFICERS needs display_name and role columns.' }]);
      }
      officersTab.slice(1).forEach((row, i) => {
        const rowNo = i + 2;
        const raw = String(row[iName] === undefined ? '' : row[iName]).trim();
        const name = tidy(raw);
        const role = tidy(row[iRole]);
        const no = iNo >= 0 ? tidy(row[iNo]) : '';
        if (name === '') { rejected.push({ table: 'users', row: rowNo, value: '', reason: 'NAME_MISSING' }); return; }
        if (Schema.ROLES.indexOf(role) < 0) { rejected.push({ table: 'users', row: rowNo, value: name, reason: 'ROLE_UNKNOWN' }); return; }
        const users = uow.all('users');
        if (users.some((u) => key(u.display_name) === key(name))) { skipped.push({ table: 'users', value: raw, reason: 'EXISTS' }); return; }
        if (no !== '' && users.some((u) => u.hr_employee_no === no)) { rejected.push({ table: 'users', row: rowNo, value: name, reason: 'HR_NUMBER_DUPLICATE' }); return; }
        const user = uow.insert('users', no === '' ? { display_name: name, role: role } : { display_name: name, role: role, hr_employee_no: no }, actor);
        made('USER.CREATED', 'users', user, { role: role });
        if (iActive >= 0 && /^(false|no|0)$/i.test(tidy(row[iActive]))) {
          const off = uow.update('users', user.id, {}, { expectedVersion: 1, actor: actor, isActive: false });
          AuditService.changes(uow, ctx, 'users', user.id, off.before, off.after);
          made('USER.DEACTIVATED', 'users', user, { changed: off.changed });
        }
        created.users++;
      });

      let batchId = null;
      if (!dry) {
        const counts = { created: created, skipped: skipped.length, rejected: rejected.length };
        const batch = uow.insert('import_batches', {
          kind: 'SEED', status: 'Done', source_row_count: sourceRows, counts: JSON.stringify(counts),
          started_at: startedAt, finished_at: Clock.iso(),
        }, actor);
        batchId = batch.id;
        AuditService.event(uow, ctx, { event: 'SEED.RUN', entity: 'import_batches', entityId: batch.id, detail: counts });
      }
      return { batch_id: batchId, dry_run: dry, created: created, skipped: skipped, rejected: rejected };
    }, { dryRun: dry });
  }

  function methods() {
    return {
      'seed.run': {
        kind: 'W',
        params: { dry_run: { type: 'bool' } },
        handler: run,
      },
    };
  }

  return { methods: methods };
})();
