# Phase 2 Implementation Plan: Password Sign-in, Team Leader Records, Legacy Import

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim sign-in with Employee ID and password, build the Team Leader workflow (enroll to promote) with its screens, and import the 276 legacy MASTER_LOG rows with reconciliation.

**Architecture:** Same four layers as Phase 1. New pure rule files (`PasswordRules.gs`, `TlRules.gs`, additions to `ImportRules.gs`) hold every calculation and the transition table; services (`AuthService`, `UserService`, `PersonService`, `TlService`, `ImportService`) call only the repository, the rules and `Platform.gs`; the schema grows by data entries. The client gains `tl.js` and `import.js`, inlined by the build.

**Tech Stack:** Apps Script V8, Google Sheets, Node 22 `node:test` over the fake Google services, Playwright 1.56.1 against the dev server.

**Spec:** [specs/2026-10-21-phase-2-enrollment-certification-design.md](../specs/2026-10-21-phase-2-enrollment-certification-design.md)

**Approval:** Leo could not read this plan and said on 2026-10-21 (09:11 Manila) that the Reviewer decides ("ikaw mag-decide"). The Reviewer therefore approves it in Leo's place (docs/COLLABORATION.md, "Decision rights"), effective when the pull request that carries it is merged; the record is the `Reviewer: DECISION` comment on that pull request. A change of the plan after that goes through a pull request comment first, as before.

## Global Constraints

- Only `Repository.gs` calls `SpreadsheetApp`. Only `Platform.gs` calls `PropertiesService`, `CacheService`, `LockService`, `Utilities`, `Session` and `new Date`.
- Every top-level server function is `doGet`, `tlmiApi`, or starts with `EditorGuard.check()` (limit L-3; the static test enforces it).
- Names are TDMS names (CLAUDE.md table, spec §6). The only TLMI additions are the ones the spec marks: `TL.UPDATED`, `tl.update`, `alias_type` `NAME`, `tl_certifying_officers.retake_no`, `import_rows.result` values.
- Every write: one transaction under the lock, `row_version` on MUT updates, `record_history` for MUT field changes (except `noHistory` fields), `status_history` on every status change, one audit row with the spec's event code.
- A password, temporary password, hash, salt or pepper never appears in a response (except `temporary_password` once), an audit row, `record_history`, a log line or an error message.
- Rounding: half up to 2 decimals (P2-5). Dates `yyyy-mm-dd` in Asia/Manila; timestamps ISO UTC.
- `page_size` at most 50. Text from the server goes into the page with `textContent` only.
- Fixtures and dev data use invented names only. No sheet ID, PIN, password, token, e-mail address or real staff name in the repository, except invented test-only values in test code and the dev server, which protect only an in-memory fake and say so in a comment (as `TEST-ONLY-PIN-1` in Phase 1).
- The `PERMISSIONS` object in `src/server/AuthService.gs` is pinned by `tests/unit/permissions-table.test.js`, which holds the full expected map (method to roles). Every task that adds or changes a `PERMISSIONS` entry changes that map in the same commit, so each such change is a visible line in the diff that the Reviewer compares with the spec row (docs/COLLABORATION.md, "Merge rule", halt path 5).
- Four pull requests, each from updated `main`: **E** = Tasks 1 to 7, **F** = Tasks 8 to 12, **G** = Tasks 13 and 14, **H** = Tasks 15 to 18.

## Review Focus

1. A failed sign-in for an unknown employee ID takes about as long as one for a known ID (same hashing work), takes no lock and writes nothing. Test in Task 3.
2. A correction (entry grade or certification check) never changes or deletes the row it corrects; the old row stays, the new row has `supersedes_id` and `correction_reason`, and the computed values use only rows in force. Tests in Tasks 11 and 12.
3. Two officers act on the same record at once: the second call gets `CONFLICT` with `current`, and nothing of the second call is written. Test in Task 12.
4. The import commit stopped after one chunk and called again commits each source row exactly once; validating again after a commit reports the committed rows as `ALREADY_COMMITTED`. Tests in Task 17.
5. A person with two legacy rows that would both be open is never imported twice open; both rows are `NOT_READY` with `OPEN_TWICE` until an officer skips or corrects one. Test in Task 16.

---

### Task 1: Users fields and the `noHistory` flag

**Files:** Modify `src/server/Schema.gs`, `src/server/AuditService.gs`; test `tests/unit/schema-p2a.test.js`.

