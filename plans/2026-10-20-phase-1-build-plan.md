# Phase 1 Implementation Plan: Core Data, Sign-in and Audit Log

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native execution in one session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Phase 1 slice of TLMI-AI: master data, interim sign-in, role checks, audit log and history, the seed, and the import review dry run, with tests and a UI that runs on localhost.

**Architecture:** Server code is plain global-scope Apps Script (`src/server/*.gs`). Node tests load it into a `vm` context with fake Google services, so the same files run in tests and in Apps Script. One generic repository driven by `Schema.gs` is the only code that touches `SpreadsheetApp`. The browser calls one entry, `tlmiApi(request)`. For localhost, `tools/dev-server.js` runs the real server code over in-memory fake sheets and the UI reaches it through the `mock` transport of `api.js`. `tools/build.js` produces `dist/` (server files, one inlined `index.html`, `appsscript.json`) for `clasp push`.

**Tech Stack:** Apps Script V8, Node 22 (`node:test`, `vm`), Playwright (Chromium), plain HTML/CSS/JS.

**Spec:** [specs/2026-10-19-phase-1-core-data-design.md](../specs/2026-10-19-phase-1-core-data-design.md). Executor reads the spec and `CLAUDE.md` first.

## Global Constraints

- Only `Repository.gs` calls `SpreadsheetApp`. Only `Platform.gs` calls `PropertiesService`, `CacheService`, `LockService`, `Utilities` and `new Date`.
- Method names, error codes, audit event codes and field names are the TDMS names used in the spec (§4, §5). No other names.
- Files must not run code at load that depends on another file (Apps Script loads files alphabetically). Cross-file use happens only inside functions.
- IDs, dates and employee numbers are written as plain text (`@` number format). Dates `yyyy-mm-dd`, timestamps ISO 8601 UTC. `audit_log` and `record_history` are append-only.
- No sheet ID, PIN, token, real staff name or e-mail address in the repo, tests or fixtures. Fixtures use invented names.
- Roles: Training Officer, Training Supervisor, Training Manager, Senior Training Manager, Admin. Session: 30 minutes idle, 6 hours absolute. PIN lockout: 5 tries, 15 minutes. Lock wait: 10 seconds, then `BUSY`.
- Widths checked in the browser: 1280, 768, 375.

## Review Focus

1. A store name with a trailing space or a tilde letter ("DOÑA SOLEDAD") is seeded trimmed and intact; a second seed run adds nothing. (Task 8)
2. Text that Google Sheets would turn into a date or number ("2026-04-21", "00123") comes back unchanged after a write and a read. (Task 4)
3. Two updates that carry the same `row_version`: exactly one succeeds, the other gets `CONFLICT` with `current`. A lock that cannot be taken returns `BUSY`. (Task 4)
4. A token still in the cache after its user was deactivated, or whose role changed, is refused or uses the new role. (Task 6)
5. An import review re-run after the source changed keeps decisions only on rows whose key is unchanged. (Task 10)
6. A patch with an unknown field, a 50,001-character text, or a `null` on a required field returns `VALIDATION` and writes nothing. (Task 2)

---

### Task 1: Tooling and fake Google services

**Files:** Create `package.json`, `.gitignore` (keep the existing `.clasprc.json` line and add `node_modules/`, `dist/`, `.clasp*.json`, `.env`), `appsscript.json`, `tests/helpers/loader.js`, `tests/helpers/fake-google.js`, `tests/helpers/fake-google.test.js`.

