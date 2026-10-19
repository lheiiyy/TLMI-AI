# TLMI-AI Decisions

Gate G0 decisions were closed on **2026-10-19** by adopting the TDMS answer. TLMI does not invent its own. Full TDMS text: lheiiyy/TDMS `docs/DECISIONS.md` and `docs/BUSINESS-RULES.md`.

## Adopted from TDMS (closed 2026-10-19)

| # | Decision | TDMS reference |
| --- | --- | --- |
| 1 | Certification: final = 0.30 x checklist + 0.40 x exam + 0.30 x feedback; feedback = 0.60 x kitchen + 0.40 x manager; pass mark 85. Weights and mark are Admin settings, saved with each certification. | RULE-102, CFG-044, D008 (formula itself unconfirmed: D053) |
| 2 | Extension: default 30 days, numbered extension rows, record returns to the certification check. | RULE-104, WF-002 step 5 |
| 3 | Entry grades: five by default (ISTV, Tech Val Food Prep, Tech Val Pizza Maker, TL entry exam Food Prep, TL entry exam Pizza Maker); list kept by Admin. | D064, RULE-101 |
| 4 | Disqualified is not a state. The 4 legacy Disqualified records import as Failed with the reason "Disqualified". | WF-002 states, D068 |
| 5 | Access: Store Heads and Area Managers have no access to Team Leader records; there is no HR role. | API-CONTRACT 8.9 (`tl.list`: SH/AM never), D002 |
| 6 | Quit closes as Quit, never as Failed; re-enrollment allowed; open TLTC plan cancelled. | D068, RULE-105 |
| 7 | Officers certify, extend and close with no approval step. | D067, RULE-103 |
| 8 | Promotion is done directly by a Supervisor or higher; an officer cannot. | D031, RULE-106 |
| 9 | Sign-in is Employee ID plus password, salted and iterated hash; identity comes only from the app session. | D024, AD-01, AD-10 |
| 10 | History is never overwritten; a grade correction is a new `assessments` row with `supersedes_id` and a required reason. | D048, RULE-107, D072 |
| 11 | Uniform: one row per transaction; a repeated DR number, item and size is a warning, not a block. | RULE-108, D072 (ENT-063) |

## Open in TDMS (TLMI takes the TDMS answer)

| Item | TDMS reference | Interim in TLMI |
| --- | --- | --- |
| Extension limit | CFG-047, CD-11 | Extending is blocked until Admin sets the limit (before gate G2). |
| When probation starts: at enrollment, or when the fifth entry grade is saved | WF-002 step 2, ISS-P1-04 | Not decided; TDMS answer applies. |
| Quit reason list | CFG-018, CD-06 | Admin list; values to be supplied. |
| Feedback when only one of the two forms is returned | RULE-102, D053, CD-26 | At least one feedback score is required; weighting for a single form is open. |
| Whether "higher" than Supervisor includes Admin for promotion | AMB-02, PERM-034 | Promotion stays blocked for Admin. |

## Open, needed for the legacy import only

| Item | TDMS reference |
| --- | --- |
| Meaning of the asterisk on stations such as "FOOD PREP*" | none (legacy sheet only) |
| CEBU TL tab: separate list or regional view of the same Team Leaders | none (legacy sheet only) |
| Which uniform items are tracked: polo shirts only, or more | ENT-063 (`item`) |
| Appointment letter values (SIGNED, AGENCY, ON-GOING PROMOTION) | none (TLMI field `appointment_letter_status`) |
