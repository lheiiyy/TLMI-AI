# CLAUDE.md: rules for Claude Code in TLMI-AI

TLMI-AI is the Team Leader Monitoring app (Google Apps Script web app on a Google Sheet database). Full plan: [docs/PLAN.md](docs/PLAN.md).

## Every session

1. Confirm the repository is `lheiiyy/TLMI-AI`. If not, stop.
2. Read this file and [docs/STATUS.md](docs/STATUS.md) before doing anything.
3. At the end, update [docs/STATUS.md](docs/STATUS.md) (done, next, blockers).

## Git rules

- Work on a branch and open a pull request. **Never push to `main`.**
- **Merge only when Leo says so.**
- Small commits, one per file group.
- Never commit `.clasprc.json`, passwords, tokens or sheet IDs. Sheet IDs and the password pepper live in **Script Properties**.
- `clasp` may push to the DEV and TEST script projects only. LIVE is deployed by hand by the owner. Commit before any push.

## Four layers

```
UI (src/client/*.html)
  -> src/client/api.js        one function per action over google.script.run
  -> services (src/server)    TlService, UniformService, ReportService, AuthService
  -> repository (src/server)  the ONLY code that calls SpreadsheetApp
```

- The UI calls only `api.js`. `api.js` calls only server services. Services call only the repository.
- **Only the repository calls `SpreadsheetApp`.** Nothing else touches the sheet.
- Moving to the TDMS full stack must mean rewriting only the repository and the transport inside `api.js`.
- **Every server call checks the caller's role.** Hiding a button is not security.

## Names are TDMS names (do not invent new ones)

Source: lheiiyy/TDMS `docs/DATA-MODEL.md` (§2 IDs, §8) and `docs/API-CONTRACT.md` (§8.9).

| Table | ID prefix | TDMS entity |
| --- | --- | --- |
| `tl_enrollments` | `TLE-2026-0001` | ENT-060 |
| `tl_extensions` | `TLX-` | ENT-061 |
| `tl_certifying_officers` | `TLO-` | ENT-062 |
| `uniform_transactions` | `UNF-` | ENT-063 |
| `assessments` (grades) | `ASM-2026-000001` | ENT-043 |
| `assessment_components` | `CMP-` | ENT-016 |
| `persons` / `person_aliases` | `PER-000001` / `PAL-` | ENT-020 / ENT-021 |
| `locations` (stores) / `stations` | `LOC-0001` / `STN-` | ENT-012 / ENT-014 |
| `brands` / `regions` | `BRD-` / `REG-` | ENT-010 / ENT-011 |
| `users` | `USR-0001` | ENT-024 |
| `lookups` / `settings` / `id_counters` | `LKP-` / `SET-` / none | ENT-003 / ENT-001 / ENT-002 |
| `audit_log` | `AUD-000000` | ENT-117 |
| `status_history`, `record_history` | `HIS-` | ENT-118 |
| `import_batches` / `import_rows` | `IMP-` / `IMR-` | ENT-047 |

`tl_summary` is the one TLMI-only table: a cache rebuilt by a trigger, never migrated.

API names: `tl.list`, `tl.get`, `tl.history`, `tl.enroll`, `tl.recordEntryGrade`, `tl.recordCertCheck`, `tl.certify`, `tl.extend`, `tl.close`, `tl.quit`, `tl.returnToProbation`, `tl.promote`, `tl.uniform.log`.

## Database rules (plan Section 5)

- The data sheet and the code project are separate files. Data tabs hold no formulas, merged cells, colours or summary blocks.
- One tab is one table: snake_case headers and an `id` column filled by the code.
- Links use IDs, never names. One value per cell; lists go to a child table.
- Dates are `yyyy-mm-dd`; timestamps are ISO 8601 UTC; grades are numbers from 0 to 100.
- Fixed choices come from the `lookups` table and appear as dropdowns.
- Every table has `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active`, `row_version`. Deletion is soft only. Every change is written to `audit_log`.
- Saved records are never overwritten: a correction is a new history row (a grade correction is a new `assessments` row with `supersedes_id` and a reason).
- Writes use `LockService` and one batch write. Reads are paged (about 50 rows). Lists are cached. The dashboard reads `tl_summary`, refreshed by a trigger every 15 to 30 minutes.
- Averages, final grades and deadlines are computed on the server, never typed.

## Scope guard

Phase 0 is docs and folder layout only. Do not write app code until a Phase 1 spec in `specs/` is approved by Leo.