**Interfaces:**
- Produces `loadServer(opts?) -> { ctx, g, google }` (loader): runs every `src/server/*.gs` in one `vm` context with the fakes; `g(name)` reads a global from the context; `google` is the fake state (`google.sheets`, `google.props`, `google.cache`, `google.clock`).
- Produces fake `SpreadsheetApp.openById(id)`, `.create(name)`; sheet methods `getName, getLastRow, getLastColumn, getMaxRows, getRange(r,c,nr,nc), getDataRange, insertSheet(name), getSheetByName, deleteRows, setFrozenRows`; range methods `getValues, getDisplayValues, setValues, setNumberFormats, setNumberFormat, clearContent`. A cell whose column format is not `@` converts a `yyyy-mm-dd` string to a `Date` and a digit string to a number, as Google Sheets does.
- Produces fake `LockService.getScriptLock()` (`waitLock` throws when `google.lockHeld` is true), `CacheService.getScriptCache()` (TTL honoured against `google.clock`), `PropertiesService.getScriptProperties()`, `Utilities` (`getUuid, computeHmacSha256Signature, base64Encode, formatDate, newBlob` minimal), `Logger`.

- [ ] **Step 1: Failing test** `fake-google.test.js`: `writes a yyyy-mm-dd string to a general-format cell and reads a Date`, `keeps it a string when the column format is @`, `lock throws when held`, `cache entry expires after ttl`.
- [ ] **Step 2: Run** `node --test tests/` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the fakes and loader. `package.json` scripts: `test` = `node --test tests/unit tests/helpers`, `build` = `node tools/build.js`, `dev` = `node tools/dev-server.js`, `e2e` = `playwright test`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `chore: add test harness and fake Google services`.

### Task 2: Platform adapters, errors and validator

**Files:** Create `src/server/Platform.gs`, `src/server/Errors.gs`, `src/server/Validator.gs`; tests `tests/unit/platform.test.js`, `tests/unit/validator.test.js`.

**Interfaces:**
- Produces `Clock.now()`, `Clock.iso()`, `Clock.today()` (organisation time zone Asia/Manila), `Ids.uuid()`, `Props.get/set/remove`, `CacheStore.get(key)`, `CacheStore.put(key, obj, ttlSec)`, `CacheStore.remove(key)`, `LockGuard.run(fn, waitMs)` (throws `AppError('BUSY')`, always releases), `Hasher.newSalt()`, `Hasher.hash(secret, salt, pepper, iterations) -> 'hmac-sha256$<iterations>$<hex>'`, `Hasher.verify(secret, salt, pepper, stored) -> boolean` (constant time).
- Produces `AppError(code, message, extra)`; helpers `Errors.validation(fields)`, `Errors.forbidden(msg)`, `Errors.notFound(msg)`, `Errors.conflict(current)`, `Errors.busy(retryAfter)`, `Errors.configMissing(key)`.
- Produces `Validator.clean(def, input, mode) -> values` where `def` is a table definition from `Schema` and `mode` is `'create'` or `'patch'`. Throws `VALIDATION` with `fields: [{path, code, message}]` for: unknown field, missing required, `null` on required, wrong type, over `max` (default 50000), not in `enum`, immutable field in patch. Trims text.

- [ ] **Step 1: Failing tests:** `hash verifies the right secret and rejects a wrong one`, `LockGuard releases the lock when fn throws`, `LockGuard throws BUSY when the lock is held`, `validator rejects an unknown field`, `validator rejects a 50001-character text`, `validator rejects null on a required field`, `validator trims text and accepts a patch with fewer fields`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** the three files. Iterated HMAC-SHA256: iterate `iterations` times with the salt and pepper (constant `Hasher.DEFAULT_ITERATIONS`, a code constant, not a setting; the count is stored inside each hash, so changing it never breaks old hashes). Start at 10000. In Task 14, after the first deploy to TEST, time one hash in Apps Script (TDMS spike S-02): keep 10000 if one hash takes at most 2 seconds; otherwise use the largest count that takes at most 2 seconds, never below 1000. If 1000 is still slower than 2 seconds, stop and report `BLOCKED — REASON — DECISION REQUIRED`. Record the count and the timing in `docs/SETUP.md`.
- [ ] **Step 4: Run** — Expected: PASS. **Step 5: Commit** `feat: platform adapters, errors and validator`.

