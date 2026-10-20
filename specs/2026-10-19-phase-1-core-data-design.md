# Phase 1 Design: Core Data, Sign-in and Audit Log

| | |
| --- | --- |
| Status | **Draft for Leo's review.** It becomes Approved when Leo merges the pull request that adds it. |
| Date | 2026-10-19 |
| Phase | 1, weeks 2 to 3 (estimate) |
| Gate | G1: all roles sign in on TEST; master lists loaded and checked |
| Inputs | [PLAN](../docs/PLAN.md), [DATA-MODEL](../docs/DATA-MODEL.md), [DECISIONS](../docs/DECISIONS.md), [BUSINESS-RULES](../docs/BUSINESS-RULES.md); TDMS `API-CONTRACT.md` (§2 to §6, §8), `DATA-MODEL.md` (§1, §2, ENT-001 to ENT-016), `CONFIGURATION.md` (CFG-001 to 003, 018, 040 to 047), `PERMISSIONS.md` |

## 1. Purpose and scope

Phase 1 builds what every later module needs: master data, sign-in with a role check on every call, the audit trail, and a dry-run review of the legacy MASTER_LOG so that the Phase 2 import does not guess any value.

| In Phase 1 | Not in Phase 1 |
| --- | --- |
| Master data with a one-time seed and Admin screens: brands, regions, locations (stores), stations, lookups, assessment components, settings, users | Persons, enrollments, grades, certification (Phase 2) |
| Interim sign-in (name list, plus a PIN for Admin) and a role check on every call | Password sign-in (starts Phase 2, before any real record is loaded; see §6) |
| Audit log, record history, ID counters | Uniforms (Phase 3), dashboard and reports (Phase 4) |
| Import review: a dry run on a copy of the legacy sheet, written to a separate review sheet | Writing any legacy record into a `TLMI_DB` table (Phase 2) |
| Unit tests, mock transport, browser checks, deploy to DEV and TEST | LIVE deploy, AI, email; Admin delete and recycle bin (later in v1, §12 item 4) |

## 2. Decisions taken in the design

| # | Decision | Reason |
| --- | --- | --- |
| P1-1 | Master data is seeded once from the legacy copy, then kept through Admin screens. | The seed removes the typing; the screens keep the lists correct afterwards. |
| P1-2 | **Interim sign-in:** the user picks a name from a list; an Admin also enters a PIN. Leo accepted open access for Phase 1 on 2026-10-19. This is a time-limited exception to DECISIONS item 9 (Employee ID and password, TDMS AD-01 and AD-10). It ends at the start of Phase 2, and **no Team Leader record is loaded into `TLMI_DB` before password sign-in is live.** | Phase 1 holds only officers and stores. Real Team Leader names arrive in Phase 2. |
| P1-3 | The import review is a dry run. It reads a copy of the legacy sheet and writes only to a separate review sheet. | The legacy sheet stays untouched; officers can fix data before Phase 2. |
| P1-4 | One generic repository driven by one schema file. | Adding a table in later phases means adding a schema entry, not new data-access code. |
| P1-5 | Method names, error codes, audit event codes and field names follow TDMS. TLMI invents a name only where TDMS has no equivalent, and §5 marks each such name. | CLAUDE.md: "Names are TDMS names". |

## 3. Architecture and files

The four layers and the rules in [CLAUDE.md](../CLAUDE.md) apply unchanged: the UI calls only `api.js`; `api.js` calls only the single server entry; services call only the repository; **only the repository calls `SpreadsheetApp`**.

