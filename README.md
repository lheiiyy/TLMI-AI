# TLMI-AI

Team Leader Monitoring for the Angel's Pizza Team Leader program (Training and Development Department).

TLMI-AI is a web app that replaces the "[sys] Team leader Monitoring" spreadsheet. It runs as a Google Apps Script web app on a separate Google Sheet database (`TLMI_DB`). It is standalone now and uses the TDMS Team Leader rules, IDs, table names and `tl.*` API names, so its data can move into TDMS phase PH-12 later without rework.

## Status

**Phase 0: setup and decisions.** The project plan is approved. This repository holds docs and folder layout only; there is no app code yet. See [docs/STATUS.md](docs/STATUS.md).

## Documents

| File | Purpose |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Rules for Claude Code sessions in this repo |
| [docs/PLAN.md](docs/PLAN.md) | The approved project plan |
| [docs/STATUS.md](docs/STATUS.md) | Current phase, what is done, what is next |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions adopted from TDMS and open items |
| [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md) | The TLMI subset of the TDMS business rules |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | The TLMI subset of the TDMS data model |

## Layout

```
README.md  CLAUDE.md
docs/        plan, status, decisions, rules, data model
specs/       one spec per phase or slice
src/server/  .gs files: services, repository, auth
src/client/  .html files, including api.js
migration/   legacy import mapping and review notes
```

## Deploy path

- `clasp` may push and create versions on the **DEV** and **TEST** script projects only.
- **LIVE** is deployed by hand by the owner. Claude Code never deploys to LIVE.
- A commit must exist before any push, so every deploy can be rolled back.
- DEV, TEST and LIVE each have their own `TLMI_DB` sheet. Sheet IDs live in Script Properties, never in the repo.

## Source control

`main` is what runs live. Work happens on a branch and merges through a pull request that Leo approves.