### Task 3: Schema

**Files:** Create `src/server/Schema.gs`, `tests/unit/schema.test.js`.

**Interfaces:**
- Produces `Schema.table(name) -> def`, `Schema.names()`, `Schema.columns(name) -> string[]` (ordered, system columns included), `Schema.formatId(name, n, year?) -> string`.
- `def = { name, tab, profile: 'MUT'|'APP'|'VER'|'SYS', idPrefix, idWidth, idYear?, fields: { [name]: { type: 'text'|'int'|'number'|'bool'|'date'|'timestamp'|'json', required?, max?, enum?, immutable?, ref?: table, unique?: string[] } }, appendOnly?, history: 'F'|'A'|'V'|'-' }`.
- Tables: `brands`, `regions`, `locations`, `stations`, `lookups`, `assessment_components`, `settings`, `users`, `audit_log`, `record_history`, `id_counters`, `import_batches`, with the fields in spec §7 and §9. MUT adds `created_at, created_by, updated_at, updated_by, is_active, row_version`; APP adds `created_at, created_by`; VER adds `effective_from, supersedes_id, created_at, created_by`.

- [ ] **Step 1: Failing tests:** `every table has id first and its profile columns last`, `formatId pads LOC-0001, USR-0001, AUD-000000`, `audit_log and record_history are appendOnly`, `every ref points to an existing table`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the schema as data plus the three functions. **Step 4: Run** — PASS. **Step 5: Commit** `feat: add schema for Phase 1 tables`.

### Task 4: Repository

**Files:** Create `src/server/Repository.gs`, `tests/unit/repository.test.js`.

**Interfaces:**
- Consumes `Schema`, `Props` (`TLMI_DB_ID`), `LockGuard`, `Clock`, `Validator`.
- Produces `Repository.ensureTables() -> string[]` (names of tabs created; never touches an existing tab), `Repository.all(table) -> Row[]`, `Repository.get(table, id) -> Row|null`, `Repository.transact(fn) -> any` (takes the lock, runs `fn(uow)`, commits, releases).
- `uow.get(table, id)`, `uow.all(table)`, `uow.insert(table, values, actor) -> Row` (allocates the ID, fills audit columns; `actor = { userId, now }`), `uow.update(table, id, patch, { expectedVersion, actor }) -> { before, after }` (throws `CONFLICT` with `current: { row_version, updated_by_name?, updated_at }`), `uow.append(table, values, actor) -> Row` (APP tables), `uow.nextId(table, year?) -> string`.
- Rows are typed objects: bool columns come back `true/false`, int and number as numbers, everything else as text. A `Date` that a cell returns is converted to `yyyy-mm-dd` or ISO text. Writes set the number format `@` for text-like columns. Appends to one table in one commit are a single `setValues`. `uow.update` and `uow.append` on an `appendOnly` table throw (`update`) or are allowed (`append`) as the profile says. No delete exists.

- [ ] **Step 1: Failing tests:** `ensureTables creates tabs and headers and leaves existing tabs alone`, `insert allocates BRD-0001 then BRD-0002`, `two inserts in one transaction get distinct ids`, `a text that looks like a date survives write and read` (`2026-04-21`), `a text with leading zeros survives` (`00123`), `update with a stale row_version throws CONFLICT carrying current`, `update bumps row_version and updated_at`, `update on audit_log throws`, `transact releases the lock after a throw`, `transact throws BUSY when the lock is held`, `a failed commit leaves earlier rows unchanged` (validation failure inside fn writes nothing).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** with a read cache per transaction only (never across calls). **Step 4: Run** — PASS. **Step 5: Commit** `feat: schema-driven repository with locking and row versions`.

### Task 5: Audit service

**Files:** Create `src/server/AuditService.gs`, `tests/unit/audit.test.js`.

