# TLMI Data Model (subset of TDMS)

Table names, columns and ID prefixes follow lheiiyy/TDMS `docs/DATA-MODEL.md` (§2 ID registry, §8 Team Leader) so the merge into TDMS PH-12 is a straight copy. The database is the `TLMI_DB` sheet: one tab per table.

## Rules for every table (TDMS §1)

- IDs are server-generated, prefixed, never reused, never typed (P1). Counters live in `id_counters`, allocated under lock (§2). The year digits come from the record date.
- Links use IDs only (P2). History-bearing records are never overwritten (P3).
- Record profiles (§1.1): **MUT** mutable (`id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active`, `row_version`), **APP** append-only (`id`, `created_at`, `created_by`), **VER** versioned config (APP plus `effective_from`, `supersedes_id`).
- Dates `yyyy-mm-dd`, timestamps ISO 8601 UTC (P9). No formulas or merged cells (P7).

## Tables

| Module | Table | ID | Profile | Key columns | TDMS reference |
| --- | --- | --- | --- | --- | --- |
| M1 | `brands` | `BRD-` | MUT | name, code | ENT-010 |
| M1 | `regions` | `REG-` | MUT | name | ENT-011 |
| M1 | `locations` (stores) | `LOC-0001` | MUT | store_name, location_type, brand_id, region_id | ENT-012 |
| M1 | `stations` | `STN-` | MUT | name, brand_id | ENT-014 |
| M1 | `lookups` | `LKP-` | MUT | category, value, label, sort_order | ENT-003 |
| M1 | `assessment_components` | `CMP-` | MUT | name, stage, required, weight | ENT-016 |
| M1 | `settings` | `SET-` | VER | key, value, version | ENT-001 |
| M1 | `users` | `USR-0001` | MUT | hr_employee_no, display_name, role, password_hash, salt | ENT-024, D024, AD-10 |
| M2 | `persons` | `PER-000001` | MUT | last_name, first_name, middle_name, hr_employee_no | ENT-020 |
| M2 | `person_aliases` | `PAL-` | APP | person_id, alias | ENT-021 |
| M2 | `tl_enrollments` | `TLE-2026-0001` | MUT | person_id, mother_location_id, support_location_id, station_id, batch_code, entry_date, deadline, status, close_reason_id, certified_on, final_grade, pass_mark_used, weights_version, visit_report_url, appointment_letter_status, remarks | ENT-060 |
| M3 | `assessments` | `ASM-2026-000001` | APP | subject_type (TL_ENROLLMENT), subject_id, component_id, score, assessed_on, assessed_by, supersedes_id, correction_reason | ENT-043, D072 |
| M3 | `tl_extensions` | `TLX-` | APP | tl_enrollment_id, extension_no, old_deadline, new_deadline, reason | ENT-061 |
| M3 | `tl_certifying_officers` | `TLO-` | APP | tl_enrollment_id, user_id | ENT-062 |
| M4 | `uniform_transactions` | `UNF-` | APP | tl_enrollment_id, type (receive, issue, return), item, size, qty, dr_no, txn_date, user_id | ENT-063, D072 |
| M6 | `tl_summary` | none | cache | store, status, batch, count, refreshed_at | TLMI only; rebuilt by trigger, not migrated |
| M7 | `status_history`, `record_history` | `HIS-` | APP | entity, entity_id, field, old_value, new_value, user_id, at | ENT-118, D048 |
| M7 | `audit_log` | `AUD-000000` | APP | action, entity, user_id, at | ENT-117 |
| M7 | `import_batches`, `import_rows` | `IMP-`, `IMR-` | MUT / APP | source row, raw values, mapped IDs, issues | ENT-047 |
| M7 | `id_counters` | none | SYS | prefix, year, last_no | ENT-002 |

TL History (every status, grade, deadline, extension, officer, store, station, uniform and remark change) is a view over `status_history` and `record_history`, not a table (ENT-064, D048).

## Notes

- A grade is never edited. A correction is a new `assessments` row linked by `supersedes_id` with a required reason; the latest row in the chain counts (ENT-043, D072).
- Stock on hand by size is computed as received minus issued plus returned. A repeated DR number, item and size warns, it does not block (ENT-063, D072).
- Legacy final grades are kept as legacy values because legacy records have no feedback score and cannot be recomputed (D053).
- Re-enrollment is a new `tl_enrollments` row for the same `person_id` (RULE-100).
