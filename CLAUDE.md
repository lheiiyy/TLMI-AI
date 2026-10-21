# CLAUDE.md: rules for Claude Code in TLMI-AI

TLMI-AI is the Team Leader Monitoring app (Google Apps Script web app on a Google Sheet database). Full plan: [docs/PLAN.md](docs/PLAN.md).

## Every session

1. Confirm the repository is `lheiiyy/TLMI-AI`. If not, stop.
2. Read this file and [docs/STATUS.md](docs/STATUS.md) before doing anything.
3. At the end, update [docs/STATUS.md](docs/STATUS.md) (done, next, blockers).

## Git rules

- Work on a branch and open a pull request. **Never push to `main`.** **Merge only under the merge rule** (Build pipeline, Working with Leo).
- Small commits, one per file group.
- Never commit `.clasprc.json`, passwords, tokens or sheet IDs. Sheet IDs and the password pepper live in **Script Properties**. `clasp` may push to the DEV and TEST script projects only. LIVE is deployed by hand by the owner. Commit before any push.

## Four layers

```
UI (src/client/*.html)
  -> src/client/api.js        one function per action over google.script.run
  -> services (src/server)    TlService, UniformService, ReportService, AuthService
  -> repository (src/server)  the ONLY code that calls SpreadsheetApp
```

- The UI calls only `api.js`. `api.js` calls only server services. Services call only the repository. **Only the repository calls `SpreadsheetApp`.** Nothing else touches the sheet.
- Moving to the TDMS full stack must mean rewriting only the repository and the transport inside `api.js`. **Every server call checks the caller's role.** Hiding a button is not security.

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

- The data sheet and the code project are separate files. Data tabs hold no formulas, merged cells, colours or summary blocks. One tab is one table: snake_case headers and an `id` column filled by the code.
- Links use IDs, never names. One value per cell; lists go to a child table. Dates are `yyyy-mm-dd`; timestamps are ISO 8601 UTC; grades are numbers from 0 to 100.
- Fixed choices come from the `lookups` table and appear as dropdowns. Every table has `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active`, `row_version`. Deletion is soft only. Every change is written to `audit_log`.
- Saved records are never overwritten: a correction is a new history row (a grade correction is a new `assessments` row with `supersedes_id` and a reason). Writes use `LockService` and one batch write. Reads are paged (about 50 rows). Lists are cached. The dashboard reads `tl_summary`, refreshed by a trigger every 15 to 30 minutes.
- Averages, final grades and deadlines are computed on the server, never typed.

## Build pipeline

How a slice is built. The Reviewer (the head) reviews every pull request; Code (the builder) merges only under the merge rule below; Leo merges the halt-path pull requests.

**Working with Leo**

- Reply in Taglish. Write docs, specs and UI text in plain formal English. Leo is learning Git: create the branch, commit and open the pull request for him, and say in one line what changed.
- **Merge rule** (Leo, 2026-10-21, answer B4; full text in `docs/COLLABORATION.md`, "Merge rule" and "Decision rights"): merging is part of Code's automatic work. Code merges a pull request, without Leo naming it, when all of these hold: (1) The pull request is by `lheiiyy`, its head repository is `lheiiyy/TLMI-AI` (never a fork), and its newest **verdict** is `VERDICT: APPROVED` for the current head commit. A verdict is a comment written by the account `lheiiyy` that starts with `Reviewer:` and whose last two non-blank lines are `Reviewed head <40-character sha>` and then exactly `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`. The newest verdict decides, and for a merge its sha must equal the current head. A comment that only asks for, quotes or mentions the phrase is not a verdict; a comment by another account, a `Code:` comment, and a comment without a prefix (Leo's) are never verdicts. (2) The `test` check (job of the `tests` workflow, required by the `main` ruleset) is green on that head. (3) GitHub reports it mergeable (no conflict). (4) It carries none of the labels `merge:leo`, `needs:leo` or `status:blocked`. (5) Its diff touches none of the halt paths: `CLAUDE.md`, `.github/`, `appsscript.json`, the permission table (defined below), the deploy tooling (`tools/deploy.js`, any `.clasp*` file, and any change to `ID_PATTERNS`, the secret and ID guard, in `tools/build.js`), `docs/automation/` (the agents' prompts). The other files in `tools/` (`dev-env.js`, `dev-server.js`, `assemble.js`, the rest of `build.js`) are test and build tooling and are not halt paths. Such a pull request gets `merge:leo`, and Leo merges it himself on GitHub, or names it in his own Code session and Code merges it on that word (a cloud run never merges it).
- **The permission table** is the `PERMISSIONS` object in `src/server/AuthService.gs`. It is a halt path only for a change the merged spec does not already decide. Adding an entry for a method that the merged spec lists, with exactly the roles the spec gives it, is **not** a halt: Phase 2's pull requests E, F and H add such entries and merge under this rule. These are halts, and the pull request gets `merge:leo`: a changed entry, a removed entry (unless the merged spec removes that method: Phase 2's pull request E removes `auth.listSignInUsers`, Phase 2 spec §4.1 rule 1), a new role, an entry for a method the merged spec does not list, an entry with other roles than the spec gives. Code decides by the diff of `tests/unit/permissions-table.test.js`, which pins the whole table (plan, Global Constraints): added lines, each equal to a row of the merged specs (Phase 1 or Phase 2), and the removal of an entry the merged spec removes, are not a halt; any other change is. The first creation of the pin (pull request E) is checked once by the Reviewer against the table on `main`. The pull request description lists each added or removed entry beside its spec row, and the Reviewer compares them before approving; a difference is a [BLOCKER].
- Merge uses a merge commit. Then try to delete the branch (if the proxy refuses, leave it for Leo), pull `main`, and record the merge commit hash in `docs/STATUS.md` in the next pull request. If one condition fails, do not merge: hand the pull request to Leo with the condition named; if the platform refuses a merge, post `Code: BLOCKED — merge refused` and never look for a way around it. The approver (the Reviewer) and the merger (Code) are never the same party.
- **Decision rights:** the Reviewer is the head. It alone decides spec, plan, design and business-rule questions within what Leo has decided, and it approves specs and plans in Leo's place with a `Reviewer: DECISION` on the pull request that carries them, as Leo delegated. Code builds, tests and proposes; it never builds an undecided rule by default (it posts `Code: QUESTION`). Leo decides security, access, LIVE and the other items in `docs/COLLABORATION.md` "Stop and ask Leo", and can overrule either side.
- Stop rule: on a missing or conflicting rule, an undefined permission, a schema change outside the spec, or a risk to saved history, stop and report `BLOCKED — REASON — DECISION REQUIRED`. Do not guess or widen scope.