| File | Layer | Job |
| --- | --- | --- |
| `src/client/index.html` | UI | Shell and sign-in screen (name list, PIN for Admin) |
| `src/client/views/home.html` | UI | Home screen and the read-only master lists. `tools/build.js` inlines every file in `views/` into `index.html` for deployment, because an Apps Script web app serves one HTML page |
| `src/client/views/admin.html` | UI | Admin screens: master data, settings, users, seed, import review, audit log |
| `src/client/app.js` | UI | Screen routing and rendering; calls only `api.js` |
| `src/client/api.js` | API client | One function per method. A `transport` setting selects `mock` (reads `tests/fixtures/`, used on localhost) or `appsscript` (`google.script.run`); `rest` is added at the TDMS move |
| `src/server/Api.gs` | Entry | The only function the browser can call: `tlmiApi(request)`. Builds the envelope (§4), checks the session and the role, validates input, calls a service |
| `src/server/AuthService.gs` | Service | Name list, PIN check, sessions, the permission table (§6) |
| `src/server/MasterDataService.gs` | Service | Validation and rules for the master tables, settings and users |
| `src/server/AuditService.gs` | Service | Writes audit rows and record history; reads them for `audit.list` and `history.get` |
| `src/server/SeedService.gs` | Service | One-time, re-runnable seed (§7) |
| `src/server/ImportReviewService.gs` | Service | The dry-run import review (§10) |
| `src/server/ImportRules.gs` | Pure functions | Name normalisation and matching, date and grade parsing, uniform-cell splitting. No I/O, so Node can test it |
| `src/server/Schema.gs` | Data definition | Every table: tab name, ID prefix and format, profile (MUT, APP, VER, SYS), columns with type, required, length, enum, unique and link, history-tracked fields, append-only flag |
| `src/server/Repository.gs` | Repository | `get`, `list`, `create`, `update`, `append`, `nextId`, `withLock`. Reads `Schema.gs`. The only code that calls `SpreadsheetApp` |
| `tests/unit/`, `tests/fixtures/`, `tests/e2e/` | Tests | Node tests with an in-memory repository; fixture data for the mock transport; Playwright tests |
| `appsscript.json`, `package.json` | Config | Manifest and test scripts |

How `api.js` is packaged for HtmlService (clasp pushes `.js` files as server code), and how the DEV and TEST script IDs are kept out of the repo, are settled in the build plan. The contract is fixed here: the UI calls only `api.js`, and no script or sheet ID is committed.

## 4. Request and response

One entry point, `tlmiApi(request)`. The shape is the TDMS envelope (API-CONTRACT §2) in the subset Phase 1 needs.

- **Request:** `{ v: 1, rid, method, params, token, reason? }`. `token` is absent only for pre-auth methods. An unknown field in the request or in `params` returns `VALIDATION`. An unknown method returns `NOT_FOUND`.
- **Success:** `{ ok: true, data, meta: { request_id, rid, server_time, server_date, page? } }`.
- **Failure:** `{ ok: false, error: { code, message, fields?, retry_after?, current? }, meta }`. A `CONFLICT` carries `current: { row_version, updated_by_name, updated_at }`.
- No stack trace, sheet name, spreadsheet ID or internal path appears in any response. Errors are returned as data, not thrown to the browser.
- Lists follow API-CONTRACT §6.1: whitelisted `filters`, one `sort` key, `page` and `page_size` (maximum 50), optional `q`. No method returns an unbounded list.
- Dates are `yyyy-mm-dd`; timestamps are ISO 8601 UTC; IDs are opaque text.

**Order of checks inside `tlmiApi`:** parse the request, find the session, read the user and role, check the permission table, validate `params`, then call the service. The first failure stops the call.

