# TLMI Business Rules (subset of TDMS)

Each rule cites its TDMS ID. Text is a summary; the TDMS file `docs/BUSINESS-RULES.md` and `docs/WORKFLOWS.md` (WF-002) are the source. If they differ, TDMS wins and this file is corrected.

| ID | Rule | TDMS reference |
| --- | --- | --- |
| RULE-100 | Enrollment is for an existing person, linked by person ID. One open enrollment per person. Deadline = entry date + probation period (default 3 months, Admin setting). | RULE-100, CFG-040, WF-002 #1 |
| RULE-101 | All required entry grades (default five) are recorded before the certification check. | RULE-101, D064, WF-002 #3 |
| RULE-102 | Certification needs the checklist grade, the exam grade and at least one feedback score. Final = 0.30 x checklist + 0.40 x exam + 0.30 x feedback; feedback = 0.60 x kitchen + 0.40 x manager; pass mark 85. Weights and mark are saved at certification. Formula not yet confirmed by Leo. | RULE-102, CFG-044, D008, D053 |
| RULE-103 | The officer, or a Supervisor or higher, certifies, extends or closes. No approval step. | RULE-103, D067 |
| RULE-104 | Extend: deadline moves by the extension length (default 30 days); a numbered extension row records old deadline, new deadline and reason; the record returns to the certification check. Blocked until the extension limit is set. | RULE-104, CFG-047 |
| RULE-105 | Quit is allowed at any open stage with a date and a reason from the Admin list. It closes as Quit, not Failed, cancels the open TLTC plan, and allows re-enrollment. | RULE-105, D068, CFG-018 |
| RULE-106 | Only a Certified Team Leader can be Promoted, and only by a Supervisor or higher. Admin promotion is blocked until TDMS decides. | RULE-106, D031, AMB-02 |
| RULE-107 | Every change is a dated history row (old value, new value, user, time). Extensions are numbered. Averages are computed, never typed. Several certifying officers are stored one per row. | RULE-107, D048 |
| RULE-108 | Uniforms: one row per transaction (issue, return, receive) with item, size, quantity, DR number, date and user. A repeated DR number, item and size shows a warning. | RULE-108, D072 |
| RULE-109 | An enrollment with no officer, visit or certification by its deadline goes to the supervisor queue and the daily digest. A deadline within 14 days shows on the dashboard; a passed deadline shows red. | RULE-109, WF-002 notifications |

## Status flow (TDMS WF-002)

States: Entry, Probationary, Certification check, Certified, Extended, Failed, Quit, Promoted. Closed: Certified (until Promoted), Failed, Quit, Promoted.

1. Enroll -> Entry (Training Officer or Supervisor).
2. Entry -> Probationary.
3. Probationary -> Certification check (all entry grades saved).
4. Certification check -> Certified (final at or above the pass mark).
5. Certification check -> Extended -> Certification check (below the pass mark).
6. Certification check -> Failed.
7. Any open stage -> Quit.
8. Certified -> Promoted (Supervisor or higher).
9. Return to Probationary (Supervisor or higher, with a note); allowed source states are open in TDMS.

Prohibited (WF-002): skipping a stage; certifying without all entry grades, checklist, exam and one feedback score; promoting a non-Certified Team Leader; promotion by an officer; an approval step for certify, extend or close; recording Quit as Failed; two open enrollments for one person; typed averages; overwriting history; linking by name.

## Roles (TDMS)

| Role | Access | TDMS reference |
| --- | --- | --- |
| Training Officer | Enroll, record grades, certify, extend, close, quit, uniforms | PERM-030 to 032, 035 |
| Training Supervisor | All officer actions, return to probation, promote | PERM-033, 034 |
| Training Manager, Senior Training Manager | Same as Supervisor | PERM-030 to 035 |
| Admin | Settings, users, lists, legacy import, corrections, audit log | API-CONTRACT 8.9 |
| Store Head, Area Manager | No access to Team Leader records | API-CONTRACT 8.9 (`tl.list`) |