**Stages**

| Stage | Use | Fallback if not installed | Gate |
| --- | --- | --- | --- |
| Start | Repository identity check (`lheiiyy/TLMI-AI`), read this file and `docs/STATUS.md`, read the spec for the slice | Same | Stop on a mismatch, before any change |
| Plan the build | `superpowers:writing-plans`, with the approved spec in `specs/` as the input. Use `superpowers:brainstorming` only for a feature the spec does not cover. | `/plan`, or a hand-written task list with exact file paths and one test per task | Leo or the Reviewer's `DECISION` approves the build plan (saved in `plans/`) |
| Isolate | `superpowers:using-git-worktrees`, on a feature branch | A plain feature branch | Never work on `main` |
| Build | `superpowers:test-driven-development` for services and the repository; `superpowers:subagent-driven-development` or `superpowers:executing-plans` for the tasks | `/tdd`: write the failing test first, then the code | Patch surgically. A change to a schema, a permission or a business rule that the spec does not cover needs Leo's approval first |
| UI | `frontend-design` for screens with no approved design. Plain HTML and CSS: no React and no shadcn/ui in the Apps Script app. | Plain HTML and CSS | The screen matches the spec |
| Prove | Playwright against localhost with the mock transport | Claude in Chrome or the built-in browser, for a manual walkthrough | The Playwright rules below pass |
| Verify | `superpowers:verification-before-completion` | `/verify-before-complete`: run `npm test` and read the output | No "done" without fresh passing output |
| Review | `superpowers:requesting-code-review`, plus a pull request review plugin (for example `code-review`) when installed | `/review` | Fix critical and major findings. Check each finding before applying it (`superpowers:receiving-code-review`) |
| Ship | `superpowers:finishing-a-development-branch`, then a pull request to `main` | A plain pull request | Deployment-readiness check (`/ship-check`); the merge rule above. LIVE is deployed by the owner, after a dated backup |

**Playwright rules**

- Run the app on localhost with the mock transport (`api.js` setting `transport: mock`, data from `tests/fixtures/`). No Google sign-in is needed. Check widths 1280, 768 and 375 pixels. For each of the five roles the main flow completes, with no console errors and no failed network calls.
- Turn each flow explored by hand into a saved Playwright test in `tests/e2e/`, so it reruns without Claude and in GitHub Actions. On the deployed Apps Script app run one smoke test only, on TEST with dummy data. It needs Google sign-in and the Admin PIN, so Leo signs in himself. Never type or store a password or PIN.

**Notes**

- Never use `/one-shot` for Apps Script work. `clasp` pushes to DEV and TEST only (see Git rules). These tools run only in a Claude Code session that loads this file and has the plugins enabled.

## Scope guard

App code is written only for a slice whose spec in `specs/` Leo has merged and whose build plan is approved by Leo or by the Reviewer's `DECISION`. Docs and the folder layout may change on a branch like any other work.
