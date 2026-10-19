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

## Build pipeline

How a slice is built. Leo reviews every pull request. The builder never merges on its own.

**Working with Leo**

- Reply in Taglish. Write docs, specs and UI text in plain formal English.
- Leo is learning Git: create the branch, commit and open the pull request for him, and say in one line what changed.
- Merge a pull request only after Leo writes in the session, naming it (for example "OK i-merge #3"). A general OK is not a merge order. Then use a merge commit, delete the branch, pull `main` and report the merge commit hash.
- Stop rule: on a missing or conflicting rule, an undefined permission, a schema change outside the spec, or a risk to saved history, stop and report `BLOCKED — REASON — DECISION REQUIRED`. Do not guess or widen scope.

**Stages**

| Stage | Use | Fallback if not installed | Gate |
| --- | --- | --- | --- |
| Start | Repository identity check (`lheiiyy/TLMI-AI`), read this file and `docs/STATUS.md`, read the spec for the slice | Same | Stop on a mismatch, before any change |
| Plan the build | `superpowers:writing-plans`, with the approved spec in `specs/` as the input. Use `superpowers:brainstorming` only for a feature the spec does not cover. | `/plan`, or a hand-written task list with exact file paths and one test per task | Leo approves the build plan (saved in `plans/`) |
| Isolate | `superpowers:using-git-worktrees`, on a feature branch | A plain feature branch | Never work on `main` |
| Build | `superpowers:test-driven-development` for services and the repository; `superpowers:subagent-driven-development` or `superpowers:executing-plans` for the tasks | `/tdd`: write the failing test first, then the code | Patch surgically. A change to a schema, a permission or a business rule that the spec does not cover needs Leo's approval first |
| UI | `frontend-design` for screens with no approved design. Plain HTML and CSS: no React and no shadcn/ui in the Apps Script app. | Plain HTML and CSS | The screen matches the spec |
| Prove | Playwright against localhost with the mock transport | Claude in Chrome or the built-in browser, for a manual walkthrough | The Playwright rules below pass |
| Verify | `superpowers:verification-before-completion` | `/verify-before-complete`: run `npm test` and read the output | No "done" without fresh passing output |
| Review | `superpowers:requesting-code-review`, plus a pull request review plugin (for example `code-review`) when installed | `/review` | Fix critical and major findings. Check each finding before applying it (`superpowers:receiving-code-review`) |
| Ship | `superpowers:finishing-a-development-branch`, then a pull request to `main` | A plain pull request | Deployment-readiness check (`/ship-check`); Leo approves the merge. LIVE is deployed by the owner, after a dated backup |

**Playwright rules**

- Run the app on localhost with the mock transport (`api.js` setting `transport: mock`, data from `tests/fixtures/`). No Google sign-in is needed.
- Check widths 1280, 768 and 375 pixels. For each of the five roles the main flow completes, with no console errors and no failed network calls.
- Turn each flow explored by hand into a saved Playwright test in `tests/e2e/`, so it reruns without Claude and in GitHub Actions.
- On the deployed Apps Script app run one smoke test only, on TEST with dummy data. It needs Google sign-in and the Admin PIN, so Leo signs in himself. Never type or store a password or PIN.

**Notes**

- Never use `/one-shot` for Apps Script work.
- `clasp` pushes to DEV and TEST only (see Git rules).
- These tools run only in a Claude Code session that loads this file and has the plugins enabled.

## Scope guard

App code is written only for a slice whose spec in `specs/` Leo has merged and whose build plan Leo has approved. Docs and the folder layout may change on a branch like any other work.