**Interfaces:**
- Produces `AuditService.event(uow, ctx, { event, entity, entityId, result, detail }) -> Row`, `AuditService.changes(uow, ctx, entity, entityId, before, after) -> Row[]` (one `record_history` row per changed field), `AuditService.logOutcome(ctx, fields)` (own transaction, swallows its own errors), `AuditService.list(params, viewerRole) -> { rows, nextCursor }` (cursor on id, newest first, filters `event, entity, user_id, from, to`, `page_size` ≤ 50; the `hr_employee_no` column is removed from every row unless `viewerRole === 'Admin'`, spec §6.1 and §9), `AuditService.history(entity, id) -> Row[]`.
- `ctx = { userId, hrEmployeeNo, requestId, now }`. `detail` is JSON text; keys named `pin`, `password`, `token`, `hr_employee_no` are removed before writing.

- [ ] **Step 1: Failing tests:** `changes writes one row per changed field only`, `event strips pin, password, token and hr_employee_no from detail`, `list pages newest first with a cursor`, `list rejects page_size 51`, `list for a Senior Training Manager has no hr_employee_no key in any row`, `list for an Admin keeps hr_employee_no`, `logOutcome does not throw when the write fails`.
- [ ] **Step 2–5:** run FAIL, implement, run PASS, commit `feat: audit log and record history`.

### Task 6: API entry, interim auth and permissions

**Files:** Create `src/server/Api.gs`, `src/server/AuthService.gs`, `tests/unit/api.test.js`, `tests/unit/auth.test.js`.

**Interfaces:**
- Produces `tlmiApi(request) -> envelope` (spec §4). Pipeline order: parse, session, user and role, permission table, validate params, service. Unknown top-level field -> `VALIDATION`; unknown method -> `NOT_FOUND`. A `FORBIDDEN` or `CONFLICT` result is written with `AuditService.logOutcome`. An unexpected error returns `SERVER` with only `request_id`.
- Produces `doGet() -> HtmlOutput` serving `index`.
- `AuthService.methods() -> { [method]: { kind, auth: boolean, handler(ctx, params) } }` for `system.ping`, `auth.listSignInUsers`, `auth.signIn`, `auth.signOut`, `auth.me`.
- `AuthService.PERMISSIONS: { [method]: Role[] }` is the single permission table of spec §6.2. A method missing from it is denied.
- `AuthService.session(token) -> { user, role } | throws AUTH_REQUIRED|SESSION_EXPIRED`. Session value in `CacheStore`: `{ userId, issuedAt, lastSeen }`; the role is read from the user record (cache up to 60 seconds) on every call.
- `auth.signIn { user_id, pin? }`: non-Admin needs no PIN; Admin needs the PIN checked with `Hasher.verify` against `ADMIN_PIN_HASH`/`ADMIN_PIN_SALT`; a wrong PIN returns `AUTH_FAILED`; the 5th failure sets a pause and returns `AUTH_LOCKED` with `retry_after`; success clears the counter. The counter and `pausedUntil` live in Script Properties under key `ADMIN_PIN_FAILS` (JSON `{count, pausedUntil}`), are read and written inside `LockGuard.run`, and the pause is checked before `Hasher.verify`. They are never in `CacheService`. Settings `CFG-001..003` are read from `settings`. `audit.list` passes the caller's role to `AuditService.list` as `viewerRole`.

