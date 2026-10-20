# Legacy data profile

What the import review (Phase 1) and the legacy import (Phase 2) must expect. Read from a dated copy of "[sys] Team leader Monitoring" on 2026-10-20. The original sheet was not opened by the app. This file holds patterns and value lists only: no person names, no sheet IDs.

## MASTER_LOG

276 data rows (rows 2 to 277), header in row 1, 23 columns. The key today is the full name.

| Col | Header | What it holds |
| --- | --- | --- |
| A | (blank header) | Form timestamp `dd/mm/yyyy hh:mm:ss`; blank on older rows |
| B | Date of Entry | `d MMM yyyy`, for example `14 Nov 2025` |
| C | Batch # | `BATCH 1` to `BATCH 6`, `BATCH 10`, `BATCH 11`, `SPECIAL`, `SPECIAL 5`; blank on a few rows |
| D | Mother Store | Store name, upper case |
| E | Full name | Free text; some entries carry a middle name or initial |
| F | Mother Station | `FOOD PREP`, `PIZZA MAKER`, `CASHIER`, `SERVICE`, `COMMIS`, `DOUGH MAKER`; `FOOD PREP*` and `PIZZA MAKER*` carry an asterisk with no written meaning; blank on a few rows |
| G | SUPPORT STORE | Mostly blank; when present a store name, or the word `NONE` |
| H | RESULT | The status: `CERTIFIED`, `PROMOTION`, `QUIT`, `EXTENDED`, `PROBATIONARY`, `FAILED`, `DISQUALIFIED` |
| I | Uniform Release | Text such as `2 MEDIUM`, `3 SMALL \| 1 LARGE`, `2 XLARGE \| 1 LARGE` |
| J | ENTRY BY | Officer first name; often blank |
| K to O | ISTV GRADE, TECHVAL FP, TECHVAL PM, TL-ENTRY FOOD PREP EXAM, TL-ENTRY PIZZA MAKER EXAM | Percent text such as `95%`; blank on older rows |
| P | TL ENTRY AVERAGE | Percent text; typed, not computed |
| Q | CERTIFICATION DEADLINE | Blank on most rows. Two formats: `5 Aug 2026` and `23/12/2026 08:00:00` |
| R | CERT BY: | Officer name, see below |
| S | DATE CERTIFIED | `dd/mm/yyyy`; blank when not certified |
| T, U, V | CERTFICATION  GRADE, EXAM GRADE, AVERAGE | Percent text; blank on older rows |
| W | STATUS | Mixed meaning, see below |

Values that look wrong and must go to the review list, not be fixed silently:

- Dates are always day first (`23/12/2026`, `25/02/2026`). A date that is in the future or earlier than the entry date may be a day and month swap; propose, do not apply.
- Grades appear as `95%`. Values such as `9475%` (probably 94.75) and the date `30 Dec 1899` (a zero date) appear in grade columns.
- Header names contain stray double spaces and trailing spaces (`CERTFICATION  GRADE`, `TL ENTRY AVERAGE `, `Batch # `). Match headers after trimming and collapsing spaces.

### CERT BY: (column R)

- A first name or nickname, with variants: trailing spaces, a long form of the same name, and three spellings of one officer.
- Two officers in one cell, separated by `|`.
- Notes typed into the column: `NO CERT`, `RESIGNED`, an extension note, and a note with a date and the word quit.
- Two short names do not match any officer in the seeded officer list. Leave them unmapped for the review list.
- Map a short name to a user only when exactly one seeded officer starts with that name; otherwise it is a candidate, not a match.

### STATUS (column W)

- Report flags: `FOR REPORTING`, `NEW ENTRY`.
- Appointment letter values: `SIGNED`, `AGENCY`, `ON-GOING PROMOTION`.
- `RESIGNED` on a few rows, and one stray numeric value.
- Blank on about half the rows.

### Status mapping

| Legacy RESULT | TLMI status | Note |
| --- | --- | --- |
| CERTIFIED | Certified | |
| PROMOTION | Promoted | |
| QUIT | Quit | |
| EXTENDED | Extended | |
| PROBATIONARY | Probationary | |
| FAILED | Failed | |
| DISQUALIFIED | Failed | close reason `Disqualified` (DECISIONS item 4) |

## SETTINGS tab (store and region)

No header row. Column A is the store name (some with a trailing space), column B the region. Only 35 stores are listed, all in NCR. MASTER_LOG uses many more stores (provincial stores such as those used as mother or support store). After the seed, every store name in MASTER_LOG that is not in the master list appears in `name_mapping` with status `none`; Admin adds the store and chooses its region. Do not guess a region.

## UNIFORM_LOG

Header: `Timestamp`, `TL Key`, `Full Name`, `Mother Store`, `Size`, `Quantity`, `DR #`, `Given By`, `Notes`. One row per issue, from 28 Sep 2026. `TL Key` is `NAME||STORE||yyyy-mm-dd` (the entry date in ISO form). Sizes are words (`XSMALL`, `SMALL`, `MEDIUM`, `LARGE`, `XLARGE`). `DR #` is often blank. `Given By` is a first name or `N/A`; one spelling variant of an officer appears here too.

## SEED_OFFICERS (added to the copy)

A tab of 12 officers copied from the officer list of the TOIS database: `display_name`, `role`, `hr_employee_no`, `is_active`. E-mail addresses were not copied. Role is `Training Officer` for all except the project owner, who is `Admin`. Admin assigns Supervisor, Manager and Senior Training Manager roles in the app.

## Open questions this profile cannot answer

Already in [docs/DECISIONS.md](../docs/DECISIONS.md): the meaning of the asterisk on stations, whether CEBU TL is a separate list, which uniform items are tracked. New from this profile: whether `NONE` in SUPPORT STORE means no support store (assumed yes, shown in the review list), and what the stray numeric STATUS value is (shown in `bad_values`).
