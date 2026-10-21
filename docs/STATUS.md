# STATUS

**Phase:** 1, core data, sign-in and audit log (gate G1). Phase 0 gate G0 (rules signed off) is passed.
**Last updated:** 2026-10-21

## Done

- Project plan approved ([docs/PLAN.md](PLAN.md)).
- G0 decisions adopted from TDMS on 2026-10-19 ([docs/DECISIONS.md](DECISIONS.md)).
- Repository scaffold merged (pull request #1).
- Phase 1 design: [specs/2026-10-19-phase-1-core-data-design.md](../specs/2026-10-19-phase-1-core-data-design.md), with Leo's answers of 2026-10-19 (brand code `AP`, officers from `SEED_OFFICERS`, Admin-only edits of stores, Admin delete later in v1).
- Phase 1 build plan: [plans/2026-10-20-phase-1-build-plan.md](../plans/2026-10-20-phase-1-build-plan.md), 14 tasks.
- Build pipeline in [CLAUDE.md](../CLAUDE.md); working agreement in [docs/COLLABORATION.md](COLLABORATION.md) (Code builds, the reviewer checks).
- Legacy data profile: [migration/LEGACY-DATA-PROFILE.md](../migration/LEGACY-DATA-PROFILE.md).
- Spec, plan and working-agreement pull request merged (#3, merge commit f1e8902).
- Phase 1 pull request A merged (#4, merge commit 56736d1): test harness, platform adapters, validator, schema, repository, audit service.
- Phase 1 pull request B merged (#5, merge commit c1e8cce): API entry, interim sign-in, permission table, master data, settings, users.
- Phase 1 pull request C merged (#6, merge commit f1d54b1): seed, import rules, import review dry run.
- Phase 1 pull request D merged (#7, merge commit ec4753a): setup functions with the editor guard, dev server and sign-in, home and Admin screens, deploy tool, setup guide, G1 checklist, CI. All four Phase 1 pull requests (#4 to #7) are merged; the reviewer approved each one.
- STATUS pull request merged (#8, merge commit 78ab694). Browser test stability (issue #13): the sign-in screen showed its name list empty for a moment, and the test `lists active officers` read it too early; `fresh()` now waits for the names, and a test with a slow list keeps it from coming back.
- Spreadsheets created by the reviewer in one Drive folder, "TLMI-AI": a dated copy of the legacy sheet with a `SEED_OFFICERS` tab, `TLMI_DB_DEV`, `TLMI_DB_TEST`, `TLMI_IMPORT_REVIEW_TEST`. IDs are not in the repo; Leo puts them in Script Properties.
- Phase 2 spec, build plan and working agreement merged (#9, merge commit b4fbf88; the Reviewer's DECISION approves the build plan in Leo's place). Automation audit and the two task prompts merged (#10, merge commit 45ae807, on Leo's word). STATUS pull request merged (#8, merge commit 78ab694). `CLAUDE.md` follows the new merge rule (issue #12).

## Next

- Leo does the one-time setup on DEV and TEST in [docs/SETUP.md](SETUP.md) and runs the gate G1 checks in [docs/G1-CHECKLIST.md](G1-CHECKLIST.md). Phase 1 is complete in code; gate G1 is closed only after those checks, and after the timing from `measureHash` and the number format `0.######` have been looked at on TEST.
- Phase 2 pull request E (part 2A, tasks 1 to 7: Employee ID and password sign-in, per-user pause, session epochs, temporary passwords, `initFirstAdmin` and `initAdminPassword`, sign-in, change-password and Users screens) is built and waits for the Reviewer. Next: pull request F (tasks 8 to 12), then G and H, each from an updated `main`. Do not deploy: the `users` tab of an existing database needs four new columns first ([docs/SETUP.md](SETUP.md) section 3).
- Admin sets the extension limit (CFG-047) and the quit reasons (CFG-018) in the app before the first extension and the first quit. Settle the probation start in TDMS before gate G2 (interim X-2).

## Blockers and open items

- Open items are listed in [docs/DECISIONS.md](DECISIONS.md) and in spec §12.
- App code: the whole Phase 1 server, the client (sign-in, master lists, Admin screens) and the tools. 310 unit tests and 59 browser tests pass. Nothing is deployed yet.
- Branch `docs/scaffold` and the other merged branches could not be deleted from the Code session (the proxy refuses branch deletion); Leo can delete them on GitHub.
- Interim exception X-1 (name list plus Admin PIN) is ended in code by Phase 2 part 2A (pull request E). It is marked ended in `docs/DECISIONS.md` when 2A is deployed to TEST; Leo records the date. No real Team Leader record is loaded before that.
- `clasp` login, the DEV and TEST script projects and the Script Properties are set up by Leo once (see [docs/SETUP.md](SETUP.md)).