**Error codes used in Phase 1** (API-CONTRACT §4): `AUTH_FAILED`, `AUTH_LOCKED`, `AUTH_REQUIRED`, `SESSION_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `CONFIG_MISSING`, `BUSY` (the script lock was not obtained within 10 seconds; `retry_after` is set), `SERVER` (only the `request_id` is shown). The other TDMS codes are added when a phase needs them.

## 5. Methods in Phase 1

Method names are the TDMS names. "Concurrency" is `rv` (`row_version` checked under the lock), `sup` (`supersedes_id`, for versioned settings) or none. Permissions are in §6.

| Method | Kind | Who | Concurrency | Audit event |
| --- | --- | --- | --- | --- |
| `system.ping` | R | no sign-in | none | none |
| `auth.listSignInUsers` **(TLMI interim only)** | R | no sign-in | none | none |
| `auth.signIn`, `auth.signOut`, `auth.me` | W, W, R | see §6 | none | `AUTH.SIGNIN`, `AUTH.SIGNIN.FAILED`, `AUTH.SIGNIN.LOCKED`, `AUTH.SIGNOUT` |
| `brands.*`, `regions.*`, `stations.*` | R/W | read: all roles; write: Admin | rv | `MASTER.<ENTITY>.CREATED`, `.UPDATED`, `.DEACTIVATED`, `.REACTIVATED` |
| `locations.*` | R/W | read: all roles; write: Admin | rv | `LOCATION.CREATED`, `.UPDATED`, `.DEACTIVATED`, `.REACTIVATED` |
| `lookups.*` | R/W | read: all roles; write: Admin | rv | `LOOKUP.CREATED`, `.UPDATED`, `.DEACTIVATED`, `.REACTIVATED` |
| `components.list`, `get`, `update` | R/W | Admin | rv | `COMPONENT.UPDATED` |
| `settings.list`, `get` | R | Training Manager, Senior Training Manager, Admin | none | none |
| `settings.set` | W | Admin | sup | `SETTING.CHANGED` (old value, new value, `effective_from`) |
| `users.list`, `get`, `create`, `update`, `deactivate`, `reactivate` | R/W | Admin | rv | `USER.CREATED`, `.UPDATED`, `.DEACTIVATED`, `.REACTIVATED` |
| `audit.list` | R | Senior Training Manager, Admin | none | `AUDIT.VIEWED` |
| `history.get` | R | Admin | none | none |
| `seed.run` **(TLMI only)** | W | Admin | none | `SEED.RUN` |
| `importReview.run`, `importReview.get` **(TLMI only)** | W, R | Admin | none | `IMPORT.REVIEW_RUN` |

`*` means list, get, create, update, deactivate, reactivate. The `brand` code cannot be changed after creation. System lookup values (for example the location type Store) cannot be renamed or disabled. There is no delete method in Phase 1: records are deactivated, never removed. `importReview.get` returns counts only; it never returns a sheet ID or link.

## 6. Sign-in, sessions and roles

### 6.1 Interim sign-in (Phase 1)

1. The sign-in screen calls `auth.listSignInUsers`, which returns the ID and display name of every active user, and nothing else.
2. The user picks a name. An Admin also types the Admin PIN. Other roles need no PIN.
3. `auth.signIn { user_id, pin? }` returns `{ token, user: { id, name, role } }`. The TDMS fields `must_change_password`, `scope`, `flags` and `settings_public` are added with password sign-in.
4. The token is a random UUID from `Utilities.getUuid()` (122 random bits), which is enough for Phase 1 and is on record here so that Phase 2 reviews it together with password sign-in. The session is stored in `CacheService` under that token with the user ID, issue time and last-seen time. The role is read from the user record on every call (item 6).
5. A session ends after **30 idle minutes** (CFG-001) or **6 hours** in total, whichever is first. `auth.me` is the keep-alive. An expired or ended session returns `SESSION_EXPIRED`.
6. On every call the server reads the user record again (cached for up to 60 seconds). If the user has been deactivated or the role has changed, the call fails or uses the new role. The role in the session is never trusted on its own.
7. **Admin PIN.** One PIN, set by the owner in the Apps Script editor and stored only as a salted, iterated HMAC-SHA256 hash in Script Properties (the AD-10 method). It is never in the sheet, the repo or the audit log. Minimum length is 6 characters. After **5** wrong tries the account is paused for **15 minutes** (CFG-002, CFG-003); the call returns `AUTH_LOCKED` with `retry_after`. A wrong PIN returns the generic `AUTH_FAILED`. The failure counter and the pause time are kept in Script Properties (key `ADMIN_PIN_FAILS`, JSON `{count, pausedUntil}`), read and written under the script lock, and the pause is checked before the hash is computed. They are not kept in `CacheService`, because cache entries can be evicted early and that would reset the counter. A failure counts until a correct PIN clears it or a pause ends. The hash iteration count is a code constant stored inside each hash (`hmac-sha256$<iterations>$<hex>`), so it can change later without breaking old hashes; it is chosen by a measurement on TEST (plan Task 2, TDMS spike S-02).
8. The web app runs as the owner. Users never receive edit access to `TLMI_DB`.

**Known limit, accepted by Leo:** anyone with the web app link can see the display names of the active officers and can sign in as a non-Admin role. Phase 1 therefore holds no Team Leader data, and the TEST link is shared only with named officers. HR employee numbers are never returned to a session without the Admin PIN: `audit.list` removes `hr_employee_no` from every row unless the caller is an Admin (§9), and every `users.*` method is already Admin only (§5). (Decided by the reviewer on 2026-10-20 under Leo's standing instruction; it narrows access and widens nothing.) The domain-only access option of TDMS AD-01 does not exist while the owner is a personal Google account (TDMS D069).

### 6.2 Roles

Five roles use the app: **Training Officer, Training Supervisor, Training Manager, Senior Training Manager, Admin.** Store Heads and Area Managers are not users in TLMI v1, and there is no HR role.

| Method group | Officer | Supervisor | Manager | Senior | Admin |
| --- | --- | --- | --- | --- | --- |
| `system.ping`, `auth.*` | yes | yes | yes | yes | yes |
| Read brands, regions, locations, stations, lookups | yes | yes | yes | yes | yes |
| Write brands, regions, locations, stations | no | no | no | no | yes |
| Write lookups; components; users; `settings.set` | no | no | no | no | yes |
| `settings.list`, `settings.get` | no | no | yes | yes | yes |
| `audit.list` | no | no | no | yes | yes |
| `history.get`, `seed.run`, `importReview.*` | no | no | no | no | yes |

The table is one object in `AuthService.gs`. Widening a permission later is a one-line change there. The server checks it on every call; a hidden button is not security. Users cannot change their own role, and the last active Admin cannot be deactivated or demoted.

### 6.3 Replacement by password sign-in (first task of Phase 2)

`auth.signIn { employee_id, password }` replaces the interim call, as in API-CONTRACT §5, with `auth.changePassword`, `must_change_password` and `users.resetPassword`. `users.hr_employee_no` becomes required. The salt and iterated-hash method of AD-10 is used, with the pepper in Script Properties. The failure throttle (CFG-002, CFG-003) moves to the employee ID. `auth.listSignInUsers` and the Admin PIN are removed. The token, the envelope and the permission table do not change.

## 7. Master data and the seed

Phase 1 creates these tabs in `TLMI_DB`: `brands`, `regions`, `locations`, `stations`, `lookups`, `assessment_components`, `settings`, `users`, `audit_log`, `record_history`, `id_counters`, `import_batches`. Tabs for later phases are added by adding their schema entries. Every table follows the rules in [DATA-MODEL](../docs/DATA-MODEL.md) and the database rules in CLAUDE.md. A setup function run once by the owner creates any missing tab and header row from `Schema.gs` and never changes a tab that exists.

| Table | Profile | Seed and rules |
| --- | --- | --- |
| `brands` | MUT | One row: Angel's Pizza, `code` = `AP` (§12, item 1). The code is permanent. |
| `regions` | MUT | Distinct region values from column B of the SETTINGS tab of the legacy copy, trimmed. A name that matches another only by case or spacing is skipped and reported. |
| `locations` | MUT | The store list from the SETTINGS tab, trimmed. Field `name` (the TDMS name). `location_type` = Store, brand = Angel's Pizza, region from the same SETTINGS row. A duplicate name is skipped and reported; a store whose region is not found is rejected and reported. Admin can add, edit and deactivate. |
| `stations` | MUT | Food Prep, Pizza Maker, Cashier, Service, Commis, Dough Maker, scoped to Angel's Pizza. Legacy spellings such as "FOOD PREP*" are not seeded; they are mapped in the import review. |
| `lookups` | MUT | Category `location_type`: Store (system value), Commissary, Office, Call Center, Warehouse (TDMS ENT-003). Category `tl_close_reason`: Disqualified. Categories `tl_quit_reason` (CFG-018) and `appointment_letter_status` are created empty; their values are still open (DECISIONS). |
| `assessment_components` | MUT | Entry stage: ISTV, Tech Val Food Prep, Tech Val Pizza Maker, TL entry exam Food Prep, TL entry exam Pizza Maker (required). Certification stage: Checklist, Exam (required), Kitchen feedback, Manager feedback (at least one feedback is required, enforced in Phase 2). Admin can rename and edit; the weights are not stored here (see `settings`). |
| `settings` | VER | See the table below. Every change inserts a new version and keeps the old one. |
| `users` | MUT | Officers from the `SEED_OFFICERS` tab, a pasted copy of `CONFIG_TRAINERS` (§12, item 2). Role is set by Admin. `hr_employee_no` may be blank in Phase 1. `password_hash` and `salt` stay empty until Phase 2. |

**Settings seeded** (the key is the TDMS configuration ID; the value is stored as text with a `value_type`):

| Key | Meaning | Value |
| --- | --- | --- |
| CFG-001 | Idle sign-out, minutes | 30 |
| CFG-002 | Wrong sign-in tries before a pause | 5 |
| CFG-003 | Pause length, minutes | 15 |
| CFG-040 | Probation period, months | 3 |
| CFG-041 | Certification pass mark | 85 |
| CFG-042 | Extension length, days | 30 |
| CFG-044 | Certification weights: checklist, exam, feedback | 30 / 40 / 30 |
| CFG-045 | Feedback weights: kitchen, manager | 60 / 40 |

**CFG-047 (extension limit) is deliberately not seeded.** Any read that needs it returns `CONFIG_MISSING` until Admin sets it, as RULE-104 requires.

The seed is re-runnable. It skips rows that already exist, validates each row on its own (a bad row is skipped and listed, and the rest continue), writes one `import_batches` row with the counts, and has a dry-run option that reports without writing. It reads only a copy of the legacy sheet.

## 8. Write flow and concurrency

For `locations.update { id, row_version, patch }` (all master data updates follow the same path):

1. `Api.gs` finds the session, reads the role and checks the permission table. A non-Admin gets `FORBIDDEN`, and the denial is audited.
2. `MasterDataService` validates the patch: unknown field, required value, length, enum, uniqueness (a location name is unique per brand, ignoring case and spacing) and links (the brand and region exist and are active). Failures return `VALIDATION` with `fields`.
3. `Repository.update` takes the script lock (wait up to 10 seconds, else `BUSY`), reads the row and compares `row_version`. A mismatch returns `CONFLICT` with `current`.
4. In the same lock and the same batch write it writes the row (`row_version` + 1, `updated_at`, `updated_by`), one `record_history` row for each changed field (old value, new value), and one `audit_log` row. Then it releases the lock and returns the new row.

In a patch, an absent field is unchanged and `null` clears the field where the schema allows it. `create` returns the new row with its ID and `row_version`. `deactivate` and `reactivate` change `is_active` only and keep the history. Settings use `settings.set { setting_key, value, supersedes_id, reason }`: a new row is inserted, and a `supersedes_id` that is not the current version returns `CONFLICT`. TLMI requires a `reason` for every settings change.

## 9. IDs, audit log and history

- **IDs** are made by the server and never typed or reused. `id_counters` holds `prefix`, `year`, `last_value`. `Repository.nextId(prefix)` runs inside the same lock as the write that uses it, so IDs have no gaps and no duplicates. Formats follow TDMS DATA-MODEL §2 (`LOC-0001`, `USR-0001`, `AUD-000000`; `BRD-`, `REG-`, `STN-`, `LKP-`, `CMP-`, `SET-`, `HIS-`, `IMP-` with the sequence length kept in `Schema.gs`).
- **`audit_log`** (append-only): `id`, `at`, `user_id`, `hr_employee_no`, `event`, `entity`, `entity_id`, `result` (OK, DENIED, FAILED), `request_id`, `detail`. It records every sign-in, sign-out and failed or locked sign-in, every successful write, and every `FORBIDDEN` and `CONFLICT` result. It never stores a PIN, password or token. `VALIDATION` failures are not recorded.
- **`record_history`** (append-only): `id`, `at`, `user_id`, `entity`, `entity_id`, `field`, `old_value`, `new_value`, `request_id`. Every master data table tracks all its fields. `status_history` is added in Phase 2 with the first status.
- `audit_log` and `record_history` are flagged append-only in `Schema.gs`. The repository has no update or delete for them and throws if code tries. The owner can still edit the sheet by hand, so this protects against code, not against the owner.
- `audit.list` uses cursor paging with filters on event, entity, user and date range. The `hr_employee_no` column is removed from every returned row unless the caller is an Admin. The `detail` text never holds `hr_employee_no`, `pin`, `password` or `token`; those keys are removed before the row is written.

## 10. Import review (dry run)

**Purpose:** let officers see and fix the legacy data problems before the Phase 2 import, without changing any data.

**Setup.** The owner makes a copy of "[sys] Team leader Monitoring" and gives its ID to the script in Script Properties. A separate sheet, `TLMI_IMPORT_REVIEW`, receives the results. The script never opens the original legacy sheet. Neither sheet ID is committed.

**Run.** `importReview.run` (Admin) reads MASTER_LOG and UNIFORM_LOG of the copy in one batch read each, builds the tabs below, and writes one `import_batches` row (kind IMPORT_REVIEW, source row count, counts per tab, status Done or Failed). A failure part-way marks the batch Failed and leaves the previous review in place. Nothing is written to any `TLMI_DB` table except `import_batches` and `audit_log`. About 280 rows is far below the 6-minute limit.

| Tab | Content |
| --- | --- |
| `persons_proposed` | One row per person found, with proposed aliases and the number of enrollments |
| `possible_duplicates` | Names that are close but not equal, shown side by side |
| `name_mapping` | Each distinct spelling of a store, station and officer, and the master record it matches, if any |
| `bad_values` | Source row, column, raw value and the reason |
| `uniform_split` | Each uniform cell split into one issue per row, with item, size, quantity and DR number |
| `summary` | Row count, count per legacy status, count per problem type, and the difference from the hand-kept SUMMARY tab |

**Rules.**

1. **No guessing.** A value is mapped automatically only when its normalised form (upper case, trimmed, spaces collapsed, punctuation removed) equals exactly one master record or an alias an officer has already confirmed. Anything else goes to review.
2. **Persons are never merged automatically.** Two names that differ by a middle name or initial are listed in `possible_duplicates`. The same person with two entry dates is proposed as one person with two enrollments, for an officer to confirm.
3. **Bad values** include a grade outside 0 to 100 or in percent form (9475%), a date serial of 30 Dec 1899, an unreadable date, a certification date before the entry date or after today, an entry date after today, a possible day and month swap, a blank required field, and a status that is not one of the eight states or a known legacy value. The legacy status Disqualified is mapped to Failed with the close reason Disqualified and is shown as information, not as an error. STATUS values such as FOR REPORTING and NEW ENTRY are report flags, not statuses.
4. **Uniform cells** are split on the separator, and the DR number is read from the `DR#` pattern. A part with no readable quantity, size or item goes to `bad_values`.
5. **Decisions.** Each review row has `decision` (confirm, different person, correct value), `corrected_value`, `decided_by` and `decided_on`, filled in by the officer in the sheet. Only those columns are editable. Phase 2 reads them.
6. **A re-run keeps decisions.** Rows are keyed by tab, source row and raw value. A re-run keeps the decision on a row whose key has not changed and marks a changed row "needs review". It never clears a decision.
7. The review sheet holds staff names. It is shared only with named officers and is never copied into the repo. Test fixtures use invented names with the same patterns.

