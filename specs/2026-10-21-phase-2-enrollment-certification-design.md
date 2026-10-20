# Phase 2 Design: Password Sign-in, Team Leader Records and the Legacy Import

| | |
| --- | --- |
| Status | **Draft.** It becomes Approved when the pull request that adds it is merged on Leo's word. |
| Date | 2026-10-21 |
| Phase | 2, weeks 4 to 6 (estimate) |
| Gate | G2: the 276 MASTER_LOG records are reconciled, and MASTER_LOG is set to read-only |
| Inputs | [PLAN](../docs/PLAN.md) §3, §4, §9; [BUSINESS-RULES](../docs/BUSINESS-RULES.md); [DATA-MODEL](../docs/DATA-MODEL.md); [DECISIONS](../docs/DECISIONS.md); [LEGACY-DATA-PROFILE](../migration/LEGACY-DATA-PROFILE.md); [Phase 1 design](2026-10-19-phase-1-core-data-design.md); TDMS `API-CONTRACT.md` (§4 to §6, §8.2, §8.5, §8.8, §8.9), `DATA-MODEL.md` (§1 to §3, ENT-020, 021, 024, 043, 047, 060 to 064), `WORKFLOWS.md` (WF-002), `PERMISSIONS.md` (PERM-030 to 035, AMB-02), `CONFIGURATION.md` (CFG-001 to 003, 018, 040 to 047, FX-002), `ARCHITECTURE.md` (AD-10) |

## 1. Purpose and scope

Phase 2 replaces the daily work in MASTER_LOG: officers enroll Team Leaders, record entry grades, run the certification check, and certify, extend, fail, quit, return or promote, all in the app. It first replaces the interim sign-in with Employee ID and password, because real Team Leader names arrive in this phase. It ends with the legacy MASTER_LOG rows imported and reconciled.

| In Phase 2 | Not in Phase 2 |
| --- | --- |
| **2A.** Employee ID and password sign-in; forced password change; Admin password reset; removal of the name list and the Admin PIN (ends exception X-1) | Self-service password reset by e-mail (TLMI users have no e-mail address on file; Admin resets instead, §4.6) |
| **2B.** Persons and name aliases; Team Leader enrollments; entry grades; certification checks with a computed final grade; certify, extend, fail, quit, return to probation, promote; status history and TL history; Team Leader screens | Uniforms and appointment letters (Phase 3); the dashboard, the `tl_summary` cache and reports (Phase 4) |
| **2C.** Legacy import: validate against the review sheet decisions, skip rows, commit in chunks, reconcile against the 276 rows | Uniform cells and the STATUS column's appointment letter values (kept in the import rows for Phase 3) |
| Unit tests, browser tests, deploy to DEV and TEST, a rehearsal of the import on TEST | LIVE: the owner deploys by hand after a dated backup (§10.8) |

## 2. Decisions taken in this design

TLMI takes the TDMS answer wherever TDMS has one. Where TDMS is still open, this design takes the narrowest workable rule, marks it as an interim decision, and switches to the TDMS answer when TDMS decides.

| # | Decision | Reason |
| --- | --- | --- |
| P2-1 | Password sign-in is built and deployed (part 2A) before any real Team Leader record is written to a `TLMI_DB` table, including on TEST. | Exception X-1 ends here (Phase 1 design §6.3). |
| P2-2 | **Interim X-2: probation starts when the last required entry grade is saved.** The status moves from Entry to Probationary automatically at that moment. The deadline is computed from the entry date in every case, so the choice changes only the status label of open records. | TDMS WF-002 step 2 is open. With the other choice (at enrollment), the Entry state would never be seen. |
| P2-3 | **Interim X-3: return to probation** is allowed from Certification check and Extended only, keeps the deadline, and needs a note. | TDMS WF-002 step 9 leaves the source states open. Returning a closed record would reopen a decision. |
| P2-4 | **One feedback form:** when only one of the two feedback scores is recorded, the feedback part of the final grade is that score. With both, feedback = 0.60 x kitchen + 0.40 x manager (CFG-045). | TDMS requires at least one feedback score (RULE-102) but leaves single-form weighting open (CD-26). Counting a missing form as 0 would fail a Team Leader for a missing paper form. |
| P2-5 | The final grade is rounded half up to 2 decimals, and the pass check uses the rounded value (84.995 rounds to 85.00 and passes at 85). | One rule, shown the same way on screen and in reports. |
| P2-6 | **Admin does the officer actions** (enroll, update, entry grades, certification check, certify, extend, fail, quit), reads every Team Leader record and runs the legacy import. Admin does **not** return to probation or promote. | Decided by Leo on 2026-10-21 (§12, question 2): the owner's account is Admin and the owner certifies Team Leaders. TDMS PERMISSIONS marks Admin as undecided ("?") for PERM-031 and 032; TLMI takes Leo's answer and reports it to TDMS for PH-12. Promotion by Admin stays blocked (AMB-02), and return to probation (PERM-033) stays with Supervisor and higher. |
| P2-13 | **The TL course program grade is a certification requirement.** The legacy column "CERTFICATION GRADE" is not the checklist: it records that the Team Leader passed the 3-month TL course program, and it is part of the certification validation. It becomes its own certification component, `TL course program` (required), recorded once per enrollment at a certification check, shown with the other grades, and **not** part of the final grade formula (RULE-102 is unchanged). `tl.certify` needs a course program grade in force. | Leo, 2026-10-21 (§12, question 1). |
| P2-7 | A person is created by `tl.enroll` (new person fields) or by the legacy import. There is no separate person create method. | TLMI has no employee module. TDMS `tl.enroll` expects an existing employee; TLMI keeps the method name and creates the person through `PersonService` in the same transaction. |
| P2-8 | Name aliases are stored in `person_aliases` with `alias_type` = `NAME`, next to the TDMS types `HR_NO` and `TEMP`. | The legacy data has spelling variants of one person. TDMS person merge (PH-12) maps `NAME` aliases. |
| P2-9 | The legacy import uses the TDMS import method names (`import.validate`, `import.rows.list`, `import.rows.skip`, `import.commit`) but reads its source from the legacy copy and the review sheet, not from an uploaded file. It runs in the request, in chunks, not as a job. | 276 rows fit in a request; the review sheet already holds the officers' decisions. |
| P2-10 | Before `import.commit`, the owner makes a dated copy of `TLMI_DB` and types its date into the commit. The date is a reminder, not proof (as in the TDMS deploy tool). | TDMS AD-14 needs a backup before a commit; a Drive copy from the script would need Drive access for one step. |
| P2-11 | Legacy final grades are kept as legacy values (`weights_version` = `LEGACY`), and legacy records are exempt from the rules for new records (all entry grades, at least one feedback score, a quit date). | PLAN §9 step 6 and DATA-MODEL notes: legacy records have no feedback score and cannot be recomputed. |
| P2-12 | The CEBU TL tab is not imported. | Checked on 2026-10-21 against the dated copy: its 8 rows are all in MASTER_LOG, with the same columns. It is a regional view, not a separate list. This closes the open item in DECISIONS. |