- [ ] **Step 1: Failing tests:** `ping needs no token`, `unknown field is VALIDATION`, `unknown method is NOT_FOUND`, `no token on a protected method is AUTH_REQUIRED`, `idle for 31 minutes is SESSION_EXPIRED`, `6 hours after issue is SESSION_EXPIRED even if active`, `deactivated user with a live token is refused`, `role change takes effect on the next call`, `every method x every role matches the permission table` (generated from `PERMISSIONS`), `Admin without PIN is AUTH_FAILED`, `5 wrong PINs give AUTH_LOCKED with retry_after 900`, `correct PIN after the pause works and the counter resets`, `clearing the whole cache does not reset the PIN failure counter`, `a locked account is refused before the hash is computed`, `audit.list as Senior Training Manager returns rows without hr_employee_no`, `response never contains a sheet id or stack`, `FORBIDDEN is audited with result DENIED`, `listSignInUsers returns only id and display_name of active users`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: API entry, interim sign-in and permission table`.

### Task 7: Master data, settings and users

**Files:** Create `src/server/MasterDataService.gs`, `src/server/SettingsService.gs`, `src/server/UserService.gs`, tests `tests/unit/masterdata.test.js`, `tests/unit/settings.test.js`, `tests/unit/users.test.js`.

**Interfaces:**
- Consumes `Repository.transact`, `Validator.clean`, `AuditService`, `Api` registry via `XxxMethods()` functions.
- `MasterDataService.methods()` returns `brands.*`, `regions.*`, `stations.*`, `locations.*`, `lookups.*`, `components.list|get|update` (spec §5). `*.list` follows spec §4 (`filters`, `sort`, `page`, `page_size` ≤ 50, `q`). Rules: location name unique per brand ignoring case and spacing; links must exist and be active; brand `code` immutable; system lookups cannot be renamed or disabled; `deactivate`/`reactivate` change `is_active` only; update with a stale `row_version` is `CONFLICT`. Events: `MASTER.<ENTITY>.*`, `LOCATION.*`, `LOOKUP.*`, `COMPONENT.UPDATED`.
- `SettingsService`: `SETTING_DEFS` (keys CFG-001, 002, 003, 040, 041, 042, 044, 045 with label, group, value_type, range), `settings.list`, `settings.get { setting_key, on_date? }`, `settings.set { setting_key, value, supersedes_id, reason }` (inserts a version; stale `supersedes_id` is `CONFLICT`; `reason` required; validates range, weights total 100), `SettingsService.require(key, onDate?) -> value` (throws `CONFIG_MISSING`; used for CFG-047 later).
- `UserService`: `users.list|get|create|update|deactivate|reactivate`; no self role change; the last active Admin cannot be deactivated or demoted; `hr_employee_no` unique when present.

- [ ] **Step 1: Failing tests:** one file each, covering: create then list a brand, `brand code cannot change`, `duplicate location name differing by case and space is VALIDATION`, `location with an inactive region is VALIDATION`, `system lookup Store cannot be disabled`, `update writes one record_history row per changed field and one audit row`, `stale row_version is CONFLICT with current`, `settings.set inserts version 2 and keeps version 1`, `settings.set without reason is VALIDATION`, `weights not totalling 100 is VALIDATION`, `require CFG-047 is CONFIG_MISSING`, `last Admin cannot be deactivated`, `user cannot change own role`, `Training Officer calling brands.create is FORBIDDEN`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: master data, settings and users services`.

### Task 8: Seed service

**Files:** Create `src/server/SeedService.gs`, `tests/unit/seed.test.js`, `tests/fixtures/legacy-copy.js` (invented data in the real layout: `SETTINGS` rows `[store, region]` without header, `SEED_OFFICERS` header `display_name, role, hr_employee_no, is_active`).

