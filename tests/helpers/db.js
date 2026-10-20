'use strict';
// A loaded server with an empty TLMI_DB in the fake Google services.
const { loadServer } = require('./loader');

const DB_ID = 'fake-db-id';

function setupDb(opts = {}) {
  const env = loadServer(opts);
  env.google.addSpreadsheet(DB_ID, 'TLMI_DB_TEST');
  env.g('Props').set('TLMI_DB_ID', DB_ID);
  if (opts.tables !== false) env.g('Repository').ensureTables();
  env.actor = { userId: 'USR-0001', now: '2026-10-20T04:00:00.000Z' };
  env.sheet = (tab) => env.google.sheets.get(DB_ID).getSheetByName(tab);
  return env;
}

module.exports = { setupDb, DB_ID };