## 3. Order of work

| Part | Pull request | Content | Gate inside the phase |
| --- | --- | --- | --- |
| 2A | E | Password sign-in, users changes, bootstrap and removal of X-1, sign-in and password screens | Deployed to TEST and signed in by Leo before part 2C runs on TEST with the real copy |
| 2B | F | Schema for the new tables, `PersonService`, `TlRules` (pure), `TlService` (all `tl.*` methods), settings and lookup changes | Unit tests only |
| 2B | G | Team Leader screens and browser tests | Browser tests at three widths, five roles |
| 2C | H | Review sheet name proposals, `ImportService`, import screens, reconciliation, G2 checklist, setup guide | Rehearsal on TEST, then the owner's LIVE run |

Each pull request starts from an updated `main` after the previous one is merged.

## 4. Part 2A: Employee ID and password sign-in

### 4.1 Rules

1. A user signs in with their HR employee number (`employee_id`, digits only) and a password. The name list (`auth.listSignInUsers`) and the Admin PIN are removed.
2. Passwords are stored as a per-user salt plus an iterated HMAC-SHA256 hash with the server pepper, in the format already used by `Hasher` (`hmac-sha256$<iterations>$<hex>`, TDMS AD-10). The iteration count is the one measured on TEST in Phase 1. When a user signs in and the stored count differs from `Hasher.DEFAULT_ITERATIONS`, the password is hashed again with the current count (AD-10 upgrade on sign-in).
3. Password rule FX-002: at least 8 characters, at least one letter and one digit, and not equal to the current password. A temporary password follows the same rule.
4. A password, a temporary password or a hash is never written to the audit log, the record history, a log line or an error message. A temporary password is returned once, in the response of `users.create` or `users.resetPassword`, and never again.
5. `must_change_password` is set by every temporary password. While it is set, every method except `auth.me`, `auth.signOut` and `auth.changePassword` returns `FORBIDDEN` (TDMS pipeline step 4).
6. Sessions stay as in Phase 1 (a random token in `CacheService`, 30 minutes idle, 6 hours absolute) and carry a **session epoch** per user. The epoch is kept in Script Properties (`SESSION_EPOCH:<user_id>`, TDMS D077) and goes up on a password change, a password reset, a role change and a deactivation. A session whose epoch is lower than the user's is ended with `SESSION_EXPIRED`.

### 4.2 Failed sign-ins

1. The pause (CFG-002 failures, then CFG-003 minutes) is counted **per user**, in the user record (`failed_attempts`, `cooldown_until`), as in TDMS ENT-024. It replaces the single Admin PIN counter of Phase 1.
2. An unknown or inactive employee ID gets the same generic `AUTH_FAILED` after the same amount of hashing work as a known one, so that response time does not tell which IDs exist. It takes no lock and writes no row.
3. A known user whose pause has not ended gets `AUTH_LOCKED` with `retry_after`; the pause is checked before any hash is computed.
4. Only a failure of a known user takes the script lock (to update the counter). This closes the Phase 1 open item "anonymous sign-in calls take the script lock" (DECISIONS, Open for Phase 2).
5. `AUTH.SIGNIN.FAILED` and `AUTH.SIGNIN.LOCKED` audit rows are capped at 50 per user per day; failures beyond the cap are still counted but not written. The cap counter lives in `CacheService`; an evicted counter only lets a few more rows through.
6. `failed_attempts`, `cooldown_until` and `last_login_at` are not tracked in `record_history` (they would fill it with noise). The schema marks them `noHistory`.

