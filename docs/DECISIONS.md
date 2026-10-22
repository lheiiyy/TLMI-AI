# TLMI-AI Decisions

Gate G0 decisions were closed on **2026-10-19** by adopting the TDMS answer. TLMI does not invent its own. Full TDMS text: lheiiyy/TDMS `docs/DECISIONS.md` and `docs/BUSINESS-RULES.md`.

## Adopted from TDMS (closed 2026-10-19)

| # | Decision | TDMS reference |
| --- | --- | --- |
| 1 | Certification: final = 0.30 x checklist + 0.40 x exam + 0.30 x feedback; feedback = 0.60 x kitchen + 0.40 x manager; pass mark 85. Weights and mark are Admin settings, saved with each certification. | RULE-102, CFG-044, D008. Adopted for TLMI by Leo on 2026-10-19. TDMS still lists it as unconfirmed (D053, CD-26); TLMI does not gate certification on it. |
| 2 | Extension: default 30 days, numbered extension rows, record returns to the certification check. | RULE-104, WF-002 step 5 |
| 3 | Entry grades: five by default (ISTV, Tech Val Food Prep, Tech Val Pizza Maker, TL entry exam Food Prep, TL entry exam Pizza Maker); list kept by Admin. | D064, RULE-101 |
| 4 | Disqualified is not a state. The 4 legacy Disqualified records import as Failed with the reason "Disqualified". | WF-002 states (no Disqualified state); TLMI decision 2026-10-19 |
| 5 | Access: Store Heads and Area Managers have no access to Team Leader records; there is no HR role. | API-CONTRACT 8.9 (`tl.list`: SH/AM never), D002 |
| 6 | Quit closes as Quit, never as Failed; re-enrollment allowed; open TLTC plan cancelled. | D068, RULE-105 |
| 7 | Officers certify, extend and close with no approval step. | D067, RULE-103 |
| 8 | Promotion is done directly by a Supervisor or higher; an officer cannot. | D031, RULE-106 |
| 9 | Sign-in is Employee ID plus password, salted and iterated hash; identity comes only from the app session. | D024, AD-01, AD-10 |
| 10 | History is never overwritten; a grade correction is a new `assessments` row with `supersedes_id` and a required reason. | D048, RULE-107, D072 |
| 11 | Uniform: one row per transaction; a repeated DR number, item and size is a warning, not a block. | RULE-108, D072 (ENT-063) |

## Interim exceptions (TLMI only, time-limited)

| # | Exception | Condition while it applies | Ends | Reference |
| --- | --- | --- | --- | --- |
| X-1 | Phase 1 sign-in uses a name list, plus a PIN for Admin, instead of Employee ID and password (item 9 above; TDMS D024, AD-01, AD-10). Accepted by Leo on 2026-10-19. | `TLMI_DB` holds no Team Leader record. | **Ended in code** by Phase 2 part 2A (pull request E): Employee ID and password sign-in, no name list, no PIN. Marked ended when part 2A is deployed to TEST (Leo records the date: ____). | [Phase 1 design](../specs/2026-10-19-phase-1-core-data-design.md), §6 |
| X-2 | Probation starts when the last required entry grade is saved: the status moves from Entry to Probationary automatically at that moment. The deadline is computed from the entry date in every case. | Until TDMS decides WF-002 step 2. | TDMS decision (PH-12). | [Phase 2 design](../specs/2026-10-21-phase-2-enrollment-certification-design.md) P2-2 |
| X-3 | Return to probation is allowed from Certification check and Extended only, keeps the deadline, and needs a note. | Until TDMS decides WF-002 step 9. | TDMS decision (PH-12). | Phase 2 design P2-3 |
| X-4 | A record in Certification check may be extended when the final grade is below the pass mark **or** the TL course program grade is below TLMI-001 (90). The extension counts against CFG-047 either way. Decided by the Reviewer on 2026-10-21 under Leo's standing instruction. | Until Leo or TDMS decides otherwise. | Leo's word. | Phase 2 design §7.6 |

## Decided by Leo on 2026-10-21 (Phase 2 design, section 12)

| # | Decision | Reference |
| --- | --- | --- |
| P2-13 | The TL course program grade (the legacy column "CERTFICATION GRADE") is a certification requirement, recorded once per enrollment as its own component and not part of the final grade formula. Its pass mark is the TLMI-only setting TLMI-001, seeded at 90. | Phase 2 design P2-13, §7.5 |
| P2-6 | Admin does the officer actions (enroll, update, entry grades, certification check, certify, extend, fail, quit) and reads every Team Leader record. Admin does not promote or return to probation (TDMS PERM-031 and 032 are "?" for Admin: TLMI takes this answer and reports it to TDMS for PH-12). | Phase 2 design P2-6 |
| P2-14 | Admin sets the extension limit (CFG-047) and the quit reasons (CFG-018) in the app; no code change is needed. | Phase 2 design §12, answer 3 |

## Decided by the Reviewer on 2026-10-22 (Phase 2 pull request F)

