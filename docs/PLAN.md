# TLMI-AI Project Plan: Team Leader Monitoring

Training and Development Department · 2026-10-19 · @Leorey

## 1. Project description

TLMI-AI (Team Leader Monitoring) is a web app that replaces the "[sys] Team leader Monitoring" spreadsheet for the Angel's Pizza Team Leader program. It is a standalone app now. It uses the TDMS Team Leader rules, IDs and table design so its data moves into TDMS phase PH-12 later without rework.

**Background.** Crew members join the Team Leader program by batch. They complete five entry grades and a three-month probation, then a Team Leader Training and Certification (TLTC) store visit. At that visit they are certified, extended, failed or closed. The MASTER_LOG holds 276 enrollments from Batch 1 (10 Jul 2025) to October 2026: 166 Certified, 29 Promotion, 29 Quit, 23 Probationary, 17 Extended, 8 Failed and 4 Disqualified.

**Problem.**

- The script finds a Team Leader by full name, so a re-enrolled person stops updates with "Duplicate name found".
- One cell holds several values: uniform issues with DR numbers, two certifying officers, extension notes.
- Grades and dates are stored in mixed formats. Some recent grades show as 9475% or 30 Dec 1899.
- The SUMMARY tab is maintained by hand and no longer matches the MASTER_LOG.
- Each extension overwrites the deadline, so the history of extensions is lost.
- Overdue deadlines are not flagged: Team Leaders at Tagum and Butuan with deadlines in May 2026 still show Probationary in October.

**Objectives.**

1. Give every enrollment a system ID (`TLE-2026-0001`) and stop all look-ups by name.
2. Record every status change, grade, extension and uniform issue as a dated history row with the user who made it.
3. Show every open Team Leader whose deadline falls within 14 days, and flag any deadline that passes without a decision.
4. Compute all counts and averages from the records. Remove every hand-kept summary.
5. Give Supervisors and Managers a live view of every Team Leader by store, batch and officer, without opening the sheet.
6. Import the 276 legacy records. Set MASTER_LOG to read-only by the end of Phase 2 and the whole sheet by the end of Phase 4.

**Scope.**

| Area | In v1 | Out of v1 |
| --- | --- | --- |
| Brands | Angel's Pizza | Figaro Coffee, Apex, Tien Ma's, Koobideh Kebab (added later through settings) |
| Lifecycle | Enrollment, entry grades, certification check, certify, extend, fail, quit, promote | Trainee orientation (TDMS) |
| Evidence | Certifying officers, certification date, link to the TLTC visit report PDF | Visit planning and the visit report form (SVMI and TDMS) |
| Uniforms | Issue, return, delivery and stock on hand by size | Uniform purchasing |
| HR | Appointment letter status | Payroll and HRIS records |
| Reports | Dashboard, deadline list, store and batch reports, export to Sheets and PDF | Email digest (Phase 4) |
| AI | None | Any AI feature, pending IT approval of Gemini |

**Users.** TDD Training Officers and Supervisors, the Training Manager, the Senior Training Manager and an Admin. Following TDMS, Store Heads and Area Managers have no access to Team Leader records, and HR is not a role in v1.

## 2. Current tools and lessons

