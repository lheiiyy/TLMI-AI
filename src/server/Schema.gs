// Every Phase 1 table, as data (spec sections 3, 7 and 9). The repository and the validator read this file.
// Names, ID prefixes and profiles follow TDMS DATA-MODEL (section 1.1 profiles, section 2 IDs).
//   MUT mutable        id + fields + created_at, created_by, updated_at, updated_by, is_active, row_version
//   APP append-only    id + fields + stamp columns (created_at, created_by unless def.stamp renames them)
//   VER versioned      id + fields + effective_from, supersedes_id, created_at, created_by
//   SYS system         id + fields
const Schema = (function () {
  const ROLES = ['Training Officer', 'Training Supervisor', 'Training Manager', 'Senior Training Manager', 'Admin'];
  const STAMP_DEFAULT = { at: 'created_at', by: 'created_by' };
  // Team Leader statuses (TDMS WF-002). Open: Entry, Probationary, Certification check, Extended. Certified is closed until Promoted.
  const TL_STATUSES = ['Entry', 'Probationary', 'Certification check', 'Certified', 'Extended', 'Failed', 'Quit', 'Promoted'];
  const TL_OPEN_STATUSES = ['Entry', 'Probationary', 'Certification check', 'Extended'];

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
        hr_employee_no: { type: 'text', max: 20, unique: [], pattern: /^\d{1,20}$/, patternMessage: 'Digits only.' },
        display_name: { type: 'text', required: true, max: 150 },
        role: { type: 'text', required: true, enum: ROLES },
        password_hash: { type: 'text', max: 200 },
        salt: { type: 'text', max: 200 },
        must_change_password: { type: 'bool' },
        failed_attempts: { type: 'int', noHistory: true },
        cooldown_until: { type: 'timestamp', noHistory: true },
        last_login_at: { type: 'timestamp', noHistory: true },
      },
    },
    persons: {
      idPrefix: 'PER-', idWidth: 6, profile: 'MUT', history: 'F',
      fields: {
        last_name: { type: 'text', required: true, max: 100 },
        first_name: { type: 'text', required: true, max: 100 },
        middle_name: { type: 'text', max: 100 },
        suffix: { type: 'text', max: 20 },
        hr_employee_no: { type: 'text', max: 20, unique: [], pattern: /^\d{1,20}$/, patternMessage: 'Digits only.' },
        legacy_ref: { type: 'text', max: 150 },
      },
    },
    person_aliases: {
      idPrefix: 'PAL-', idWidth: 6, profile: 'APP', history: 'A', appendOnly: true,
      fields: {
        person_id: { type: 'text', required: true, max: 40, ref: 'persons' },
        alias_type: { type: 'text', required: true, enum: ['NAME', 'HR_NO', 'TEMP'] },
        value: { type: 'text', required: true, max: 200 },
        valid_from: { type: 'date' },
        valid_to: { type: 'date' },
      },
    },
    tl_enrollments: {
      idPrefix: 'TLE-', idWidth: 4, idYear: true, profile: 'MUT', history: 'S+F',
      fields: {
        person_id: { type: 'text', required: true, max: 40, ref: 'persons' },
        mother_location_id: { type: 'text', required: true, max: 40, ref: 'locations' },
        support_location_id: { type: 'text', max: 40, ref: 'locations' },
        station_id: { type: 'text', max: 40, ref: 'stations' },
        batch_code: { type: 'text', max: 50 },
        entry_date: { type: 'date', required: true },
        deadline: { type: 'date', required: true },
        status: { type: 'text', required: true, enum: TL_STATUSES },
        close_reason_id: { type: 'text', max: 40, ref: 'lookups' },
        quit_reason_lookup_id: { type: 'text', max: 40, ref: 'lookups' },
        quit_date: { type: 'date' },
        certified_on: { type: 'date' },
        promoted_on: { type: 'date' },
        final_grade: { type: 'number', min: 0, max: 100, decimals: 2 },
        pass_mark_used: { type: 'int', min: 1, max: 100 },
        weights_version: { type: 'text', max: 100 },
        visit_report_url: { type: 'text', max: 500 },
        remarks: { type: 'text', max: 2000 },
        legacy_ref: { type: 'text', max: 150 },
      },
    },
    assessments: {
      idPrefix: 'ASM-', idWidth: 6, idYear: true, profile: 'APP', history: 'A', appendOnly: true,
      fields: {
        subject_type: { type: 'text', required: true, enum: ['TL_ENROLLMENT'] },
        subject_id: { type: 'text', required: true, max: 40 },
        component_id: { type: 'text', required: true, max: 40, ref: 'assessment_components' },
        score: { type: 'number', required: true, min: 0, max: 100, decimals: 2 },
        assessed_on: { type: 'date', required: true },
        assessed_by: { type: 'text', max: 40 },
        retake_no: { type: 'int', required: true, min: 0, max: 99 },
        remark: { type: 'text', max: 500 },
        supersedes_id: { type: 'text', max: 40 },
        correction_reason: { type: 'text', max: 500 },
        legacy_ref: { type: 'text', max: 150 },
      },
    },
    tl_extensions: {
      idPrefix: 'TLX-', idWidth: 6, profile: 'APP', history: 'A', appendOnly: true,
      fields: {
        tl_enrollment_id: { type: 'text', required: true, max: 40 },
        extension_no: { type: 'int', required: true, min: 1, max: 99 },
        old_deadline: { type: 'date', required: true },
        new_deadline: { type: 'date', required: true },
        reason: { type: 'text', required: true, max: 500 },
      },
    },
    tl_certifying_officers: {
      idPrefix: 'TLO-', idWidth: 6, profile: 'APP', history: 'A', appendOnly: true,
      fields: {
        tl_enrollment_id: { type: 'text', required: true, max: 40 },
        user_id: { type: 'text', required: true, max: 40, ref: 'users' },
        retake_no: { type: 'int', required: true, min: 1, max: 99 },
      },
    },
    status_history: {
      // Shares the HIS counter with record_history, so a history ID is unique across both (the counter key is the prefix).
      idPrefix: 'HIS-', idWidth: 6, profile: 'APP', history: 'A', appendOnly: true,
      stamp: { at: 'at', by: 'user_id' },
      fields: {
        entity: { type: 'text', required: true, max: 60 },
        entity_id: { type: 'text', required: true, max: 60 },
        from_status: { type: 'text', max: 40 },
        to_status: { type: 'text', required: true, max: 40 },
        effective_date: { type: 'date', required: true },
        remark: { type: 'text', max: 1000 },
        request_id: { type: 'text', max: 60 },
      },
    },
    import_rows: {
      idPrefix: 'IMR-', idWidth: 6, profile: 'MUT', history: 'A',
      fields: {
        import_id: { type: 'text', required: true, max: 40, ref: 'import_batches' },
        source_tab: { type: 'text', required: true, max: 60 },
        source_row: { type: 'int', required: true },
        row_hash: { type: 'text', max: 80 },
        raw: { type: 'json' },
        result: { type: 'text', required: true, enum: ['READY', 'NOT_READY', 'SKIPPED', 'COMMITTED', 'ALREADY_COMMITTED'] },
        issues: { type: 'json' },
        skip_reason: { type: 'text', max: 500 },
        created_record_type: { type: 'text', max: 60 },
        created_record_id: { type: 'text', max: 60 },
        legacy_ref: { type: 'text', max: 150 },
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
        kind: { type: 'text', required: true, enum: ['SEED', 'IMPORT_REVIEW', 'LEGACY_TL'] },
        status: { type: 'text', required: true, enum: ['Running', 'Done', 'Failed', 'Validated', 'Committing', 'Committed', 'Superseded'] },
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
    TL_STATUSES: TL_STATUSES,
    TL_OPEN_STATUSES: TL_OPEN_STATUSES,
    table: table,
    names() { return Object.keys(TABLES); },
    columns: columns,
    profileColumns: profileColumns,
    inputDef: inputDef,
    columnType: columnType,
    formatId: formatId,
  };
})();