### 4.3 Methods

| Method | K | Who | Notes |
| --- | --- | --- | --- |
| `auth.signIn {employee_id, password}` | W | no sign-in | Returns `{token, must_change_password, user{id, name, role}, capabilities[], scope{brand_ids[]}, flags{}, settings_public{idle_minutes, page_size}}` (TDMS §5). `capabilities` lists the methods of the permission table open to the role. Audit `AUTH.SIGNIN`, `.FAILED`, `.LOCKED` |
| `auth.changePassword {current, new}` | W | any signed-in user, also while `must_change_password` is set | FX-002; clears `must_change_password`; raises the epoch (ends the user's other sessions) and returns a new token for this browser. Audit `AUTH.PASSWORD_CHANGED` |
| `auth.signOut`, `auth.me` | W, R | any signed-in user | As in Phase 1; `auth.me` returns the same block as `auth.signIn` without the token |
| `users.create` | W | Admin | `hr_employee_no` is now required (digits only, unique among all users). Returns the user and `temporary_password`. Audit `USER.CREATED` (without the password) |
| `users.update` | W | Admin | As in Phase 1; a role change raises the epoch. `hr_employee_no` cannot be cleared once set |
| `users.resetPassword {id, row_version}` | W | Admin (PERM-111) | New temporary password, sets `must_change_password`, clears the pause, raises the epoch. Returns `temporary_password` once. An Admin cannot reset their own password here (they use `auth.changePassword`). Audit `USER.PASSWORD_RESET` |
| `users.clearCooldown {id, row_version}` | W | Admin (PERM-111) | Clears `failed_attempts` and `cooldown_until`. Audit `USER.COOLDOWN_CLEARED` |
| `users.deactivate` | W | Admin | As in Phase 1, and raises the epoch |

`auth.requestReset` and `auth.completeReset` (TDMS §5) are not built: TLMI holds no e-mail addresses. A user who forgets the password asks an Admin for a reset.

### 4.4 Users table changes

`users` gains `must_change_password` (bool), `failed_attempts` (int), `cooldown_until` (timestamp), `last_login_at` (timestamp). `hr_employee_no` becomes required for new users and is validated as digits only. `password_hash`, `salt`, `failed_attempts` and `cooldown_until` are never returned by any method. A seeded user without an HR number cannot sign in until Admin adds the number and resets the password.

### 4.5 Bootstrap and removal of the interim sign-in

Editor functions (each starts with `EditorGuard.check()`, limit L-3):

- `initFirstAdmin()` (changed): on an empty database it reads the temporary Script Properties `FIRST_ADMIN_NAME`, `FIRST_ADMIN_EMPLOYEE_NO` and `FIRST_ADMIN_PASSWORD`, creates the first Admin with that number and a hashed temporary password (`must_change_password` set), and removes the three properties. The refusals of Phase 1 stay (an active Admin exists; the name exists), plus: the number exists, the password fails FX-002.
- `initAdminPassword()` (new): for a database that already has its Admin from Phase 1. It reads `ADMIN_EMPLOYEE_NO` and `ADMIN_TEMP_PASSWORD`, refuses unless exactly one active Admin exists and the number is free or already that Admin's, sets the number and the hashed temporary password with `must_change_password`, and removes both properties. Audit `USER.PASSWORD_RESET` with detail `{source: 'editor'}`.
- `initAdminPin()` is removed. `initAdminPassword()` and `initFirstAdmin()` also delete `ADMIN_PIN_HASH`, `ADMIN_PIN_SALT` and `ADMIN_PIN_FAILS` when they are present. `checkConfig()` no longer lists them.

Order on an existing TEST or DEV database (setup guide): deploy part 2A, run `initAdminPassword`, sign in, change the password, then give every officer an HR number and a temporary password from the Users screen, and hand each password over in person.

Exception X-1 is marked **ended** in DECISIONS when part 2A is deployed to TEST.

### 4.6 Screens

- Sign-in: Employee ID and Password fields; one generic message on failure; the wait time when paused.
- Change password: shown at once when `must_change_password` is set, and from the user menu at any time. It states the rule (FX-002).
- Users (Admin): HR number required; buttons Reset password and Clear pause. The temporary password is shown once in a box with a Copy button and the text "Give this password to the user in person. It is not shown again."

## 5. Part 2B: data model

New tables follow DATA-MODEL and TDMS DATA-MODEL §8. IDs with a year take the year of the record's own date (entry date, grade date), not the current year (TDMS §2).

| Table | ID | Profile | History | Fields |
| --- | --- | --- | --- | --- |
| `persons` | `PER-000001` | MUT | F | `last_name` (required), `first_name` (required), `middle_name`, `suffix`, `hr_employee_no` (digits, unique when present), `legacy_ref` |
| `person_aliases` | `PAL-000001` | APP | A | `person_id`, `alias_type` (`NAME`, `HR_NO`, `TEMP`), `value`, `valid_from`, `valid_to` |
| `tl_enrollments` | `TLE-2026-0001` | MUT | S + F | `person_id`, `mother_location_id`, `support_location_id`, `station_id`, `batch_code`, `entry_date`, `deadline`, `status`, `close_reason_id`, `quit_reason_lookup_id`, `quit_date`, `certified_on`, `promoted_on`, `final_grade`, `pass_mark_used`, `weights_version`, `visit_report_url`, `remarks`, `legacy_ref` |
| `assessments` | `ASM-2026-000001` | APP | by construction | `subject_type` (`TL_ENROLLMENT`), `subject_id`, `component_id`, `score` (0 to 100, up to 2 decimals), `assessed_on`, `assessed_by`, `retake_no` (0 for entry grades, 1 and up for each certification check), `remark`, `supersedes_id`, `correction_reason` (required with `supersedes_id`), `legacy_ref` |
| `tl_extensions` | `TLX-000001` | APP | part of TL history | `tl_enrollment_id`, `extension_no`, `old_deadline`, `new_deadline`, `reason` |
| `tl_certifying_officers` | `TLO-000001` | APP | part of TL history | `tl_enrollment_id`, `user_id`, `retake_no` |
| `status_history` | `HIS-000001` | APP | is the history | `entity`, `entity_id`, `from_status`, `to_status`, `effective_date`, `remark`, `request_id`; stamp columns `at`, `user_id`. It shares the `HIS` counter with `record_history`, so a history ID is unique across both |
| `import_rows` | `IMR-000001` | MUT | A | `import_id`, `source_tab`, `source_row`, `row_hash`, `raw` (the source row as JSON text), `result` (`READY`, `NOT_READY`, `SKIPPED`, `COMMITTED`, `ALREADY_COMMITTED`), `issues`, `skip_reason`, `created_record_type`, `created_record_id`, `legacy_ref`. A committed row is never changed again |

Changes to Phase 1 tables: `users` (§4.4); `import_batches.kind` gains `LEGACY_TL` and `status` gains `Validated`, `Committing`, `Committed`. `appointment_letter_status` is added to `tl_enrollments` in Phase 3, with the uniforms.

`status` values (TDMS WF-002): `Entry`, `Probationary`, `Certification check`, `Certified`, `Extended`, `Failed`, `Quit`, `Promoted`. **Open** states: Entry, Probationary, Certification check, Extended. Certified is closed until Promoted.

Settings and lookups:

- `CFG-047` (extension limit, int 1 to 10) is added to the settings definitions **without a default and without a seed**, so Admin can set it on the Settings screen. Until then `tl.extend` returns `CONFIG_MISSING` (RULE-104).
- The CFG-002 label becomes "Wrong passwords before a pause".
- The certification component `TL course program` (stage `certification`, `required` true) is added to the seed list, so a seed run on an existing database adds it and skips the rest (P2-13).
- **TLMI setting `TLMI-001` (TL course program pass mark, int 1 to 100), seeded at 90** (Leo, 2026-10-21; §12 question 5). TDMS has no key for this TLMI requirement, so the key is TLMI-only (it cannot clash with a later TDMS `CFG-` number) and is reported to TDMS for PH-12. If Admin ever removes it from use, certification would only need the grade recorded (§7.5).
- `tl_quit_reason` (CFG-018) stays an empty Admin list; `tl.quit` returns `CONFIG_MISSING` (key `CFG-018`) while it has no active value. `tl_close_reason` keeps `Disqualified` and takes the values Admin adds.

## 6. Part 2B: methods and permissions

O = Training Officer, S = Training Supervisor, M = Training Manager, Sr = Senior Training Manager, A = Admin. "rv" = the call carries `row_version` and fails with `CONFLICT` when it is stale. A transition not allowed from the current state returns `BLOCKED_BY_RULE` with `rule_id` (TDMS §4); `Api.failure` passes `rule_id` through.

| Method | K | Who | Conc | Audit | Notes |
| --- | --- | --- | --- | --- | --- |
| `tl.list` | R | O S M Sr A | — | — | Filters `status`, `mother_location_id`, `station_id`, `batch_code`, `open` (bool), `overdue` (bool); `q` searches the person's names and NAME aliases; sort `deadline` (default), `entry_date`, `name`; `page_size` up to 50. Each row: id, person name, store, station, batch, entry date, deadline, status, `overdue`, final grade |
| `tl.get {id}` | R | O S M Sr A | — | — | The enrollment, the person, the entry grades in force with the computed entry average, every certification check (attempt) with its scores, final and officers, the extensions, and `allowed_actions` for the caller's role and the current state |
| `tl.history {id}` | R | O S M Sr A | — | — | TL history (ENT-064): the record's `status_history` and the `record_history` of the enrollment, its assessments, extensions and officers, newest first, cursor paged |
| `persons.get {id}` | R | O S M Sr A | — | — | The person and their aliases and enrollments |
| `persons.matchCandidates {last_name, first_name, middle_name?, hr_employee_no?}` | R | O S M Sr A | — | — | Possible duplicates (TDMS D006): same HR number, same normalised name, or a near name (the import review's `near` rule). Proposals only |
| `tl.enroll` | W | O S M Sr A | — | `TL.ENROLLED` | `person_id` or `person{last_name, first_name, middle_name?, suffix?, hr_employee_no?}`, `mother_location_id`, `support_location_id?`, `station_id`, `batch_code?`, `entry_date`, `remarks?`, `confirm?`. With a new person and possible duplicates, and no `confirm: true`, it writes nothing and returns `warnings[]` with `requires_confirm: true` (TDMS §6.3). A same HR number is a `VALIDATION` error, not a warning |
| `tl.update` | W | O S M Sr A | rv | `TL.UPDATED` | Field edits only (TDMS §6.4 pattern): `mother_location_id`, `support_location_id`, `station_id`, `batch_code`, `visit_report_url`, `remarks`. Not the entry date, the deadline or the status |
| `tl.recordEntryGrade` | W | O S M Sr A | rv | `TL.ENTRY_GRADE_RECORDED` | `component_id` (an active entry component), `score`, `assessed_on`, `correction_reason?`. In an open state only. A second grade for the same component supersedes the current one and needs `correction_reason` |
| `tl.recordCertCheck` | W | O S M Sr A | rv | `TL.CERT_CHECK_RECORDED` | `assessed_on`, `checklist`, `exam`, `kitchen_feedback?`, `manager_feedback?`, `course_program?`, `officer_ids[]`, `visit_report_url?`, `correction_reason?`. §7.4 |
| `tl.certify` | W | O S M Sr A | rv | `TL.CERTIFIED` | §7.5 |
| `tl.extend` | W | O S M Sr A | rv | `TL.EXTENDED` | `reason`. §7.6 |
| `tl.close` | W | O S M Sr A | rv | `TL.FAILED` | `close_reason_id`, `remark?`. §7.7 |
| `tl.quit` | W | O S M Sr A | rv | `TL.QUIT` | `quit_date`, `quit_reason_lookup_id`, `remark?`. §7.8 |
| `tl.returnToProbation` | W | S M Sr | rv | `TL.RETURNED_TO_PROBATION` | `note` (required). §7.9 |
| `tl.promote` | W | S M Sr | rv | `TL.PROMOTED` | `promoted_on`. §7.10 |
| `import.validate`, `import.get`, `import.rows.list`, `import.rows.skip`, `import.commit` | W, R, R, W, W | A | rv on skip and commit | `IMPORT.VALIDATED`, `IMPORT.ROW_SKIPPED`, `IMPORT.COMMITTED` | §10 |

`tl.uniform.log` is Phase 3. Audit events are the TDMS WF-002 codes; `TL.UPDATED` is the TDMS §6.4 pattern name for a field edit and is marked as a TLMI addition. Every TL write also writes its `status_history` row (when the status changes) and its `record_history` rows (for MUT field changes) in the same transaction.

Lists are cached (CLAUDE.md): `tl.list` keeps its joined base rows in `CacheService` for up to 60 seconds under a data version that every TL write raises, so a write is visible on the next call.

## 7. Part 2B: the Team Leader workflow

`TlRules.gs` holds the pure rules (no I/O): the deadline, the entry check, the final grade, and the transition table. `TlService.gs` reads and writes through the repository.

### 7.1 Enroll (RULE-100)

- The person must have no open enrollment (`BLOCKED_BY_RULE` RULE-100). A closed one is fine (re-enrollment, D068).
- `entry_date` is not after today. `deadline` = `entry_date` + CFG-040 months in force on the entry date; when the day does not exist in the target month, the last day of that month is used (30 Nov + 3 months = 28 or 29 Feb).
- The store must be an active Store location; the station an active station of the brand. Status `Entry`. One `status_history` row (from empty to Entry).

### 7.2 Entry grades (RULE-101)

- The required entry components are the active `entry` components with `required` = true (five by default, D064). A grade is in force when no other row supersedes it (TDMS D072).
- The entry average shown on screen is the mean of the grades in force for the required components, rounded to 2 decimals. It is computed on read, never stored or typed.
- **X-2:** when the call saves the last missing required grade and the status is Entry, the status becomes Probationary in the same transaction.

### 7.3 Final grade (RULE-102)

final = (w_checklist x checklist + w_exam x exam + w_feedback x feedback) / 100, with the weights from CFG-044 and CFG-045 in force on the check date, and feedback per P2-4. Rounded per P2-5. The pass mark is CFG-041 in force on the check date. `weights_version` records the settings rows used, for example `CFG-041@v1;CFG-044@v1;CFG-045@v1`.

### 7.4 Certification check

- Allowed from Probationary, Certification check and Extended. All required entry grades must be in force (`BLOCKED_BY_RULE` RULE-101).
- `checklist` and `exam` are required; at least one of `kitchen_feedback` and `manager_feedback` (`VALIDATION`). `assessed_on` is not after today and not before the entry date. `officer_ids` holds 1 to 5 active users with a Team Leader role (Admin included, P2-6).
- `course_program` (P2-13) is required on the first attempt and optional on later ones: it is recorded once per enrollment (`retake_no` of the attempt that recorded it), and a later value supersedes it with `correction_reason`. It is not part of the final grade.
- From Probationary or Extended the call is a **new attempt** (`retake_no` = previous + 1): it writes the score rows, one `tl_certifying_officers` row per officer, the computed `final_grade`, and moves the status to Certification check.
- From Certification check the call **corrects the current attempt**: `correction_reason` is required, every changed score is a new row that supersedes the old one, the final is recomputed, the officers stay as recorded, and the status does not change.

### 7.5 Certify

From Certification check, when the latest attempt's final is at or above the pass mark and a TL course program grade is in force (`BLOCKED_BY_RULE` RULE-102 otherwise). The course program grade must be at or above the course pass mark TLMI-001 (90, §12 question 5), checked with the setting in force on the check date. Sets Certified, `certified_on` = the attempt's `assessed_on`, and stamps `pass_mark_used` and `weights_version` (D008). No approval step (D067).

### 7.6 Extend (RULE-104)

From Certification check, when the latest final is below the pass mark. CFG-047 must be set (`CONFIG_MISSING`), and the number of extensions so far must be below it (`BLOCKED_BY_RULE` RULE-104). Writes `tl_extensions` with the next `extension_no`, `old_deadline`, `new_deadline` = old deadline + CFG-042 days, and the reason; sets the new deadline and the status Extended. The next certification check returns the record to Certification check.

### 7.7 Fail (`tl.close`)

From Certification check or Extended, with an active `tl_close_reason` value. Sets Failed.

### 7.8 Quit (RULE-105)

From any open state, with `quit_date` (not before the entry date, not after today) and an active `tl_quit_reason` value. Sets Quit, never Failed (D068). The person can be enrolled again.

### 7.9 Return to probation (X-3)

From Certification check or Extended, by S M Sr, with a note. Sets Probationary; the deadline stays. The note is the `status_history` remark.

### 7.10 Promote (RULE-106)

From Certified, by S M Sr only (D031; Admin blocked, AMB-02). `promoted_on` is not before `certified_on` and not after today. Sets Promoted.

### 7.11 Overdue

A record is overdue when it is in an open state and its deadline is before today (RULE-109). `tl.list` and `tl.get` return the flag; the list shows it in red. The 14-day warning list and the Supervisor list are Phase 4.

### 7.12 Transition table

| From \ action | recordEntryGrade | recordCertCheck | certify | extend | close | quit | returnToProbation | promote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Entry | yes (may move to Probationary) | no (RULE-101) | no | no | no | yes | no | no |
| Probationary | yes | yes (new attempt) | no | no | no | yes | no | no |
| Certification check | yes (correction) | yes (correction) | if final >= pass | if final < pass | yes | yes | yes (S M Sr) | no |
| Extended | yes | yes (new attempt) | no | no | yes | yes | yes (S M Sr) | no |
| Certified | no | no | no | no | no | no | no | yes (S M Sr) |
| Failed, Quit, Promoted | no | no | no | no | no | no | no | no |

"no" returns `BLOCKED_BY_RULE` with the rule that blocks it (WF-002 "one stage at a time").

## 8. Part 2B: screens

All Team Leader screens are open to O S M Sr A; buttons follow `allowed_actions`, and the server decides.

- **Team Leaders** (menu): filters (status, store, station, batch, open only, overdue only), a search box, the paged list with the deadline and an Overdue tag, and an Enroll button (O S M Sr).
- **Enroll**: search for an existing person, or type a new person's names; the store, support store, station, batch and entry date; the computed deadline is shown before saving. Possible duplicates are shown with a "This is a different person" confirmation.
- **Team Leader record**: a header (name, status, store, station, batch, entry date, deadline with days left or Overdue, final grade and pass mark); Entry grades (each component, score, date, recorded by, Record or Correct); the TL course program grade; Certification checks (each attempt with its scores, final, officers and visit report link); Extensions; Actions for the current state; a History tab.
- Every action asks for its fields in a small form and shows the server's message on refusal ("Changed by X, reload" on `CONFLICT`).
- Text from the server is set with `textContent` only. Client code for these screens goes in `src/client/tl.js`; `tools/assemble.js` inlines every `src/client/*.js` file, `api.js` first, then `app.js`, then the others in name order.

## 9. Persons and duplicates

- `PersonService` is the only writer of `persons` and `person_aliases` (TDMS P4).
- Name fields are stored as typed, trimmed and with spaces collapsed. Matching and search use the normalised form of the import review (`ImportRules.normalizeName`: upper case, punctuation removed, accents kept), so "Dela Cruz" and "DELA CRUZ" match.
- A person is never merged automatically. A duplicate found after go-live is handled by `persons.merge`, which stays blocked as in TDMS (⛔); until then a wrongly created person is left inactive by Admin in Phase 4.

## 10. Part 2C: the legacy import

### 10.1 Sources and flow

The import reads MASTER_LOG of the legacy copy (`LEGACY_COPY_ID`) and the four decision tabs of the review sheet (`REVIEW_SHEET_ID`): `persons_proposed`, `possible_duplicates`, `name_mapping`, `bad_values`. It never writes to either sheet.

1. **`import.validate`** builds a plan for every MASTER_LOG data row, writes one `import_batches` row (kind `LEGACY_TL`, status `Validated`) and one `import_rows` row per source row with its result and issues. Nothing else is written.
2. **`import.rows.list {import_id, filters{result}, page}`** shows the rows; **`import.get {import_id}`** shows the counts and the reconciliation (§10.6).
3. **`import.rows.skip {id, row_version, skip_reason}`** marks a row `SKIPPED` with a reason. A skip is carried to the next validation by `legacy_ref`.
4. **`import.commit {import_id, row_version, backup_date}`** commits the `READY` rows in chunks of 25 rows per transaction, and sets the batch `Committed` when none is left. `backup_date` must be today (P2-10). A commit stopped part way (time limit, `BUSY`) is continued by calling it again; committed rows are not repeated.

Validation is run again after the officers change decisions in the review sheet. A new validation supersedes the earlier batch; only the latest validated batch can be committed.

### 10.2 Review sheet changes (from the Phase 1 import review)

- `persons_proposed` gains `proposed_last_name`, `proposed_first_name`, `proposed_middle_name` and `proposed_suffix`, built by a name rule (§10.4). The officer confirms with `decision` = `confirm`, or types the corrected parts into `corrected_value` as `LAST | FIRST | MIDDLE | SUFFIX`.
- The decision words are: `confirm`, `different person` (possible duplicates), `correct value` (with `corrected_value`), and the new `drop value` (bad values: the value is left empty in TLMI). The setup guide's officer note lists them.

### 10.3 When a source row is ready

A row is `READY` when every item below holds; otherwise it is `NOT_READY` with one issue code per failed item.

| Item | Ready when | Issue code |
| --- | --- | --- |
| Person | Its `persons_proposed` row has `confirm` (or a valid `corrected_value`), and every `possible_duplicates` pair that names it has `confirm` (same person) or `different person` | `PERSON_UNCONFIRMED`, `DUPLICATE_UNDECIDED` |
| Mother store | `name_mapping` gives `exact`, or a confirmed alias | `STORE_UNMAPPED` |
| Support store | Blank, `NONE` or `N/A`, or mapped as above | `SUPPORT_STORE_UNMAPPED` |
| Station | Blank (allowed for legacy rows), or mapped (an asterisk spelling needs its confirmed alias) | `STATION_UNMAPPED` |
| Entry date | Parses, or its `bad_values` row has `confirm` (take `proposed`) or `correct value` | `ENTRY_DATE_BAD` |
| Status | RESULT maps (DISQUALIFIED to Failed with the close reason Disqualified), or its `bad_values` row gives a valid RESULT value | `STATUS_BAD` |
| Each grade and date column used | Parses, or its `bad_values` row has `confirm`, `correct value` or `drop value` | `VALUE_UNDECIDED` |
| One open enrollment | The person does not end up with two open enrollments | `OPEN_TWICE` |
| Not yet imported | No enrollment has this row's `legacy_ref`; a row whose number exists with another hash is `NOT_READY` | `CHANGED_AFTER_COMMIT` |

An unmapped ENTRY BY or CERT BY officer, a typed note in those columns, and a typed entry average that differs from the computed one are **warnings**: the row stays ready, the warning is listed, and the value is not used (a note is kept in `remarks` as "Legacy note: ...").

### 10.4 Name rule for the proposed name parts

Upper case, trimmed, spaces collapsed. `LAST, FIRST MIDDLE` when the cell has a comma. Otherwise the last word is the last name, joined with the words before it while they are surname particles (`DE`, `DEL`, `DELA`, `DE LA`, `DELOS`, `DE LOS`, `SAN`, `STA`, `STO`); `JR`, `SR`, `II`, `III`, `IV` (with or without a dot) at the end are the suffix; a single letter with or without a dot before the last name is the middle name; the rest is the first name. Officers correct the rest. The rule is in `ImportRules.proposeNameParts` and is tested with invented names in the real patterns (comma form, `JR.` at the end, a two-word particle, a middle initial, `MA.` as part of the first name).

### 10.5 Field mapping

| Legacy column | TLMI |
| --- | --- |
| B Date of Entry | `entry_date` |
| C Batch # | `batch_code` (trimmed; blank stays blank) |
| D Mother Store, G SUPPORT STORE, F Mother Station | `mother_location_id`, `support_location_id`, `station_id` |
| E Full name | the person (§10.3, §10.4); every distinct spelling becomes a `NAME` alias |
| H RESULT | `status`; `close_reason_id` Disqualified for DISQUALIFIED |
| Q CERTIFICATION DEADLINE | `deadline` when present; otherwise entry date + CFG-040 |
| K to O entry grades | `assessments` with `retake_no` 0 for the five entry components; `assessed_on` = the entry date; `assessed_by` = the ENTRY BY officer when mapped, otherwise empty |
| P TL ENTRY AVERAGE | not stored (computed); a difference over 0.5 is a warning |
| T CERTFICATION GRADE, U EXAM GRADE | `assessments` with `retake_no` 1 for **TL course program** (T, P2-13) and **Exam** (U); `assessed_on` = column S. No legacy row gets a Checklist grade |
| V AVERAGE | `final_grade` as a legacy value; `weights_version` = `LEGACY`; `pass_mark_used` empty |
| R CERT BY: | `tl_certifying_officers` (`retake_no` 1), one row per mapped officer |
| S DATE CERTIFIED | `certified_on` for Certified and Promoted; for other statuses it is only the check date of T and U |
| W STATUS, I Uniform Release | not imported in Phase 2; kept in `import_rows.raw` for Phase 3 |

Each imported enrollment has `legacy_ref` = `MASTER_LOG!<row>#<row hash>`, each imported person `LEGACY:<normalised name>`, and one `status_history` row from empty to its status, dated `certified_on` or the entry date, with the remark "Legacy import <IMP id> row <n>". Audit: one `IMPORT.COMMITTED` row per commit call with the counts, and one `TL.ENROLLED` row per enrollment with detail `{source: 'LEGACY_IMPORT', import_id}`.

### 10.6 Reconciliation

`import.get` returns, for the latest batch: the source row count (276 for the dated copy); the counts by result (`READY`, `NOT_READY` by issue, `SKIPPED`, `COMMITTED`, `ALREADY_COMMITTED`); and a table of legacy RESULT counts next to the TLMI status counts of the committed rows (DISQUALIFIED counted under Failed with reason Disqualified). The screen marks the batch reconciled when every source row is `COMMITTED`, `ALREADY_COMMITTED` or `SKIPPED` with a reason, and the two count columns agree.

### 10.7 What the import never does

It never guesses a value that has no officer decision, never merges two persons without a `confirm`, never overwrites a committed record, never writes to the legacy copy or the review sheet, and never imports uniforms in Phase 2.

### 10.8 Rehearsal on TEST and the real run

1. On TEST, after part 2A is deployed and Leo has signed in with a password: validate, fix decisions in the review sheet, validate again, commit, reconcile. This is the rehearsal; it holds real names, so the TEST link is shared only with named officers, as in Phase 1.
2. On LIVE (by the owner, by hand, after a dated copy of the LIVE `TLMI_DB`): the same steps. Then Leo protects MASTER_LOG in the original legacy sheet (read-only), which closes gate G2.

## 11. Testing and gate G2

**Unit tests (Node):** every `TlRules` function with the spec's values (the deadline across month ends and leap years; the final grade with both feedback forms, one form, and the 84.995 boundary); the transition table generated for every state x action x role (Admin allowed for the officer actions, refused for return and promote); certify without a TL course program grade, and with a course grade below TLMI-001 (89.99 blocks, 90 passes); each `tl.*` method's refusals (`BLOCKED_BY_RULE` with the right `rule_id`, `CONFIG_MISSING` for CFG-047 and CFG-018, `CONFLICT`); grade corrections by `supersedes_id`; status and record history rows for every write; password sign-in (unknown ID takes no lock and writes no row; the pause per user; the audit cap; `must_change_password` blocks other methods; the epoch ends other sessions; the rehash on sign-in; no password or hash in any response, audit row or log line); the import (every readiness item and issue code against invented rows in the real patterns, the name rule, idempotent re-commit, a commit stopped after one chunk and continued, reconciliation counts).

**Browser tests (Playwright, localhost, mock transport):** at 1280, 768 and 375 pixels, for the five roles: sign in with an employee ID and password; the forced password change; enroll a new person (with the duplicate warning), record five entry grades and see Probationary, record a certification check, certify; extend refused until CFG-047 is set; quit; a Supervisor promotes and an officer has no Promote button and gets `FORBIDDEN` from a direct call; Admin validates, skips a row and commits the import on fake sheets. No console errors and no failed requests.

**Gate G2 is passed when all of these are true:**

1. Every user signs in on TEST and LIVE with an employee ID and password; X-1 is marked ended.
2. Unit and browser tests pass, and every Phase 2 pull request has the Reviewer's `VERDICT: APPROVED`.
3. The import on LIVE shows all 276 source rows as committed or skipped with a reason, and the RESULT and status counts agree.
4. Officers have signed off the persons list and the duplicate decisions in the review sheet.
5. MASTER_LOG in the original legacy sheet is set to read-only by Leo.

## 12. Questions for Leo and decided details

**Answered by Leo on 2026-10-21:**

1. The legacy "CERTFICATION GRADE" is **not** the checklist. It is a requirement and part of the certification validation: it shows that the Team Leader passed the 3-month TL course program. → P2-13, §5, §7.4, §7.5, §10.5.
2. **Yes**, Admin also does the officer actions. → P2-6, §6. Promotion and return to probation stay with Supervisor and higher.
3. **OK**: Admin sets the extension limit (CFG-047) and the quit reasons (CFG-018) in the app before the first extension and the first quit; no code change is needed.

5. The passing grade of the TL course program is **90**. It is seeded as TLMI-001; Admin can change it on the Settings screen (a new version, as for every setting).

**Decided in this design (tell the Reviewer if you disagree):** P2-13 takes your answer 1 as a recorded requirement outside the final grade formula, with the pass mark TLMI-001 = 90 (answer 5); P2-2 (probation starts with the last entry grade), P2-3 (return to probation only from Certification check and Extended), P2-4 (one feedback form counts alone), P2-5 (rounding), P2-10 (backup date at commit), P2-12 (CEBU TL tab is a view of MASTER_LOG); no e-mail reset (§4.3); uniforms and appointment letters are imported in Phase 3.
