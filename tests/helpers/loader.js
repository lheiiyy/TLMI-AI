'use strict';
// Loads every src/server/*.gs into one vm context with the fake Google services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGoogle } = require('./fake-google');

const SERVER_DIR = path.join(__dirname, '..', '..', 'src', 'server');

function loadServer(opts = {}) {
  const google = createGoogle(opts);
  const ctx = vm.createContext(Object.assign({ console }, google.globals));
  const files = fs.readdirSync(SERVER_DIR).filter((f) => f.endsWith('.gs')).sort();
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(SERVER_DIR, f), 'utf8'), ctx, { filename: f });
  }
  // g('Schema') reads a global, also a top-level const/class.
  const g = (name) => vm.runInContext(name, ctx);
  // Objects made inside the context have another realm's prototypes; plain() copies them to ordinary data.
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  return { ctx, g, google, plain };
}

module.exports = { loadServer };
