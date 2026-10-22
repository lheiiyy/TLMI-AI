'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../helpers/loader');

const PHASE_1 = ['brands', 'regions', 'locations', 'stations', 'lookups', 'assessment_components', 'settings',
  'users', 'audit_log', 'record_history', 'id_counters', 'import_batches'];

// Phase 2 part 2B adds the Team Leader tables (Phase 2 spec section 5).
const PHASE_2B = ['persons', 'person_aliases', 'tl_enrollments', 'assessments', 'tl_extensions', 'tl_certifying_officers',
  'status_history', 'import_rows'];

test('Phase 1 defines its twelve tables of spec section 7, and part 2B adds exactly eight', () => {
  const { g, plain } = loadServer();
  assert.deepEqual(plain(g('Schema').names()).sort(), PHASE_1.concat(PHASE_2B).sort());
});

test('every table has id first and its profile columns last', () => {
  const { g, plain } = loadServer();
  const S = g('Schema');
  const tail = {
    MUT: ['created_at', 'created_by', 'updated_at', 'updated_by', 'is_active', 'row_version'],
    VER: ['effective_from', 'supersedes_id', 'created_at', 'created_by'],
  };
  for (const name of S.names()) {
    const def = S.table(name);
    const cols = plain(S.columns(name));
    assert.equal(cols[0], 'id', name);
    assert.equal(new Set(cols).size, cols.length, name + ' has duplicate columns');
    if (tail[def.profile]) assert.deepEqual(cols.slice(-tail[def.profile].length), tail[def.profile], name);
    if (def.profile === 'APP') assert.deepEqual(cols.slice(-2), [def.stamp.at, def.stamp.by], name);
    for (const f of Object.keys(def.fields)) assert.ok(cols.includes(f), name + '.' + f);
  }
});

test('column names are snake_case', () => {
  const { g, plain } = loadServer();
  const S = g('Schema');
  for (const name of S.names()) {
    for (const c of plain(S.columns(name))) assert.match(c, /^[a-z][a-z0-9_]*$/, name + '.' + c);
  }
});

test('formatId pads LOC-0001, USR-0001, AUD-000000', () => {
  const { g } = loadServer();
  const S = g('Schema');
  assert.equal(S.formatId('locations', 1), 'LOC-0001');
  assert.equal(S.formatId('users', 12), 'USR-0012');
  assert.equal(S.formatId('audit_log', 0), 'AUD-000000');
  assert.equal(S.formatId('audit_log', 123456), 'AUD-123456');
  assert.equal(S.formatId('record_history', 7), 'HIS-000007');
  assert.equal(S.formatId('brands', 3), 'BRD-0003');
});

test('audit_log and record_history are appendOnly', () => {
  const { g } = loadServer();
  const S = g('Schema');
  assert.equal(S.table('audit_log').appendOnly, true);
  assert.equal(S.table('record_history').appendOnly, true);
  assert.equal(!!S.table('brands').appendOnly, false);
});

test('every ref points to an existing table', () => {
  const { g } = loadServer();
  const S = g('Schema');
  const names = S.names();
  for (const name of names) {
    const def = S.table(name);
    for (const [f, spec] of Object.entries(def.fields)) {
      if (spec.ref) assert.ok(names.includes(spec.ref), name + '.' + f + ' -> ' + spec.ref);
    }
  }
});

test('table prefixes follow TDMS', () => {
  const { g } = loadServer();
  const S = g('Schema');
  const want = { brands: 'BRD-', regions: 'REG-', locations: 'LOC-', stations: 'STN-', lookups: 'LKP-',
    assessment_components: 'CMP-', settings: 'SET-', users: 'USR-', audit_log: 'AUD-', record_history: 'HIS-', import_batches: 'IMP-' };
  for (const [t, p] of Object.entries(want)) assert.equal(S.table(t).idPrefix, p, t);
});

test('unknown table throws', () => {
  const { g } = loadServer();
  assert.throws(() => g('Schema').table('nope'), /Unknown table/);
});

test('inputDef lets a versioned table take effective_from and supersedes_id', () => {
  const { g } = loadServer();
  const S = g('Schema');
  const d = S.inputDef(S.table('settings'));
  assert.ok(d.fields.effective_from && d.fields.supersedes_id);
  assert.equal(S.inputDef(S.table('brands')), S.table('brands'));
});
