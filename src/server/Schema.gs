// Every Phase 1 table, as data (spec sections 3, 7 and 9). The repository and the validator read this file.
// Names, ID prefixes and profiles follow TDMS DATA-MODEL (section 1.1 profiles, section 2 IDs).
//   MUT mutable        id + fields + created_at, created_by, updated_at, updated_by, is_active, row_version
//   APP append-only    id + fields + stamp columns (created_at, created_by unless def.stamp renames them)
//   VER versioned      id + fields + effective_from, supersedes_id, created_at, created_by
//   SYS system         id + fields
const Schema = (function () {
  const ROLES = ['Training Officer', 'Training Supervisor', 'Training Manager', 'Senior Training Manager', 'Admin'];
  const STAMP_DEFAULT = { at: 'created_at', by: 'created_by' };

  const TABLES = {
    brands: {
      idPrefix: 'BRD-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        name: { type: 'text', required: true, max: 100, unique: [] },
        code: { type: 'text', required: true, max: 20, immutable: true, unique: [] },
      },
    },
    regions: {
      idPrefix: 'REG-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        name: { type: 'text', required: true, max: 100, unique: [] },
      },
    },
    locations: {
      idPrefix: 'LOC-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        name: { type: 'text', required: true, max: 150, unique: ['brand_id'] },
        location_type: { type: 'text', required: true, max: 50 },
        brand_id: { type: 'text', required: true, ref: 'brands' },
        region_id: { type: 'text', ref: 'regions' },
      },
    },
    stations: {
      idPrefix: 'STN-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        name: { type: 'text', required: true, max: 100, unique: ['brand_id'] },
        brand_id: { type: 'text', required: true, ref: 'brands' },
      },
    },
    lookups: {
      idPrefix: 'LKP-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        category: { type: 'text', required: true, max: 50, immutable: true },
        value: { type: 'text', required: true, max: 100, unique: ['category'] },
        label: { type: 'text', required: true, max: 150 },
        sort_order: { type: 'int' },
        is_system: { type: 'bool', immutable: true },
      },
    },
    assessment_components: {
      idPrefix: 'CMP-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        name: { type: 'text', required: true, max: 100, unique: [] },
        stage: { type: 'text', required: true, enum: ['entry', 'certification'], immutable: true },
        required: { type: 'bool' },
        weight: { type: 'number' },
      },
    },
    settings: {
      idPrefix: 'SET-', idWidth: 4, profile: 'VER', history: 'V',
      fields: {
        setting_key: { type: 'text', required: true, max: 20, immutable: true },
        value: { type: 'text', required: true, max: 500 },
        value_type: { type: 'text', required: true, enum: ['int', 'text', 'intset'] },
        version: { type: 'int', required: true },
        reason: { type: 'text', max: 500 },
      },
    },
    users: {
      idPrefix: 'USR-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        hr_employee_no: { type: 'text', max: 20, unique: [] },
        display_name: { type: 'text', required: true, max: 150 },
        role: { type: 'text', required: true, enum: ROLES },
        password_hash: { type: 'text', max: 200 },
        salt: { type: 'text', max: 200 },
      },
    },
    audit_log: {
      idPrefix: 'AUD-', idWidth: 6, profile: 'APP', history: 'A', appendOnly: true,
      stamp: { at: 'at', by: 'user_id' },
      fields: {
        hr_employee_no: { type: 'text', max: 20 },
        event: { type: 'text', required: true, max: 60 },
        entity: { type: 'text', max: 60 },
        entity_id: { type: 'text', max: 60 },
        result: { type: 'text', required: true, enum: ['OK', 'DENIED', 'FAILED'] },
        request_id: { type: 'text', max: 60 },
        detail: { type: 'json' },
      },
    },
    record_history: {
      idPrefix: 'HIS-', idWidth: 6, profile: 'APP', history: 'F', appendOnly: true,
      stamp: { at: 'at', by: 'user_id' },
      fields: {
        entity: { type: 'text', required: true, max: 60 },
        entity_id: { type: 'text', required: true, max: 60 },
        field: { type: 'text', required: true, max: 60 },
        old_value: { type: 'text' },
        new_value: { type: 'text' },
        request_id: { type: 'text', max: 60 },
      },
    },
    id_counters: {
      idPrefix: 'CNT-', idWidth: 4, profile: 'SYS', history: '-',
      fields: {
        prefix: { type: 'text', required: true, max: 10 },
        year: { type: 'int' },
        last_value: { type: 'int', required: true },
      },
    },
    import_batches: {
      idPrefix: 'IMP-', idWidth: 4, profile: 'MUT', history: 'F',
      fields: {
        kind: { type: 'text', required: true, enum: ['SEED', 'IMPORT_REVIEW'] },
        status: { type: 'text', required: true, enum: ['Running', 'Done', 'Failed'] },
        source_row_count: { type: 'int' },
        counts: { type: 'json' },
        started_at: { type: 'timestamp' },
        finished_at: { type: 'timestamp' },
        note: { type: 'text', max: 1000 },
      },
    },
  };

  Object.keys(TABLES).forEach((name) => {
    const def = TABLES[name];
    def.name = name;
    def.tab = name;
    if (def.profile === 'APP' && !def.stamp) def.stamp = STAMP_DEFAULT;
  });

  const VER_INPUT = {
    effective_from: { type: 'date', required: true },
    supersedes_id: { type: 'text', max: 40, ref: 'settings' },
  };

  function table(name) {
    const def = TABLES[name];
    if (!def) throw new Error('Unknown table: ' + name);
    return def;
  }

  // Columns that the repository fills, not the caller.
  function profileColumns(def) {
    switch (def.profile) {
      case 'MUT': return ['created_at', 'created_by', 'updated_at', 'updated_by', 'is_active', 'row_version'];
      case 'APP': return [def.stamp.at, def.stamp.by];
      case 'VER': return ['effective_from', 'supersedes_id', 'created_at', 'created_by'];
      default: return [];
    }
  }

  function columns(name) {
    const def = table(name);
    return ['id'].concat(Object.keys(def.fields), profileColumns(def));
  }

  // The definition a caller may write: for a versioned table this adds effective_from and supersedes_id.
  function inputDef(def) {
    if (def.profile !== 'VER') return def;
    return { name: def.name, fields: Object.assign({}, def.fields, VER_INPUT) };
  }

  // Type of any column, including the profile columns.
  function columnType(def, col) {
    if (def.fields[col]) return def.fields[col].type;
    if (col === 'is_active') return 'bool';
    if (col === 'row_version') return 'int';
    if (col === 'effective_from') return 'date';
    if (col === 'created_at' || col === 'updated_at' || col === 'at') return 'timestamp';
    return 'text';
  }

  function formatId(name, n, year) {
    const def = table(name);
    return def.idPrefix + (def.idYear ? String(year) + '-' : '') + String(n).padStart(def.idWidth, '0');
  }

  return {
    ROLES: ROLES,
    table: table,
    names() { return Object.keys(TABLES); },
    columns: columns,
    profileColumns: profileColumns,
    inputDef: inputDef,
    columnType: columnType,
    formatId: formatId,
  };
})();