**Interfaces:**
- Produces in `Schema` `users.fields`: `must_change_password` (bool), `failed_attempts` (int, `noHistory: true`), `cooldown_until` (timestamp, `noHistory: true`), `last_login_at` (timestamp, `noHistory: true`); `hr_employee_no` gains `pattern: /^\d{1,20}$/`.
- `Validator` honours `pattern` (code `PATTERN`).
- `AuditService.changes` skips fields with `noHistory: true`, and writes `[changed]` for `password_hash` and `salt` (as since PR #6).

- [ ] **Step 1: Failing tests:** `users has the four new columns`, `hr_employee_no rejects letters`, `changes writes no row for failed_attempts, cooldown_until or last_login_at`, `changes writes [changed] for password_hash`.
- [ ] **Step 2:** `npm test` — FAIL. **Step 3:** implement. **Step 4:** `npm test` — PASS. **Step 5:** commit `feat: users sign-in fields and noHistory columns`.

### Task 2: Password rules and temporary passwords

**Files:** Create `src/server/PasswordRules.gs`; modify `src/server/Platform.gs`; test `tests/unit/passwordrules.test.js`.

**Interfaces:**
- `PasswordRules.check(newPassword, currentPassword?) -> { ok: boolean, code?: 'TOO_SHORT'|'NEEDS_LETTER'|'NEEDS_DIGIT'|'SAME_AS_CURRENT' }` (FX-002).
- `Ids.tempPassword() -> string`: 12 characters from `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789`, built from `Utilities.getUuid()` randomness with rejection sampling (discard a random value at or above the largest multiple of the alphabet length, so no character is favoured; about 70 bits for 12 characters, enough for a password that must be changed at first sign-in, say so in a comment), always with at least one letter and one digit (passes `PasswordRules.check`). Keep the alphabet as three shorter constants (upper, lower, digits) joined at run time: one quoted string of 33 or more letters and digits stops `tools/build.js` (its ID guard).
- `Hasher.needsRehash(stored) -> boolean` (stored count differs from `Hasher.DEFAULT_ITERATIONS`).

- [ ] **Step 1: Failing tests:** `7 characters is TOO_SHORT`, `letters only is NEEDS_DIGIT`, `digits only is NEEDS_LETTER`, `the current password again is SAME_AS_CURRENT`, `tempPassword passes check 1000 times and has no look-alike characters`, `needsRehash is true for another iteration count`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: password rule FX-002 and temporary passwords`.

### Task 3: Password sign-in, sessions with epochs, the change-password gate

**Files:** Modify `src/server/AuthService.gs`, `src/server/Api.gs`; tests `tests/unit/auth-p2.test.js`, update `tests/unit/auth.test.js`, `tests/helpers/env.js` (`signIn(role)` now signs in with an employee ID and a test-only password); create `tests/unit/permissions-table.test.js` (the pin described in Global Constraints, filled with the table as it stands, plus `auth.changePassword` for ALL).

**Interfaces:**
- Consumes `PasswordRules`, `Hasher`, `Ids`, `Props`, `CacheStore`, `SettingsService.intOr`.
- `auth.signIn { employee_id (text, pattern digits, max 20), password (text, max 200) } -> { token, must_change_password, user{id,name,role}, capabilities: string[], scope: { brand_ids: string[] }, flags: {}, settings_public: { idle_minutes, page_size: 50 } }`.
- `auth.changePassword { current, new } -> { token }` (new token; old sessions end by epoch).
- `auth.me -> ` the same block without `token`.
- `AuthService.epoch(userId) -> int` and `AuthService.bumpEpoch(userId)` (Script Property `SESSION_EPOCH:<userId>`, cached for 60 s in `CacheService` as `epoch:<userId>`; `bumpEpoch` writes the property and removes the cached value); session value `{ userId, issuedAt, lastSeen, epoch }`.
- `Api.handle`: after the session check, when `user.must_change_password` and the method is not `auth.me`, `auth.signOut` or `auth.changePassword`, throw `FORBIDDEN` with message "Change your password first.". `Api.failure` copies `rule_id` too.
- Removes `auth.listSignInUsers`, the Admin PIN check and `ADMIN_PIN_FAILS`.
- Failure path per spec §4.2: unknown or inactive ID → one `Hasher.hash` of a fixed dummy value, `AUTH_FAILED`, no lock, no row; paused → `AUTH_LOCKED` + `retry_after` before hashing; wrong password → under `LockGuard`, re-read the user inside the lock, then `failed_attempts + 1`, at CFG-002 set `cooldown_until` = now + CFG-003 minutes and reset the count; audit `.FAILED` / `.LOCKED` while the per-user daily cache counter `authfail:<userId>:<yyyy-mm-dd>` is under 50. Success → reset counters, set `last_login_at`, rehash when `Hasher.needsRehash`.

- [ ] **Step 1: Failing tests:** `signs in with employee id and password`, `wrong password is AUTH_FAILED and counts`, `fifth failure gives AUTH_LOCKED with retry_after 900`, `a paused user is refused before any hash is computed` (spy on `Hasher.verify`), `unknown employee id takes no lock and writes no row` (lock held by the test: still `AUTH_FAILED`, not `BUSY`; row counts unchanged), `unknown id does equal hashing work to a known id` (spy counts one `Hasher.hash` or `verify` call each; the test name says "hashing work", not "response time", spec §4.2 item 2), `two wrong tries from stale reads count 2` (the counter is re-read inside the lock), `the 51st failure of a day writes no audit row`, `a bumped epoch ends a session within the same call even when the epoch was cached`, `must_change_password blocks tl.list-like methods with FORBIDDEN but allows auth.me and auth.changePassword`, `changePassword enforces FX-002 and returns a new token; the old token is SESSION_EXPIRED`, `a stored hash with another iteration count is rehashed on sign-in`, `no response, audit row or log line contains the password or the hash` (scan), `auth.listSignInUsers is NOT_FOUND`, `PERMISSIONS equals the expected map in permissions-table.test.js` (one failure message lists every method that differs, in either direction).
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: employee ID and password sign-in with per-user pause and session epochs`.

### Task 4: Users: HR number, temporary passwords, reset and clear pause

**Files:** Modify `src/server/UserService.gs`, `src/server/AuthService.gs` (`PERMISSIONS`); test `tests/unit/users-p2.test.js`.

**Interfaces:**
- `users.create { display_name, role, hr_employee_no (required) } -> { user, temporary_password }`; stores `Hasher.hash` of the temporary password with a new salt; `must_change_password` true.
- `users.resetPassword { id, row_version } -> { user, temporary_password }`; refuses own id (`FORBIDDEN`); clears `failed_attempts`, `cooldown_until`; bumps the epoch. Audit `USER.PASSWORD_RESET`.
- `users.clearCooldown { id, row_version } -> { user }`. Audit `USER.COOLDOWN_CLEARED`.
- `users.update`: a role change and `users.deactivate` bump the epoch; `hr_employee_no` cannot be set back to empty.
- `view(u)` never returns `password_hash`, `salt`, `failed_attempts`, `cooldown_until`; it returns `paused` (bool) and `must_change_password`.
- `PERMISSIONS` adds `auth.changePassword` (ALL), `users.resetPassword`, `users.clearCooldown` (Admin).

- [ ] **Step 1: Failing tests:** `create without hr_employee_no is VALIDATION`, `create returns a temporary password once and get never returns it`, `the new user must change the password at first sign-in`, `resetPassword ends the user's sessions`, `an Admin cannot reset their own password`, `clearCooldown lets a paused user sign in`, `role change ends the user's sessions`, `audit rows of create and reset hold no password`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: users get HR numbers, temporary passwords, reset and clear pause`.

### Task 5: Bootstrap and removal of the Admin PIN

**Files:** Modify `src/server/Setup.gs`, `tools/dev-env.js`; tests update `tests/unit/setup.test.js`, `tests/unit/setup-admin.test.js`, `tests/unit/editor-guard.test.js`.

**Interfaces:**
- `initFirstAdmin()` reads `FIRST_ADMIN_NAME`, `FIRST_ADMIN_EMPLOYEE_NO`, `FIRST_ADMIN_PASSWORD`; spec §4.5 refusals; removes the three properties and the three `ADMIN_PIN_*` properties.
- `initAdminPassword()` reads `ADMIN_EMPLOYEE_NO`, `ADMIN_TEMP_PASSWORD`; spec §4.5.
- `initAdminPin` is deleted. `REQUIRED_PROPERTIES` = `ENV`, `TLMI_DB_ID`, `LEGACY_COPY_ID`, `REVIEW_SHEET_ID`, `PEPPER`.
- `tools/dev-env.js`: the five invented users get HR numbers `9101` to `9105` and the test-only password `TEST-ONLY-Pass-1` (comment: test code only), `must_change_password` false; one extra user `9106` with `must_change_password` true for the browser test.

- [ ] **Step 1: Failing tests:** `initFirstAdmin creates an Admin who must change the password`, `initFirstAdmin refuses a password that fails FX-002 and keeps the properties`, `initAdminPassword sets number and password on the only Admin`, `initAdminPassword works with two Admins when the number names one`, `initAdminPassword refuses a free number when two active Admins exist`, `initAdminPassword refuses a number that a non-Admin has`, `initAdminPassword unlocks a paused Admin and ends the Admin's sessions`, `both remove the ADMIN_PIN properties`, `initAdminPin no longer exists`, the editor-guard tests list the new function.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: password bootstrap for the first Admin; Admin PIN removed`.

### Task 6: Sign-in, change-password and Users screens

**Files:** Modify `src/client/index.html`, `src/client/app.js`, `src/client/styles.css`, `src/client/views/admin.html`; tests rewrite `tests/e2e/signin.spec.js`, update `tests/e2e/helpers.js`, `tests/e2e/roles.spec.js`, `tests/e2e/admin.spec.js`.

**Interfaces:**
- Sign-in form: `#signin-employee` (inputmode numeric), `#signin-password`, `#signin-submit`; message in `#signin-message`.
- Change-password view `#screen-password` with `#pw-current`, `#pw-new`, `#pw-repeat`, `#pw-submit`; shown when `must_change_password`; reachable from a "Change password" button in the top bar.
- Users screen: HR number required; buttons `Reset password` and `Clear pause`; the temporary password box `[data-slot="temp-password"]` with a Copy button and the spec §4.6 text.
- `helpers.js`: `signInAs(page, who)` uses `NUMBERS[who]` and `TEST-ONLY-Pass-1`.

- [ ] **Step 1: Failing browser tests:** `employee id and password sign in`, `wrong password shows the generic message and empties the password`, `five wrong passwords say how long to wait`, `a user who must change the password sees only the change screen until done`, `the new password must follow the rule`, `Admin resets a password and sees it once`, the existing role and width tests with the new sign-in.
- [ ] **Step 2:** `npx playwright test` — FAIL. **Step 3:** implement. **Step 4:** `npm test` and `npx playwright test` — PASS. **Step 5:** commit `feat: password sign-in screens`.

### Task 7: Docs for part 2A

**Files:** Modify `docs/SETUP.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, `README.md`.

- `SETUP.md`: Script Properties for `initFirstAdmin` / `initAdminPassword`; the order for an existing database (spec §4.5); handing out temporary passwords in person; the PIN properties are removed by the functions.
- `DECISIONS.md`: X-1 "Ends" column: "When part 2A is deployed to TEST (Leo records the date)"; the "anonymous sign-in calls take the lock" open item closed by spec §4.2; new rows X-2, X-3 (spec P2-2, P2-3); the CEBU TL item closed (P2-12); Leo's answers of 2026-10-21: Admin does the officer actions (P2-6; TDMS PERM-031/032 "?" answered for TLMI), the TL course program grade is a certification requirement outside the formula (P2-13, setting TLMI-001 = 90); new row X-4 (spec §7.6: extend also when the course grade is below TLMI-001); the accepted limit on employee-number discovery (spec §4.2 item 2).
- [ ] **Step 1:** edit. **Step 2:** `npm test` (docs only; still PASS). **Step 3:** commit `docs: setup and decisions for password sign-in`. Open pull request **E** (Tasks 1 to 7).

---

### Task 8: Schema for the Team Leader tables, settings and enums

**Files:** Modify `src/server/Schema.gs`, `src/server/SettingsService.gs`; test `tests/unit/schema-p2b.test.js`.

**Interfaces:**
- Tables per spec §5 with these exact definitions: `persons` (`PER-`, width 6, MUT, F), `person_aliases` (`PAL-`, 6, APP, A, `alias_type` enum `NAME|HR_NO|TEMP`), `tl_enrollments` (`TLE-`, width 4, `idYear: true`, MUT, history `S+F`, `status` enum of the eight states), `assessments` (`ASM-`, width 6, `idYear: true`, APP, `subject_type` enum `TL_ENROLLMENT`, `score` number 0 to 100), `tl_extensions` (`TLX-`, 6, APP), `tl_certifying_officers` (`TLO-`, 6, APP), `status_history` (`HIS-`, 6, APP, appendOnly, stamp `at`/`user_id`), `import_rows` (`IMR-`, 6, MUT, `result` enum, `raw` json).
- `import_batches.kind` adds `LEGACY_TL`; `status` adds `Validated`, `Committing`, `Committed`, `Superseded`.
- `Repository.nextId('status_history')` and `nextId('record_history')` share the counter key `HIS`.
- `nextId(table, year)` for `idYear` tables takes the year of the record date passed by the service.
- `SETTING_DEFS['CFG-047'] = { label: 'Extension limit (number of extensions)', group: 'Team Leader', value_type: 'int', min: 1, max: 10 }` and `SETTING_DEFS['TLMI-001'] = { label: 'TL course program pass mark', group: 'Team Leader', value_type: 'int', min: 1, max: 100 }`; CFG-047 is not seeded, TLMI-001 is seeded at `90` (spec §5); CFG-002 label "Wrong passwords before a pause".
- `SeedService` certification components add `['TL course program', true]` (spec P2-13); a seed run on an existing database adds only it.
- `Schema.TL_STATUSES`, `Schema.TL_OPEN_STATUSES` exported.

- [ ] **Step 1: Failing tests:** `every new table has id first and profile columns last`, `status_history and record_history ids never repeat across both tables`, `TLE id takes the year of the entry date` (`TLE-2025-0001` for an entry date in 2025), `CFG-047 can be set by Admin and is not seeded`, `TLMI-001 is seeded as 90; CFG-047 is not seeded`, `a seed run on a Phase 1 database adds the TL course program component and TLMI-001 only, and keeps a TLMI-001 value Admin already set`, `import_batches accepts LEGACY_TL`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: schema for persons, enrollments, assessments and history`.

### Task 9: Team Leader rules (pure)

**Files:** Create `src/server/TlRules.gs`; test `tests/unit/tlrules.test.js`.

**Interfaces (all pure):**
- `TlRules.deadline(entryDateIso, months) -> iso` (month-end clamp).
- `TlRules.round2(n) -> number` (half up; `round2(84.995) === 85`).
- `TlRules.inForce(rows) -> rows` (assessment rows that no other row supersedes).
- `TlRules.entryState(requiredComponentIds, gradesInForce) -> { complete: boolean, missing: string[], average: number|null }`.
- `TlRules.finalGrade({checklist, exam, kitchen?, manager?}, {cert: [wc, we, wf], feedback: [wk, wm]}) -> number` (P2-4, P2-5).
- `TlRules.decide(action, status, role, facts) -> { ok: true } | { ok: false, code: 'BLOCKED_BY_RULE'|'FORBIDDEN', rule_id }` where `facts = { entryComplete, finalGrade, passMark, extensionsUsed, extensionLimit, courseGrade, coursePassMark }` and the table is spec §7.12 plus the role column of spec §6 (Admin allowed for the officer actions; `returnToProbation` and `promote` for Supervisor, Manager and Senior only).
- `TlRules.overdue(status, deadline, today) -> boolean`.

- [ ] **Step 1: Failing tests** with the spec's values: `30 Nov + 3 months is the last day of February` (`2025-11-30` gives `2026-02-28`; `2027-11-30` gives `2028-02-29`), `final with both feedback forms` (checklist 90, exam 80, kitchen 85, manager 75 → feedback 81, final 83.3), `final with only the kitchen form uses it alone` (90, 80, kitchen 85 → 84.5), `84.995 rounds to 85 and passes at 85`, `entry is complete only with every required component`, `superseded rows are not in force`, `decide matches the transition table for every state x action` (generated), `an officer cannot promote or return to probation (FORBIDDEN)`, `Admin may do every officer action but is FORBIDDEN on promote and returnToProbation (P2-6)`, `certify without a course program grade is BLOCKED_BY_RULE RULE-102`, `a course grade of 89 (and 89.99) blocks certify at coursePassMark 90 and 90 passes`, `with no coursePassMark in force a recorded course grade is enough (safety net)`, `extend is allowed when the final passes but the course grade is below coursePassMark (X-4)`, `extend is BLOCKED_BY_RULE when the final passes and the course grade passes`, `extend is BLOCKED_BY_RULE RULE-104 at the limit`, `overdue only for open states`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: Team Leader rules (deadline, final grade, transitions)`.

### Task 10: Person service

**Files:** Create `src/server/PersonService.gs`; test `tests/unit/persons.test.js`.

**Interfaces:**
- `PersonService.create(uow, ctx, { last_name, first_name, middle_name?, suffix?, hr_employee_no?, legacy_ref? }) -> Row` (trims, collapses spaces; adds an `HR_NO` alias when a number is given).
- `PersonService.addAlias(uow, ctx, personId, aliasType, value, validFrom) -> Row|null` (no duplicate alias for one person).
- `PersonService.candidates(rows, aliases, input) -> [{ person_id, name, reason: 'SAME_HR_NO'|'SAME_NAME'|'SIMILAR_NAME' }]` (uses `ImportRules.normalizeName` and the import review's near rule, made public as `ImportRules.near`).
- `PersonService.displayName(person) -> 'FIRST MIDDLE LAST SUFFIX'` trimmed.
- Methods `persons.get`, `persons.matchCandidates`; `PERMISSIONS` add both for ALL roles.

- [ ] **Step 1: Failing tests:** `create stores trimmed names and an HR_NO alias`, `a same HR number is VALIDATION`, `candidates finds the same name in another case and spacing`, `candidates finds a name with an extra middle initial as SIMILAR_NAME`, `persons.get returns aliases and enrollments`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: person service with duplicate candidates`.

### Task 11: Team Leader service, part 1 (enroll, update, entry grades, reads)

**Files:** Create `src/server/TlService.gs`; modify `src/server/Api.gs` (registry), `src/server/AuthService.gs` (`PERMISSIONS`); test `tests/unit/tl-enroll.test.js`.

**Interfaces:**
- Methods `tl.enroll`, `tl.update`, `tl.recordEntryGrade`, `tl.get`, `tl.list`, `tl.history` with the params and permissions of spec §6.
- `TlService.statusChange(uow, ctx, enrollment, toStatus, effectiveDate, remark)` writes `status_history`.
- `tl.list` uses `Lists.run` with `filters: ['status','mother_location_id','station_id','batch_code','open','overdue']`, `search` over normalised person names and NAME aliases, `sortable: ['deadline','entry_date','name']`, default `deadline`; base rows cached under `tl:list:<dataVersion>` for 60 s; `dataVersion` is Script Property `TL_DATA_VERSION`, raised after every TL write commit.
- `tl.get` returns `allowed_actions` from `TlRules.decide` for the caller's role.

- [ ] **Step 1: Failing tests:** `enroll a new person returns warnings with requires_confirm when a similar person exists and writes nothing`, `enroll with confirm creates person, enrollment and one status_history row`, `a second open enrollment for a person is BLOCKED_BY_RULE RULE-100`, `re-enrollment after Quit is allowed`, `entry date in the future is VALIDATION`, `an entry grade dated before the entry date or after today is VALIDATION`, `deadline uses CFG-040 in force on the entry date`, `the fifth required entry grade moves Entry to Probationary in the same call`, `a second grade for a component needs correction_reason and supersedes the first`, `update writes record_history for the changed fields only and refuses entry_date`, `tl.list pages, filters overdue and searches an alias`, `a write is visible in tl.list on the next call`, `tl.history lists status and field changes newest first`, `Admin can enroll (P2-6)`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: enroll, entry grades and Team Leader reads`.

### Task 12: Team Leader service, part 2 (certification and closing actions)

**Files:** Modify `src/server/TlService.gs`, `src/server/AuthService.gs`; test `tests/unit/tl-cert.test.js`.

**Interfaces:**
- Methods `tl.recordCertCheck`, `tl.certify`, `tl.extend`, `tl.close`, `tl.quit`, `tl.returnToProbation`, `tl.promote` per spec §6 and §7.4 to §7.10, each guarded by `TlRules.decide` and `row_version`. `tl.recordCertCheck` takes `course_program` (spec §7.4, P2-13) and writes it as the `TL course program` component; `tl.certify` reads `TLMI-001` with `SettingsService.inForce` on the check date (seeded 90).
- `weights_version` text format `CFG-041@v<n>;CFG-044@v<n>;CFG-045@v<n>` from `SettingsService.inForce` on the check date.

- [ ] **Step 1: Failing tests:** `cert check before all entry grades is BLOCKED_BY_RULE RULE-101`, `cert check without any feedback is VALIDATION`, `the first attempt without course_program is VALIDATION; a later attempt may omit it and the earlier grade stays in force`, `a new attempt has the next retake_no and officer rows`, `a correction in Certification check supersedes the attempt's rows and keeps the officers`, `certify stamps pass mark, weights_version and certified_on = the check date`, `certify below the pass mark is BLOCKED_BY_RULE RULE-102`, `extend without CFG-047 is CONFIG_MISSING`, `extend writes extension 1 with deadline + 30 days and sets Extended`, `extend at the limit is BLOCKED_BY_RULE RULE-104`, `after an extension the next check is a new attempt and returns to Certification check`, `close needs a close reason`, `quit with an empty quit reason list is CONFIG_MISSING CFG-018`, `quit closes as Quit, never Failed`, `return to probation needs a note and keeps the deadline`, `an officer gets FORBIDDEN on promote`, `promote only from Certified`, `two officers at once: the second gets CONFLICT and writes nothing`, `every action writes status_history and its audit event`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: certification check, certify, extend, fail, quit, return, promote`. Open pull request **F** (Tasks 8 to 12).

---

### Task 13: Team Leader screens

**Files:** Create `src/client/tl.js`, `src/client/views/tl.html`; modify `tools/assemble.js` (inline every `src/client/*.js`: `api.js`, `app.js`, then the rest by name), `src/client/app.js` (`App.registerNav(item)`, shared helpers exposed on `App`), `src/client/styles.css`, `tools/dev-env.js` (invented enrollments in every state); test `tests/unit/build.test.js` (assembly order).

**Interfaces:**
- Menu item `{ id: 'tl', label: 'Team Leaders', roles: all }` first in the menu.
- Views per spec §8: list `[data-view="tl-list"]`, enroll `[data-view="tl-enroll"]`, record `[data-view="tl-record"]` with sections `[data-slot="entry-grades"]`, `[data-slot="checks"]`, `[data-slot="extensions"]`, `[data-slot="actions"]`, `[data-slot="history"]`.
- Action buttons have `data-action="<method name>"` and appear only when `allowed_actions` contains them.

- [ ] **Step 1: Failing build test:** `assembly inlines api.js, app.js, then other client scripts in name order and stops on a closing script tag in any of them`.
- [ ] **Step 2–5:** FAIL, implement (screens checked by hand at 375 and 1280 px), PASS, commit `feat: Team Leader screens`.

### Task 14: Browser tests for the Team Leader flows

**Files:** Create `tests/e2e/tl.spec.js`; modify `tests/e2e/roles.spec.js`.

- [ ] **Step 1: Write the tests** (spec §11 browser list): `an officer enrolls a new person after the duplicate warning`, `five entry grades move the record to Probationary`, `a certification check shows the computed final`, `certify`, `extend is refused until Admin sets CFG-047, then works`, `quit needs a reason from the list`, `a Supervisor promotes; an officer has no Promote button and a direct call is FORBIDDEN`, `a stale action shows "Changed by ..., reload."`, `the list filters overdue records and shows them in red`, each at 1280, 768 and 375 with no console errors, no failed requests and no horizontal scroll.
- [ ] **Step 2:** `npx playwright test` — PASS (fix the screens if not). **Step 3:** commit `test: browser tests for the Team Leader flows`. Open pull request **G** (Tasks 13 and 14).

---

### Task 15: Name proposals and decision words in the import review

**Files:** Modify `src/server/ImportRules.gs`, `src/server/ImportReviewService.gs`; tests `tests/unit/importrules-names.test.js`, update `tests/unit/importreview.test.js`.

**Interfaces:**
- `ImportRules.proposeNameParts(full) -> { last, first, middle, suffix }` per spec §10.4.
- `ImportRules.parseNameParts(correctedValue) -> { last, first, middle, suffix } | null` for `LAST | FIRST | MIDDLE | SUFFIX`.
- `persons_proposed` columns add `proposed_last_name`, `proposed_first_name`, `proposed_middle_name`, `proposed_suffix` before the decision tail; decisions on existing rows are kept (the row key does not include the new columns).
- `ImportRules.DECISIONS = ['confirm', 'different person', 'correct value', 'drop value']`.

- [ ] **Step 1: Failing tests** with invented names in the real patterns: `comma form "LAST, FIRST M."`, `"FIRST MIDDLE DELA CRUZ" keeps the particle in the last name`, `"FIRST DE LA CRUZ JR." gives suffix JR`, `"FIRST JR C LAST" puts JR as suffix and C as middle`, `"MA. FIRST LAST" keeps MA. in the first name`, `parseNameParts reads four parts and rejects a missing last name`, `adding the columns keeps every earlier decision`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: proposed name parts and decision words in the import review`.

### Task 16: Import validation, rows and skip

**Files:** Create `src/server/ImportService.gs`; modify `src/server/AuthService.gs` (`PERMISSIONS`: the five `import.*` methods, Admin); tests `tests/unit/import-validate.test.js`, `tests/fixtures/review-decisions.js` (invented decisions for the fixture MASTER_LOG).

**Interfaces:**
- `import.validate {} -> { import_id, counts }`; `import.get { import_id } -> { batch, counts, reconciliation }`; `import.rows.list { import_id, filters{result}, page, page_size } -> paged rows`; `import.rows.skip { id, row_version, skip_reason }`.
- `ImportService.plan(sourceRows, decisions, lists) -> [{ source_row, row_hash, legacy_ref, result, issues: [{code, field, message}], warnings: [...], plan: { person, enrollment, grades, officers } }]` (pure core, testable without sheets).
- Readiness items and issue codes exactly as spec §10.3; warnings as spec §10.3 last paragraph.

- [ ] **Step 1: Failing tests:** one per issue code (`PERSON_UNCONFIRMED`, `DUPLICATE_UNDECIDED`, `STORE_UNMAPPED`, `SUPPORT_STORE_UNMAPPED`, `STATION_UNMAPPED`, `ENTRY_DATE_BAD`, `STATUS_BAD`, `VALUE_UNDECIDED`, `OPEN_TWICE`, `CHANGED_AFTER_COMMIT`), `a confirmed alias maps an asterisk station`, `drop value leaves the grade out and the row ready`, `NONE support store is blank`, `an unmapped CERT BY officer is a warning`, `a typed note in CERT BY goes to remarks`, `validate writes only import_batches, import_rows, id_counters and audit_log`, `a skip is carried to the next validation`, `a new validation sets the earlier Validated batch to Superseded and a Committed batch stays Committed`, `non-Admin is FORBIDDEN`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: legacy import validation against the review decisions`.

### Task 17: Import commit and reconciliation

**Files:** Modify `src/server/ImportService.gs`; test `tests/unit/import-commit.test.js`.

**Interfaces:**
- `import.commit { import_id, row_version, backup_date } -> { committed, remaining, status }`; chunks of 25 rows per `Repository.transact`; batch status `Committing` while rows remain, `Committed` when none.
- Per row (spec §10.5): person (reused by `legacy_ref` `LEGACY:<normalised name>` or created via `PersonService.create`), `NAME` aliases for every spelling, the enrollment (`legacy_ref` `MASTER_LOG!<row>#<hash>`, `TLE-<entry year>-nnnn`), entry assessments (`retake_no` 0), certification assessments (`retake_no` 1: column T as TL course program, column U as Exam; no Checklist), officers, one `status_history` row, `TL.ENROLLED` audit (detail `{source:'LEGACY_IMPORT', import_id}`); the import row becomes `COMMITTED` with `created_record_id`.
- One `IMPORT.COMMITTED` audit row per call with the counts.
- `ImportService.reconcile(batch, rows) -> { source_rows, by_result, by_issue, legacy_result_counts, tlmi_status_counts, reconciled: boolean }` (pure).

- [ ] **Step 1: Failing tests:** `backup_date other than today is VALIDATION`, `commit creates person, aliases, enrollment, grades, officers and history for a ready row`, `a person with two rows gets one person and two enrollments`, `DISQUALIFIED becomes Failed with close reason Disqualified`, `legacy final is kept with weights_version LEGACY`, `legacy CERTFICATION GRADE becomes a TL course program grade, never a Checklist grade`, `a commit stopped after one chunk and called again commits each row once` (fake `LockGuard` throws `BUSY` on the second chunk), `validate after commit shows ALREADY_COMMITTED`, `a not-ready row is never committed`, `reconcile is true only when every row is committed or skipped and the counts agree`, `commit writes nothing to the legacy copy or the review sheet`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: legacy import commit in chunks with reconciliation`.

### Task 18: Import screen, browser test, gate G2 documents

**Files:** Create `src/client/import.js`; modify `src/client/views/admin.html`, `tools/dev-env.js` (fake review decisions); create `tests/e2e/import.spec.js`, `docs/G2-CHECKLIST.md`; modify `docs/SETUP.md` (rehearsal and LIVE steps, spec §10.8; the officer note's decision words), `docs/STATUS.md`, `README.md`, `migration/LEGACY-DATA-PROFILE.md` (CEBU TL finding).

**Interfaces:**
- Admin menu entry `Legacy import` (`id: 'legacy-import'`), replacing nothing (the `Import review` entry stays). The screen: Validate, the counts and reconciliation tables, the rows list filtered by result with issue codes in words, Skip with a reason, Commit with the backup date field, and a Continue button while rows remain.
- `G2-CHECKLIST.md`: the five items of spec §11 with how to check and what to record.

- [ ] **Step 1: Failing browser test:** `Admin validates, skips a row with a reason, commits with today's backup date and sees the batch reconciled` (fake sheets), at 1280 and 375.
- [ ] **Step 2–5:** FAIL, implement, PASS (`npm test`, `npx playwright test`), commit `feat: legacy import screen; G2 checklist and setup steps`. Open pull request **H** (Tasks 15 to 18).

---

## Self-review

- **Spec coverage:** §4 (Tasks 1 to 7), §5 (Tasks 1, 8), §6 (Tasks 3, 4, 10 to 12, 16, 17), §7 (Tasks 9, 11, 12), §8 (Tasks 13, 14), §9 (Task 10), §10 (Tasks 15 to 18), §11 (tests in every task; G2 document in Task 18), §12 (no code; questions are in the pull request description of this plan).
- **Names:** `TlRules.decide`, `TlService.statusChange`, `PersonService.create`, `ImportService.plan` and `ImportService.reconcile` are defined once and used with the same signatures in later tasks.
- **Proportion:** interfaces and test names only; no function bodies except the rule values the spec fixes.