The program runs on one spreadsheet, "[sys] Team leader Monitoring" (link omitted: sheet IDs are not committed), with 16 tabs. The tabs below were read on 19 Oct 2026. The TDMS rules for this program are in [WORKFLOWS.md, WF-002](https://github.com/lheiiyy/TDMS/blob/main/docs/WORKFLOWS.md) and [BUSINESS-RULES.md, RULE-100 to 109](https://github.com/lheiiyy/TDMS/blob/main/docs/BUSINESS-RULES.md).

| Tab | What it tracks | Main issue | What to keep |
| --- | --- | --- | --- |
| MASTER_LOG | One row per enrollment, 276 rows, 23 columns | Full name is the key. Dates appear as "14 Nov 2025" and "23/09/2026 08:00:00". Grades appear as 9475% and 30 Dec 1899. RESULT and STATUS are two status columns; STATUS mixes report flags (FOR REPORTING, NEW ENTRY) with letter states (SIGNED, AGENCY) | The five entry grades, certification grade, exam grade and deadline |
| PROBATIONARY, CERTIFIED, PROMOTED TL, FAILED/QUIT, CEBU TL | Copies of MASTER_LOG rows by status or region | The same record lives in several tabs. Two tabs add their own fields: signed appointment letter, uniform not returned | Appointment letter and uniform return become fields; the tabs become filters |
| Copy of MASTER_LOG | Backup inside the same file | Can be edited by mistake | Dated backups kept outside the live file |
| FORM RESPONSE | Older Google Form intake | Free text: "Probitionary", "2 meduim", "Ap dau" | Replaced by dropdowns |
| SUMMARY | Counts by store, status and uniform size | Kept by hand: 272 total against 276 records, Quit 19 against 29, Certified 152 against 166 | The three views, rebuilt as computed reports |
| UNIFORM_LOG | One row per uniform issue, from 28 Sep 2026 | Keyed by NAME\|\|STORE\|\|DATE; issuer typed by hand | One row per transaction |
| UNIFORM_INVENTORY | Deliveries by size | Empty | The structure |
| SETTINGS | Store to region list | Store names only, some with trailing spaces | Becomes a store table with IDs |
| SCRIPT | Old entry and certification script | Finds the row by name, adds two months per extension, stores typed averages, writes cell by cell | The two main forms: entry and certification |

Other problems found in the records:

- One officer is spelled several ways: CHARLIE, CHARLE, CHARILE; ANN, ANN BARREDO.
- Notes are typed into the officer column: "NO CERT", "RESIGNED", "GIO / 2ND EXTEND", "JAMES 9/29/26 quit".
- Some dates cannot be right. One certification date (24/01/2025) is earlier than its entry date (29 Oct 2025). Another (08/12/2026) is in the future, probably with day and month swapped.
- The asterisk on stations such as "FOOD PREP*" has no written meaning.
- The extension length differs: the script adds two months, while TDMS specifies 30 days.

**Lessons to apply.**

1. Give each person and each enrollment an ID. A re-enrollment is a new enrollment for the same person.
2. Keep one value per cell. Officers, uniforms and extensions go to child tables.
3. Choose stores, stations, officers and statuses from lists. Never type a name.
4. Store dates as yyyy-mm-dd and grades as numbers from 0 to 100. Check them on entry: 0 to 100, and entry date ≤ certification date ≤ today.
5. Keep one status field with a fixed list. Appointment letter status and uniform return are separate fields.
6. Let the server compute averages and deadlines, and save the rule version at certification.
7. Build status views and summaries as filters and reports on one table, never as copies.
8. Put notes in a remarks field, never in a status or officer column.

## 3. Roles and access

Five TDMS roles use the app. Following TDMS, Store Heads and Area Managers have no access to Team Leader records (TDMS tl.list), and HR is not a role. Officers certify, extend and close without an approval step (TDMS D067). Promotion is done directly by a Supervisor or higher (TDMS D031).

| Role | Main use | Create / edit | Decide (no approval step) | View scope |
| --- | --- | --- | --- | --- |
| Training Officer | Enroll Team Leaders, record grades, run certification | Enrollments, entry grades, certification checks, extensions, uniform transactions, appointment letter status | Certify, extend, fail, quit (TDMS D067) | All Angel's Pizza Team Leaders |
| Training Supervisor | Monitor deadlines and officers' work | Everything an officer can | Promote (TDMS D031), return to probation, close items left by a deactivated officer | All |
| Training Manager | Dashboard and reports | Same as Supervisor | Same as Supervisor | All |
| Senior Training Manager | Program results for management | Same as Supervisor | Same as Supervisor | All |
| Admin | Settings, users, data quality | Lists, stores, officers, rule settings, users, legacy import; corrections as new history rows | Soft delete and restore; promotion stays blocked until TDMS AMB-02 is decided | All, plus the audit log |
| Store Head, Area Manager | None in v1 | None | None | No access to Team Leader records |

**Restricted area.** The Admin section (settings, users, import, recycle bin and audit log) is open only to Admin. Every server call checks the role; hiding a button is not treated as security.

**Corrections.** A saved record is never overwritten. A correction by Admin is written as a new history row with the old value, the new value, the user and the time.

## 4. Modules and workflows

The app has seven modules. Modules M1 to M3 replace the daily work in the sheet. M4 to M7 replace the uniform tabs, the status tabs and the hand-kept summary.

| ID | Module | Replaces | Key records | Output |
| --- | --- | --- | --- | --- |
| M1 | Master data | SETTINGS tab, typed store and officer names | Stores, areas, stations, officers, lists | Dropdowns used by every form |
| M2 | Enrollment | INPUT entry form, FORM RESPONSE | Persons, Team Leader enrollments | Team Leader list and record page |
| M3 | Grades and certification | INPUT certification form, grade columns of MASTER_LOG | Grades, certification results, certifying officers, extensions | Certification record with computed final grade |
| M4 | Uniforms | UNIFORM_LOG, UNIFORM_INVENTORY, UNIFORMS, uniform cells | Uniform transactions, deliveries | Stock on hand by size, list of uniforms not returned |
| M5 | HR follow-up | Appointment letter column, STATUS column | Appointment letter status | HR list of certified and promoted Team Leaders |
| M6 | Dashboard and reports | SUMMARY and the five status tabs | Summary table refreshed by a trigger | Counts, deadline list, reports by store, batch and officer, export |
| M7 | Admin and audit | None today | Settings, users, audit log, import log | Audit trail and the legacy import |

**Team Leader status flow.** The states and rules follow TDMS WF-002 and RULE-100 to RULE-109.

**Status flow (8 states, TDMS WF-002).**

1. Entry (entry grades) -> Probationary (3-month deadline).
2. Probationary -> Certification check (TLTC visit).
3. Certification check -> Certified when the final grade is 85 or higher.
4. Certification check -> Extended when below the pass mark; Extended returns to Certification check (+30 days, a setting).
5. Certification check -> Failed (closed with a reason).
6. Any open stage -> Quit (date and reason).
7. Certified -> Promoted (by a Supervisor or higher).
8. Closed states: Certified (until Promoted), Failed, Quit, Promoted.

An extension sends the Team Leader back to the certification check; Failed, Quit and Promoted close the enrollment.

**Rules for each step.**

1. **Enroll.** The officer picks the person, mother store, station, batch and entry date. A person can have only one open enrollment. Deadline = entry date + probation period (default 3 months, an Admin setting).
2. **Entry grades.** Five by default (TDMS D064): ISTV, Tech Val Food Prep, Tech Val Pizza Maker, TL entry exam Food Prep and TL entry exam Pizza Maker. Admin keeps the list. The entry average is computed, never typed.
3. **Probationary.** All required entry grades must be saved before the certification check. When probation starts (at enrollment or when the fifth grade is saved) is still open in TDMS.
4. **Certification check.** At the TLTC visit the officer records the checklist grade, the exam grade and at least one feedback score, plus the date, the certifying officers and the visit report link. The feedback scores come from the existing TLTC forms for kitchen staff and for managers; each has 10 items and totals 100.
5. **Final grade (TDMS RULE-102).** Final = 0.30 × checklist + 0.40 × exam + 0.30 × feedback, where feedback = 0.60 × kitchen + 0.40 × manager. The pass mark is 85. Weights and pass mark are Admin settings and are saved with each certification.
6. **Certify, extend or fail.** A final of 85 or higher moves the record to Certified. Below it, the officer either extends or fails the Team Leader, with no approval step. An extension adds a numbered extension row, moves the deadline by the extension length (default 30 days) and returns the record to the certification check. Extending is blocked until Admin sets the extension limit (TDMS CFG-047).
7. **Quit.** Allowed at any open stage, with a date and a reason from the Admin list. It closes as Quit, never as Failed, and re-enrollment is allowed. Disqualified is not a TDMS state; the 4 legacy Disqualified records are imported as Failed with the reason "Disqualified".
8. **Promote.** Only a Certified Team Leader, and only by a Supervisor or higher.
9. **Alerts.** A deadline within 14 days appears on the dashboard. A deadline that passes with no decision is shown in red and listed for Supervisors.

## 5. Architecture

TLMI runs as a Google Apps Script web app on a separate Google Sheet database, in four layers. Only the repository layer touches the sheet. Moving to the TDMS full-stack app then means rewriting the repository and the transport inside `api.js`, and nothing else.

| Layer | Now (Apps Script and Sheets) | After migration (TDMS full stack) | Must stay the same |
| --- | --- | --- | --- |
| Screens | HtmlService pages, mobile first, same functions on every device | TDMS front end (React or Svelte) | Screen names, fields, validation messages |
| API client (`api.js`) | One function per action over `google.script.run` | The same functions over `fetch` to a REST API | Function names and request and response shapes, using the TDMS names (`tl.enroll`, `tl.recordEntryGrade`, `tl.recordCertCheck`, `tl.certify`, `tl.extend`, `tl.close`, `tl.quit`, `tl.promote`, `tl.uniform.log`) |
| Services | `TlService`, `UniformService`, `ReportService`, `AuthService` | Node.js services | Business rules, status flow, computed values |
| Repository | The only code that calls `SpreadsheetApp` | PostgreSQL through the TDMS repository | Table names, column names, IDs |
| Data | Separate sheet `TLMI_DB`, one tab per table | TDMS schema (`tl_enrollments`, `tl_extensions`, `tl_certifying_officers`, `uniform_transactions`, `assessments`) | IDs and history rows |
| Files | TLTC visit report PDFs stay in Drive; the app stores the file link | File storage | File IDs |
| Sign-in | Employee ID and password, as TDMS AD-01; web app runs as the owner | TDMS sign-in | User IDs |

**Database rules.**

- The data sheet and the code project are separate files. Data tabs hold no formulas, merged cells, colours or summary blocks.
- One tab is one table, with snake_case headers and an `id` column filled by the code (`TLE-2026-0001`).
- Links use IDs, never names. One value per cell; lists go to a child table.
- Dates are `yyyy-mm-dd`, timestamps are ISO 8601 UTC, grades are numbers from 0 to 100.
- Fixed choices come from a `lookups` table and appear as dropdowns.
- Every table has `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active` and `row_version`. Deletion is soft only, and every change is written to `audit_log`.
- The server checks the role on every call.
- Writes use `LockService` and one batch write. Reads are paged at about 50 rows. Lists are cached. The dashboard reads a summary table refreshed by a trigger.

**Platform limits (Apps Script).** A call stops after 6 minutes, so the legacy import runs in chunks. Triggers have daily quotas, so the summary refresh runs every 15 to 30 minutes rather than on every save. Expected volume is small: about 280 enrollments today and a few thousand grade and uniform rows a year, well under the 50,000-row archive point.

## 6. Data model

TLMI uses 22 tables. Names and ID prefixes are taken from the TDMS [DATA-MODEL](https://github.com/lheiiyy/TDMS/blob/main/docs/DATA-MODEL.md) so the merge is a straight copy. The one table TDMS does not have is `tl_summary`, a cache that is rebuilt rather than migrated.

| Module | Table | ID | Key columns | Links to |
| --- | --- | --- | --- | --- |
| M1 | `brands` | `BRD-` | name, code | — |
| M1 | `regions` | `REG-` | name | — |
| M1 | `locations` (stores) | `LOC-` | name, location_type, brand_id, region_id | brands, regions |
| M1 | `stations` | `STN-` | name (Food Prep, Pizza Maker, Cashier, Service, Commis, Dough Maker) | brands |
| M1 | `lookups` | `LKP-` | category, value, label, sort_order | — |
| M1 | `assessment_components` | `CMP-` | name, stage (entry or certification), required, weight; seeded with the five entry grades plus checklist, exam, kitchen feedback and manager feedback | — |
| M1 | `settings` | key | key, value, version (probation months, extension days, extension limit, pass mark, weights) | — |
| M1 | `users` | `USR-` | hr_employee_no, display_name, role, password_hash, salt | persons |
| M2 | `persons` | `PER-` | last_name, first_name, middle_name, hr_employee_no | — |
| M2 | `person_aliases` | `PAL-` | person_id, alias (name variants from the legacy sheet) | persons |
| M2 | `tl_enrollments` | `TLE-` | person_id, mother_location_id, support_location_id, station_id, batch_code, entry_date, deadline, status, close_reason_id, certified_on, final_grade, pass_mark_used, weights_version, visit_report_url, appointment_letter_status, remarks | persons, locations, stations, lookups |
| M3 | `assessments` | `ASM-` | subject_type (TL_ENROLLMENT), subject_id, component_id, score, assessed_on, assessed_by, supersedes_id, correction_reason | tl_enrollments, assessment_components, users |
| M3 | `tl_extensions` | `TLX-` | tl_enrollment_id, extension_no, old_deadline, new_deadline, reason | tl_enrollments |
| M3 | `tl_certifying_officers` | `TLO-` | tl_enrollment_id, user_id | tl_enrollments, users |
| M4 | `uniform_transactions` | `UNF-` | tl_enrollment_id (blank for deliveries), type (receive, issue, return), item, size, qty, dr_no, txn_date, user_id; a repeated DR number, item and size shows a warning, not a block (TDMS D072) | tl_enrollments, users |
| M6 | `tl_summary` | — | store, status, batch, count, refreshed_at | — (rebuilt by trigger) |
| M7 | `status_history`, `record_history` | `HIS-` | entity, entity_id, field, old_value, new_value, user_id, at | any table |
| M7 | `audit_log`, `import_batches`, `import_rows`, `id_counters` | `AUD-`, `IMP-`, `IMR-` | action, entity, user_id, at; source row, raw values, mapped IDs, issues; prefix, year, last_no | any table |

A grade is never edited. A correction is a new `assessments` row that points to the old one through `supersedes_id`, with a required reason. Stock on hand by size is computed as received − issued + returned.

## 7. Roadmap

Version 1 (Phases 0 to 4) takes about 10 weeks (estimate). Core data is built first, then enrollment and certification, which officers use most. The old sheet goes read-only in two steps: MASTER_LOG at gate G2 and the whole file at gate G4.

**Roadmap (6 phases, 6 gates). Week counts are estimates; each gate must pass before the next phase starts.**

1. Phase 0, week 1: setup and decisions (repo, DEV/TEST/LIVE scripts, open decisions closed). Gate G0: rules signed off (pass rule, extension, grade list).
2. Phase 1, weeks 2-3: core data (stores, stations, officers, sign-in, audit log). Gate G1: all roles sign in on TEST; master lists loaded and checked.
3. Phase 2, weeks 4-6: enrollment and certification (enroll, grades, certify, extend, legacy import). Gate G2: 276 records reconciled; MASTER_LOG set to read-only.
4. Phase 3, weeks 7-8: uniforms and HR (uniform stock by size, appointment letters). Gate G3: stock matches a count; uniform tabs set to read-only.
5. Phase 4, weeks 9-10: dashboard and reports (dashboard, deadline alerts, store and batch reports). Gate G4: Manager signs off reports; whole sheet set to read-only.
6. Phase 5, with TDMS PH-12: merge into TDMS (import TLMI data into the TDMS Team Leader module). Gate G5: TDMS reports match TLMI; TLMI set to read-only.

Building happens in Claude Code on short desktop sessions; reviews and pull request checks are done on tablet between them. The week counts assume this pace and will be revised after Phase 1.

## 8. Source control

The private repository [lheiiyy/TLMI-AI](https://github.com/lheiiyy/TLMI-AI) is the master copy of the code and the project record. It is empty today. Code is pushed to Apps Script with `clasp`.

```
TLMI-AI/
  README.md          what the app is and how to deploy it
  CLAUDE.md          rules for Claude Code in this repo
  docs/              PLAN, STATUS, DECISIONS, DATA-MODEL, BUSINESS-RULES
  specs/             one spec per phase or slice
  src/server/        .gs files: services, repository, auth
  src/client/        .html files, including api.js
  migration/         legacy import mapping and review notes
  appsscript.json
```

- **Branches.** `main` is what runs live. Work happens on a feature branch (`feat/m2-enrollment`, `docs/plan`) and merges through a pull request that Leo approves. The builder never merges without his word.
- **Deploy path.** `clasp` may push and create versions on the DEV and TEST script projects only. LIVE is deployed by hand by the owner. A commit must exist before any push, so every deploy can be rolled back.
- **Data files.** DEV, TEST and LIVE each have their own `TLMI_DB` sheet. A dated copy of the LIVE sheet is made before each risky deploy.
- **Secrets.** `.clasprc.json`, passwords, tokens and the database sheet IDs are never committed. Sheet IDs and the password pepper live in Script Properties.
- **Each Claude Code session** starts by confirming the repository and reading `CLAUDE.md` and `docs/STATUS.md`, and ends by updating `docs/STATUS.md`.

## 9. Migration plan

There are two moves: the legacy sheet into TLMI in Phase 2, and TLMI into TDMS in Phase 5. Neither move guesses a value. Anything that cannot be mapped goes to a review list for an officer to confirm.

**Legacy sheet into TLMI (Phase 2)**

1. Save a dated copy of "[sys] Team leader Monitoring" and work only from the copy.
2. Build the person list from MASTER_LOG names. Merge name variants into one person with aliases (for example "DARYL FAYE C. SIASAT" and "DARYL FAYE SIASAT"). A person who appears twice with different entry dates, such as REA RADAM, becomes one person with two enrollments. Officers confirm the list.
3. Map stores, stations and officers to IDs, and correct the spelling variants.
4. Convert dates to `yyyy-mm-dd` and grades to numbers. Rows with impossible values (9475%, 30 Dec 1899, certification before entry) go to the review list.
5. Split each uniform cell into one `uniform_transactions` row per issue, keeping the DR number.
6. Keep typed averages as legacy values, because legacy records have no feedback score and cannot be recomputed with the TDMS formula. Import the 4 Disqualified records as Failed with the reason "Disqualified".
7. Reconcile counts by status against the 276 MASTER_LOG rows. After sign-off, set MASTER_LOG to read-only (gate G2).

**TLMI into TDMS (Phase 5)**

1. When TDMS PH-12 is ready, export the TLMI tables. Table names, columns and IDs already match.
2. Match TLMI persons to TDMS persons by HR employee number; send the rest to the TDMS import review.
3. Import enrollments, grades, extensions, officers, uniforms and history in that order.
4. Run both systems' reports for one month-end close and compare (gate G5).
5. Set TLMI to read-only and point its link to TDMS.

If TDMS moves to its full-stack version (PostgreSQL and a Node.js API) before Phase 5, TLMI follows the same path: the repository layer is rewritten and `api.js` switches to REST, with the screens and services unchanged.

## 10. Risks, decisions needed and next steps

The G0 decisions were closed on 19 Oct 2026 by following the TDMS rules. The largest remaining risk is the feedback score: the TDMS formula needs it, and today it exists only on the paper TLTC feedback forms.

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Kitchen and manager feedback scores are on paper forms and not recorded today | Certifications cannot be computed with the TDMS formula | Officers enter each form's total (out of 100) at the certification check; at least one is required |
| Extending is blocked until the extension limit is set (TDMS CFG-047) | Officers cannot extend on day one | Admin sets the limit before gate G2; TLMI takes the TDMS value once TDMS decides |
| Legacy finals use the old average, not the TDMS formula | Old and new results are not comparable | Legacy finals kept as legacy values and labelled in reports |
| Duplicate persons in the legacy import | Wrong counts; a re-enrollment linked to the wrong history | Alias review step confirmed by officers before gate G2 |
| Officers keep typing into the old sheet | Two sources of truth | Read-only at G2 and G4; one link to TLMI; a short briefing for officers |
| The same module is built twice, in TLMI and in TDMS | Wasted effort | Same rules, table names, IDs and API names; TDMS PH-12 becomes an import |
| Apps Script time limits | Timeouts on reports and import | Paged reads, a summary table, a chunked import |
| Limited desktop time for `clasp` deploys | Slow releases | Batch deploys into one desktop session; reviews on tablet |

**Decisions (gate G0).**

Closed by following TDMS (19 Oct 2026):

- [x] Certification rule (RULE-102): final = 0.30 × checklist + 0.40 × exam + 0.30 × feedback; feedback = 0.60 × kitchen + 0.40 × manager; pass mark 85.
- [x] Extension (RULE-104): default 30 days, numbered extension rows, return to the certification check.
- [x] Entry grades (D064): five by default, list kept by Admin.
- [x] Disqualified: not a TDMS state; legacy records become Failed with the reason "Disqualified".
- [x] Access: Store Heads and Area Managers have no access to Team Leader records; there is no HR role.
- [x] Quit (D068): closes as Quit, never as Failed; re-enrollment allowed.

Still open in TDMS (TLMI takes the TDMS answer):

- [ ] Extension limit (CFG-047).
- [ ] When probation starts: at enrollment or when the fifth entry grade is saved.
- [ ] Quit reason list (CFG-018).
- [ ] How feedback is computed when only one of the two forms is returned.

Needed for the legacy import only:

- [ ] Meaning of the asterisk on stations such as "FOOD PREP*".
- [ ] CEBU TL tab: a separate list or a regional view of the same Team Leaders.
- [ ] Which uniform items are tracked: polo shirts only, or more.
- [ ] Appointment letter values (SIGNED, AGENCY, ON-GOING PROMOTION).

**Next three actions.**

1. Scaffold the repository on a branch (`README.md`, `CLAUDE.md`, `docs/` with this plan and the adopted TDMS rules, and the `src/` layout from Section 8) and open the first pull request.
2. Write the Phase 1 spec (master data, sign-in, audit log) and the legacy import mapping.
3. Settle the extension limit and the probation start in TDMS, so both systems use the same values before gate G2.
