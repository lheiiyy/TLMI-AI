# STATUS

**Phase:** 1, core data, sign-in and audit log (gate G1). Phase 0 gate G0 (rules signed off) is passed.
**Last updated:** 2026-10-20

## Done

- Project plan approved ([docs/PLAN.md](PLAN.md)).
- G0 decisions adopted from TDMS on 2026-10-19 ([docs/DECISIONS.md](DECISIONS.md)).
- Repository scaffold merged (pull request #1).
- Phase 1 design: [specs/2026-10-19-phase-1-core-data-design.md](../specs/2026-10-19-phase-1-core-data-design.md), with Leo's answers of 2026-10-19 (brand code `AP`, officers from `SEED_OFFICERS`, Admin-only edits of stores, Admin delete later in v1).
- Phase 1 build plan: [plans/2026-10-20-phase-1-build-plan.md](../plans/2026-10-20-phase-1-build-plan.md), 14 tasks.
- Build pipeline in [CLAUDE.md](../CLAUDE.md); working agreement in [docs/COLLABORATION.md](COLLABORATION.md) (Code builds, the reviewer checks).
- Legacy data profile: [migration/LEGACY-DATA-PROFILE.md](../migration/LEGACY-DATA-PROFILE.md).
- Spreadsheets created by the reviewer in one Drive folder, "TLMI-AI": a dated copy of the legacy sheet with a `SEED_OFFICERS` tab, `TLMI_DB_DEV`, `TLMI_DB_TEST`, `TLMI_IMPORT_REVIEW_TEST`. IDs are not in the repo; Leo puts them in Script Properties.

## Next

- Leo merges the spec, plan and working-agreement pull request.
- Code builds Phase 1 from the plan in four pull requests: A (tasks 1 to 5, foundation), B (tasks 6 and 7, API and master data), C (tasks 8 to 10, seed and import review), D (tasks 11 to 14, setup, UI, tooling).
- The reviewer checks each pull request on GitHub.
- Settle the extension limit (CFG-047) and the probation start in TDMS before gate G2.

## Blockers and open items

- Open items are listed in [docs/DECISIONS.md](DECISIONS.md) and in spec §12.
- No app code exists yet.
- Interim exception X-1: Phase 1 sign-in is a name list plus an Admin PIN. Password sign-in is the first task of Phase 2, before any Team Leader record is loaded.
- `clasp` login, the DEV and TEST script projects and the Script Properties are set up by Leo once (see the setup guide that task 14 produces).