**Interfaces:**
- Consumes `Props` (`LEGACY_COPY_ID`), `Repository` (a second, read-only reader `Repository.readExternal(spreadsheetId, tabName) -> string[][]` using display values), `Repository.transact`, `AuditService`.
- Produces `seed.run { dry_run? } -> { batch_id, created: {table: n}, skipped: [...], rejected: [{table, row, reason}] }`. Seeds per spec §7 in this order: brands (Angel's Pizza, code `AP`), regions, lookups, stations, assessment_components, settings (CFG-001, 002, 003, 040, 041, 042, 044, 045; CFG-047 not seeded), locations, users. One `import_batches` row (kind `SEED`). Trims names; case and space insensitive duplicates are skipped and listed; a store with an unknown region is rejected.

- [ ] **Step 1: Failing tests:** `seed creates the master lists`, `second run creates nothing`, `dry_run writes nothing but reports counts`, `store with trailing space is trimmed and a tilde name is kept intact`, `duplicate store differing by case is skipped and listed`, `CFG-047 is not seeded`, `officers get role from SEED_OFFICERS and an unknown role is rejected`, `import_batches has one row per real run`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: one-time re-runnable seed`.

### Task 9: Import rules (pure)

**Files:** Create `src/server/ImportRules.gs`, `tests/unit/importrules.test.js`, `tests/fixtures/master-log.js` (invented rows with the real patterns).

**Interfaces (all pure, no I/O):**
- `ImportRules.normalizeName(s) -> string` (upper case, trim, collapse spaces, remove punctuation; keeps letters with accents).
- `ImportRules.matchMaster(raw, masterNames, aliases) -> { status: 'exact'|'candidate'|'none', match?, candidates? }` (exact only when normalised forms are equal; candidates by edit distance <= 2 or token containment).
- `ImportRules.parseDate(display, today) -> { iso?, issue? }` for `d MMM yyyy`, `dd/mm/yyyy`, `dd/mm/yyyy hh:mm:ss`, `yyyy-mm-dd`; issue codes `SERIAL_1899`, `UNREADABLE`, `FUTURE`.
- `ImportRules.parseGrade(display) -> { value?, issue?, proposed? }`: `95%` -> 95; `9475%` -> issue `PERCENT_SCALED`, proposed 94.75; out of 0..100 -> `OUT_OF_RANGE`; blank -> `{}`.
- `ImportRules.splitUniform(cell) -> { items: [{qty, size, drNo?}], issues: [] }` for `3 SMALL | 1 LARGE`, `1 XLARGE (DR#700003248)`.
- `ImportRules.mapStatus(result, statusFlag) -> { status, closeReason?, flag? }` (CERTIFIED, PROMOTION -> Promoted, QUIT, EXTENDED, FAILED, PROBATIONARY; DISQUALIFIED -> Failed with close reason Disqualified; `FOR REPORTING` and `NEW ENTRY` are flags).
- `ImportRules.checkRow(row, today) -> issues[]` (certification before entry, future dates, grade problems, blank required fields).
- `ImportRules.findDuplicates(names) -> [{a, b, reason}]` (same normalised first and last name with differing middle part).

- [ ] **Step 1: Failing tests** with the spec's values: `parseGrade 9475% proposes 94.75`, `parseDate 30 Dec 1899 is SERIAL_1899`, `parseDate 14 Nov 2025 is 2025-11-14`, `parseDate 25/02/2026 is 2026-02-25`, `splitUniform 3 SMALL | 1 LARGE gives two items`, `splitUniform reads DR number`, `mapStatus DISQUALIFIED is Failed with reason Disqualified`, `matchMaster exact ignores case and spaces but not tildes`, `certification before entry is flagged`, `findDuplicates pairs a name with and without a middle name`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: pure import rules`.

### Task 10: Import review service

**Files:** Create `src/server/ImportReviewService.gs`, `tests/unit/importreview.test.js`.

**Interfaces:**
- Consumes `ImportRules`, `Repository.readExternal`, `Repository.writeReview(sheetId, tabName, header, rows)`, `Props` (`LEGACY_COPY_ID`, `REVIEW_SHEET_ID`), `AuditService`.
- Produces `importReview.run -> { batch_id, status, counts }` and `importReview.get -> { last_run, counts }` (counts only, never an ID or link). Tabs and columns per spec §10: `persons_proposed`, `possible_duplicates`, `name_mapping`, `bad_values`, `uniform_split`, `summary`; each review row has `row_key` (`tab|source_row|hash(raw)`), `decision`, `corrected_value`, `decided_by`, `decided_on`, and `needs_review`. A re-run keeps `decision*` columns for an unchanged `row_key` and sets `needs_review` on a changed row. A failure marks the batch `Failed` and leaves the old tabs.

- [ ] **Step 1: Failing tests** using `tests/fixtures/master-log.js`: `summary equals the source row count and status counts`, `unknown store lands in name_mapping with status none`, `9475% lands in bad_values with proposed 94.75`, `uniform cell with two parts gives two uniform_split rows`, `no TLMI_DB table other than import_batches and audit_log changes`, `re-run keeps a decision on an unchanged row`, `re-run marks a changed row needs_review`, `a missing MASTER_LOG tab fails the batch and keeps the old review`, `non-Admin is FORBIDDEN`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: import review dry run`.

### Task 11: Setup functions

**Files:** Create `src/server/Setup.gs`, `tests/unit/setup.test.js`.

**Interfaces:**
- `setup() -> string[]` (editor function: `Repository.ensureTables()`, creates the `import_batches` tab, logs what was created), `initSecrets()` (sets `PEPPER` to a random value if missing), `initAdminPin()` (reads temporary property `ADMIN_PIN_NEW`, hashes it into `ADMIN_PIN_HASH` and `ADMIN_PIN_SALT`, deletes `ADMIN_PIN_NEW`; refuses a PIN shorter than 6), `checkConfig() -> { ok, missing[] }` (reports missing Script Properties by name only), `measureHash() -> { ms1000, ms10000 }` (editor function: times one `Hasher.hash` at 1000 and at 10000 iterations with a throwaway secret and logs the two numbers; used for the decision in Task 2).

- [ ] **Step 1: Failing tests:** `setup is idempotent`, `initAdminPin stores a hash and removes the plain property`, `initAdminPin refuses a 5-character pin`, `checkConfig lists missing keys without values`, `measureHash returns two positive numbers`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: setup and secret initialisation functions`.

### Task 12: Dev server, API client and sign-in screen

**Files:** Create `tools/dev-server.js`, `tools/build.js`, `src/client/index.html`, `src/client/styles.css`, `src/client/api.js`, `src/client/app.js`, `tests/e2e/helpers.js`, `playwright.config.js`, `tests/e2e/signin.spec.js`, `tests/unit/build.test.js`.

**Interfaces:**
- `api.js` exposes `Api.configure({ transport })` and `Api.call(method, params, { reason }) -> Promise<data>` (rejects with `{ code, message, fields, retry_after, current }`); it keeps the token in memory only. Transports: `appsscript` (`google.script.run`), `mock` (`fetch('/api')`), later `rest`.
- `tools/dev-server.js`: serves `src/client` and `POST /api` over `tlmiApi` running on the fake Google services; boots by running `setup`, `initSecrets`, setting a test Admin PIN (`TEST-ONLY-PIN-1`, test code only) and the seed from `tests/fixtures/legacy-copy.js`; `POST /__reset` restores that state.
- `tools/build.js`: writes `dist/` with every `src/server/*.gs`, one `index.html` with CSS and JS inlined, and `appsscript.json`; fails if any file under `src/` contains a string matching a 33-character Google ID pattern next to `openById`.
- Screens: sign-in (name list, PIN field shown only for Admin), signed-in shell (name, role, sign-out, idle timer).

- [ ] **Step 1: Failing tests:** `build writes dist with server files and one index.html`, Playwright `signin.spec.js`: `lists active officers`, `officer signs in without a PIN`, `Admin must give the PIN`, `wrong PIN shows the generic message`, `layout has no horizontal scroll at 375`.
- [ ] **Step 2–5:** FAIL, implement, PASS (`npm test`, `npx playwright test tests/e2e/signin.spec.js`), commit `feat: dev server, API client and sign-in screen`.

### Task 13: Home and Admin screens with browser checks

**Files:** Create `src/client/views/home.html`, `src/client/views/admin.html` (inlined by the build), extend `src/client/app.js`, tests `tests/e2e/roles.spec.js`, `tests/e2e/admin.spec.js`.

**Interfaces:**
- Home: read-only lists (brands, regions, stores, stations, lookups) for every role; Admin menu entry only for Admin (hidden is not security; the server enforces it).
- Admin: tabs for Stores, Stations, Brands and Regions, Lookups, Components, Settings, Users, Seed, Import review, Audit log. Forms use dropdowns for links and lookups. A `CONFLICT` shows "Changed by X, reload". Settings change asks for a reason. Seed shows the dry-run counts before the real run.

- [ ] **Step 1: Failing tests:** for each of the five roles: `signs in and sees the master lists`, `non-Admin has no Admin entry and a direct API call is FORBIDDEN`; for Admin: `edits a store and sees it in the list`, `stale edit shows the conflict message`, `adds a user`, `changes a setting with a reason and the old version stays in history`, `runs the seed dry run then the seed`, `runs import review and sees six tabs counts`, `Senior Training Manager sees the audit log`; at widths 1280, 768, 375: `no console errors and no failed requests`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: home and Admin screens`.

### Task 14: Deployment tooling, docs and gate G1 evidence

**Files:** Create `tools/deploy.js`, `docs/SETUP.md`, `docs/G1-CHECKLIST.md`; modify `README.md`, `docs/STATUS.md`, `.github/workflows/test.yml`.

**Interfaces:**
- `tools/deploy.js <dev|test>`: runs `npm test` and `npm run build`, refuses `live`, refuses a dirty git tree, reads the script ID from the ignored file `.clasp.<env>.json`, copies it to `dist/.clasp.json`, runs `clasp push` from `dist/`.
- `docs/SETUP.md`: the steps Leo does once (spec §6, §11): enable the Apps Script API, `clasp login`, create the DEV and TEST script projects, Script Properties by name (`ENV`, `TLMI_DB_ID`, `LEGACY_COPY_ID`, `REVIEW_SHEET_ID`, `ADMIN_PIN_NEW`), run `setup`, `initSecrets`, `measureHash` (set `Hasher.DEFAULT_ITERATIONS` by the rule in Task 2 before `initAdminPin`, and record the timing here), `initAdminPin`, deploy the web app (execute as owner), run the seed, run the import review. No IDs inside the file.
- `docs/G1-CHECKLIST.md`: the seven gate items of spec §11 as a checklist with the evidence to record.
- `.github/workflows/test.yml`: runs `npm ci`, `npm test` and the Playwright suite on pull requests.

- [ ] **Step 1: Failing test:** `deploy refuses live and a dirty tree` in `tests/unit/deploy.test.js`.
- [ ] **Step 2–5:** FAIL, implement, PASS; run the full verification: `npm test`, `npm run build`, `npx playwright test`; commit `docs: setup guide, G1 checklist and deploy tooling`; open the pull request.

---

## Self-review

- **Spec coverage:** §3 files (Tasks 1 to 13), §4 envelope (6), §5 methods (6, 7, 8, 10), §6 sign-in and roles (6), §7 seed (8), §8 write flow (4, 7), §9 audit and IDs (4, 5), §10 import review (9, 10), §11 tests and G1 (13, 14), §12 answers (8: code `AP`, `SEED_OFFICERS`; 7: Admin-only writes). Deliberate difference from the spec's file list: views are `src/client/views/*.html` inlined by the build instead of three top-level pages, and the `mock` transport talks to a dev server that runs the real server code, which tests more than fixture files would; `tests/fixtures/` holds the seed data for it.
- **Types:** `Repository.transact/uow` names, `AuditService.event/changes`, `AppError` codes and `ctx` shape are used the same way in Tasks 4 to 10.
- **Proportion:** the plan states interfaces, test names and values; bodies are left to the executor.