## 11. Testing and gate G1

**Unit and contract tests (Node, no Apps Script).** Services run against an in-memory repository. They cover: no duplicate or skipped IDs; `CONFLICT` on a stale `row_version`; every role against every method (only the permitted roles succeed, the rest get `FORBIDDEN`); PIN lockout and `retry_after`; session idle and absolute expiry; refusal of update and delete on append-only tables; settings versioning and `CONFIG_MISSING`; a second seed run adds nothing; the envelope shape and the absence of internal names in errors; and every import review rule against a fixture built from the real data patterns with invented names (one officer spelled three ways, a grade of 9475%, the date 30 Dec 1899, a person with two enrollments, near-duplicate names, a uniform cell with several DR numbers).

**Browser checks (Playwright, localhost, mock transport).** At widths 1280, 768 and 375, for each of the five roles: sign in, open the master lists, and for Admin edit a store and see the conflict message when the record changed. No console errors and no failed network calls. Each flow explored by hand becomes a saved test in `tests/e2e/`. On the deployed TEST app there is one smoke test; Leo signs in and types the PIN himself.

**Gate G1 is passed when all of these are true:**

1. All five roles sign in on TEST; the Admin signs in with the PIN.
2. The master lists are seeded and Leo has checked them against the SETTINGS tab and the `SEED_OFFICERS` tab.
3. An Admin edits a store and sees the history and audit rows; a stale edit returns `CONFLICT`.
4. Every non-Admin gets `FORBIDDEN` on every Admin method.
5. The import review ran on a copy of the 276-row sheet; all six tabs are present; the summary equals 276 rows and the status counts; nothing was written to the legacy copy or to any Team Leader table.
6. Unit tests, the browser checks at three widths and the pull request review pass, with no critical or major finding open.
7. DEV and TEST are deployed through `clasp`; LIVE is untouched.

