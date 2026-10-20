// Brands, regions, stations, locations (stores), lookups and assessment components (spec sections 5, 7, 8).
// Every write: validate, check links, write the row, one record_history row per changed field, one audit row.
const MasterDataService = (function () {
  // method prefix -> table, audit event prefix, list setup. Components have no create or deactivate (spec section 5).
  const ENTITIES = {
    brands: { table: 'brands', event: 'MASTER.BRAND', filters: ['is_active'], search: ['name', 'code'], sort: 'name' },
    regions: { table: 'regions', event: 'MASTER.REGION', filters: ['is_active'], search: ['name'], sort: 'name' },
    stations: { table: 'stations', event: 'MASTER.STATION', filters: ['brand_id', 'is_active'], search: ['name'], sort: 'name' },
    locations: { table: 'locations', event: 'LOCATION', filters: ['brand_id', 'region_id', 'location_type', 'is_active'], search: ['name'], sort: 'name' },
    lookups: { table: 'lookups', event: 'LOOKUP', filters: ['category', 'is_active'], search: ['value', 'label'], sort: 'sort_order', notInput: ['is_system'] },
    components: { table: 'assessment_components', event: 'COMPONENT', filters: ['stage', 'is_active'], search: ['name'], sort: 'name', only: ['list', 'get', 'update'] },
  };

  const actorOf = (ctx) => ({ userId: ctx.userId, now: ctx.now });

  // Param definition for create: the table's own fields, nothing else.
  function createParams(cfg) {
    const def = Schema.table(cfg.table);
    const out = {};
    Object.keys(def.fields).forEach((f) => {
      if (cfg.notInput && cfg.notInput.indexOf(f) >= 0) return;
      const s = def.fields[f];
      const p = { type: s.type };
      if (s.required) p.required = true;
      if (s.max) p.max = s.max;
      if (s.enum) p.enum = s.enum;
      out[f] = p;
    });
    return out;
  }

  function sortable(def) {
    return ['id', 'created_at', 'updated_at', 'is_active'].concat(Object.keys(def.fields));
  }

  // Every link must exist and be active (spec section 8 step 2). Only the link fields that are being written are checked.
  function checkLinks(uow, table, values) {
    const def = Schema.table(table);
    const errs = [];
    Object.keys(values).forEach((f) => {
      const spec = def.fields[f];
      const v = values[f];
      if (!spec || !spec.ref || v === null || v === undefined || v === '') return;
      const target = uow.get(spec.ref, v);
      if (!target || target.is_active === false) errs.push({ path: f, code: 'LINK', message: 'The linked record does not exist or is not active.' });
    });
    if (table === 'locations' && values.location_type) {
      const ok = uow.all('lookups').some((l) => l.category === 'location_type' && l.value === values.location_type && l.is_active);
      if (!ok) errs.push({ path: 'location_type', code: 'LINK', message: 'Not an active location type.' });
    }
    if (errs.length) throw Errors.validation(errs);
  }

  function writeChanges(uow, ctx, cfg, res, suffix) {
    AuditService.changes(uow, ctx, cfg.table, res.after.id, res.before, res.after);
    AuditService.event(uow, ctx, { event: cfg.event + '.' + suffix, entity: cfg.table, entityId: res.after.id, detail: { changed: res.changed } });
  }

  function listHandler(cfg) {
    const def = Schema.table(cfg.table);
    return (ctx, p) => {
      const r = Lists.run(Repository.all(cfg.table), p, { filters: cfg.filters, search: cfg.search, sortable: sortable(def), defaultSort: cfg.sort });
      return Api.paged(r.items, r.page);
    };
  }

  function getHandler(cfg) {
    return (ctx, p) => {
      const row = Repository.get(cfg.table, p.id);
      if (!row) throw Errors.notFound();
      return row;
    };
  }

  function createHandler(cfg) {
    return (ctx, p) => Repository.transact((uow) => {
      checkLinks(uow, cfg.table, p);
      const row = uow.insert(cfg.table, p, actorOf(ctx));
      AuditService.event(uow, ctx, { event: cfg.event + '.CREATED', entity: cfg.table, entityId: row.id, detail: p });
      return row;
    });
  }

  function updateHandler(cfg) {
    return (ctx, p) => Repository.transact((uow) => {
      const res = uow.update(cfg.table, p.id, p.patch, { expectedVersion: p.row_version, actor: actorOf(ctx) });
      if (res.changed.length === 0) return res.after;
      // Rules that need the stored row: checked after the in-memory update, before anything is written.
      if (cfg.table === 'lookups' && res.before.is_system && res.changed.some((f) => f === 'value' || f === 'label')) {
        throw Errors.validation([{ path: res.changed.indexOf('value') >= 0 ? 'value' : 'label', code: 'SYSTEM_VALUE', message: 'A system value cannot be renamed.' }]);
      }
      checkLinks(uow, cfg.table, p.patch);
      writeChanges(uow, ctx, cfg, res, 'UPDATED');
      return res.after;
    });
  }

  function activeHandler(cfg, active) {
    return (ctx, p) => Repository.transact((uow) => {
      const res = uow.update(cfg.table, p.id, {}, { expectedVersion: p.row_version, actor: actorOf(ctx), isActive: active });
      if (res.changed.length === 0) return res.after;
      if (cfg.table === 'lookups' && res.before.is_system && !active) {
        throw Errors.validation([{ path: 'is_active', code: 'SYSTEM_VALUE', message: 'A system value cannot be disabled.' }]);
      }
      writeChanges(uow, ctx, cfg, res, active ? 'REACTIVATED' : 'DEACTIVATED');
      return res.after;
    });
  }

  function methods() {
    const out = {};
    Object.keys(ENTITIES).forEach((prefix) => {
      const cfg = ENTITIES[prefix];
      const only = cfg.only || ['list', 'get', 'create', 'update', 'deactivate', 'reactivate'];
      const add = (name, def) => { if (only.indexOf(name) >= 0) out[prefix + '.' + name] = def; };
      const idRv = { id: { type: 'text', required: true, max: 40 }, row_version: { type: 'int', required: true } };
      add('list', { kind: 'R', params: Lists.PARAMS, handler: listHandler(cfg) });
      add('get', { kind: 'R', params: { id: { type: 'text', required: true, max: 40 } }, handler: getHandler(cfg) });
      add('create', { kind: 'W', params: createParams(cfg), handler: createHandler(cfg) });
      add('update', { kind: 'W', params: Object.assign({ patch: { type: 'object', required: true } }, idRv), handler: updateHandler(cfg) });
      add('deactivate', { kind: 'W', params: idRv, handler: activeHandler(cfg, false) });
      add('reactivate', { kind: 'W', params: idRv, handler: activeHandler(cfg, true) });
    });
    return out;
  }

  return { methods: methods, ENTITIES: ENTITIES };
})();