| # | Decision | Reference |
| --- | --- | --- |
| P2-15 | For CFG-040, CFG-041, CFG-042, CFG-044, CFG-045 and TLMI-001 the version in force on a date is the highest version whose `effective_from` is not after that date; when the date is before the first version, the first version applies (a rule that has never changed applied from the start). The TLMI-001 safety net (a recorded course grade is enough) applies only when the database has no TLMI-001 version at all. CFG-047 is read as "in force today". | Phase 2 design §7.1, §7.5 |
| P2-16 | For RULE-100 only Failed, Quit and Promoted are closed; Certified still blocks a new enrollment until the record is Promoted. `TlRules.OPEN` is unchanged for grading, overdue and the list flag. The import's `OPEN_TWICE` uses the same rule (pull request H). | Phase 2 design §7.1 |
| P2-17 | `tl.update` is allowed in every status and changes only the six fields of §6 (each with a `record_history` row). The entry average is `null` until every required entry grade is in. A grade write does not raise the enrollment's `row_version` unless the status moves; a stale `row_version` is still checked; a second call for the same component needs a `correction_reason`. `tl.list` sorted by `name` runs by last name, first name, middle name, then id. | Phase 2 design §6, §7.2 |

## Known platform limits (TLMI only)

| # | Limit | Mitigation | Reference |
| --- | --- | --- | --- |
| L-1 | Apps Script has no transaction across ranges, so a failed write part-way can leave some tables written. | The script lock is held for the whole commit. Tables are written in a fixed order: `id_counters`, data tables, `record_history`, `audit_log` last. A failure can leave a saved change without its audit row, never an audit row for an unsaved change. An edited row is one write each; appends to one table are one write. | Spec §8; `Repository.commit` |
| L-3 | Every top-level function of the script can be called from the browser with `google.script.run`, and the web app runs as the owner. The editor functions in `Setup.gs` (`setup`, `initSecrets`, `initFirstAdmin`, `initAdminPassword`, `checkConfig`, `measureHash`) would be reachable by anyone who can open the web app. | Each of them starts with `EditorGuard.check()` (`Platform.gs`): it refuses unless the effective user and the active user are the same non-empty account, which is true only in the script editor, and it fails closed. A unit test lists every top-level function in `src/server/*.gs` and fails unless it is `doGet`, `tlmiApi` or starts with that guard, so the rule holds for later phases. The addresses are never logged or returned. | Reviewer finding on PR #7; `Platform.gs`, `Setup.gs` |
| L-4 | A successful sign-in writes `last_login_at` and so raises the `row_version` of the user, so an Admin who has the Users list open can get `CONFLICT` when saving a user who signed in meanwhile. | The Admin reloads the list on `CONFLICT` and saves again. | Phase 2 spec §4.2 item 6 |

Limit L-2 (review sheet): the review tabs are written one after another, each as a single write that never clears the tab first. A failure part-way can leave some tabs new and some old, but every tab is either fully old or fully new and no officer decision is lost; the next run repairs the rest because the row keys are stable. `summary` is written last. An officer who edits a decision during the few seconds of a run may have the edit overwritten, so Admin tells officers before a re-run (to go in `docs/SETUP.md`, Task 14).

## Open for Phase 2 (raised in reviews)

| Item | Why | Planned answer |
| --- | --- | --- |
| ~~Anonymous sign-in calls take the script lock and write a failed-sign-in audit row each.~~ **Closed** by Phase 2 design §4.2: an unknown employee ID takes no lock and writes no row; the pause is counted per user; failed-sign-in audit rows are capped at 50 per user per day. | Reviewer finding on PR #5 (minor). | Done in part 2A (pull request E). |
| The import review does not compare with the hand-kept SUMMARY tab of the legacy copy. | The layout of that tab is not specified, and comparing would need a guess. | Leo or the Reviewer describes the layout; then `summary` gets the difference rows. |

## Open in TDMS (TLMI takes the TDMS answer)

| Item | TDMS reference | Interim in TLMI |
| --- | --- | --- |
| Extension limit | CFG-047, CD-11 | Extending is blocked until Admin sets the limit in the app (Leo, 2026-10-21: no code change needed). |
| When probation starts: at enrollment, or when the fifth entry grade is saved | WF-002 step 2 (§11) | Interim X-2: probation starts when the last required entry grade is saved. |
| Quit reason list | CFG-018, CD-06 | Admin list, set in the app before the first quit (Leo, 2026-10-21); quitting is blocked until it has a value. |
| Feedback when only one of the two forms is returned | RULE-102, D053, CD-26 | At least one feedback score is required; with one form, that score is the feedback part (P2-4). |
| Whether "higher" than Supervisor includes Admin for promotion | AMB-02, PERM-034 | Promotion stays blocked for Admin. |

## Open, needed for the legacy import only

| Item | TDMS reference |
| --- | --- |
| Meaning of the asterisk on stations such as "FOOD PREP*" | none (legacy sheet only) |
| ~~CEBU TL tab: separate list or regional view of the same Team Leaders~~ **Closed** (P2-12): checked on 2026-10-21 against the dated copy, its 8 rows are all in MASTER_LOG with the same columns. It is a regional view and is not imported. | none (legacy sheet only) |
| Which uniform items are tracked: polo shirts only, or more | ENT-063 (`item`) |
| Appointment letter values (SIGNED, AGENCY, ON-GOING PROMOTION) | none (TLMI field `appointment_letter_status`) |