## 12. Answers and open details

**Answered by Leo on 2026-10-19:**

1. **Brand code** for Angel's Pizza: `AP`. Leo wrote "AP/AP001". This spec reads `AP` as the permanent brand `code`; the `BRD-` ID is generated by the server. If `AP001` was meant as the code, change it before the first seed run, because a brand code cannot be changed afterwards.
2. **Source of the officer list.** `CONFIG_TRAINERS` is in the TOIS PMS DATABASE sheet. To avoid giving TLMI access to that sheet, the owner pastes the list (name, role, and employee number if known) into a tab named `SEED_OFFICERS` in the legacy copy.
3. **Who may edit stores, stations, brands and regions:** Admin only. TDMS (PERM-061) also lets the Training Manager and Senior Training Manager do this; TLMI v1 does not. Widening is a one-line change in the permission table.
4. **Admin delete and the recycle bin:** part of v1 (Phases 0 to 4) but not Phase 1, which has deactivate and reactivate only. Proposed phase: Phase 4, with the other Admin tools. The build plan for that phase confirms it.

**Decided in this spec (tell me if you disagree):**

5. One Admin PIN, shared by all Admins, set by the owner.
6. The field is `name` on `locations`, as in TDMS ENT-012. PLAN §6 and DATA-MODEL used `store_name`; both are corrected in the same pull request.
7. Entry-grade and certification weights are read from `settings`. The `weight` column listed for `assessment_components` stays empty so that there is one source.
8. Prefix-only IDs use a four-digit sequence (six for `HIS-`) unless TDMS gives another length; this is checked against TDMS before G1.
9. TLMI requires a reason for every settings change (TDMS requires it for A2 settings only).
