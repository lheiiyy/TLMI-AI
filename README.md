# TLMI-AI

Team Leader Monitoring for the Angel's Pizza Team Leader program (Training and Development Department).

TLMI-AI is a web app that replaces the "[sys] Team leader Monitoring" spreadsheet. It runs as a Google Apps Script web app on a separate Google Sheet database (`TLMI_DB`). It is standalone now and uses the TDMS Team Leader rules, IDs, table names and `tl.*` API names, so its data can move into TDMS phase PH-12 later without rework.

## Status

**Phase 1: core data, sign-in and audit log (gate G1).** Master data, interim sign-in, the audit log, the seed and the import review dry run are built; the Admin and master-list screens run on localhost. See [docs/STATUS.md](docs/STATUS.md) for what is done and what is next.

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Installs the test tools (Playwright). |
| `npm test` | Unit tests of the server code, the build and the deploy tool. No Google account needed. |
| `npm run dev` | Runs the app on `http://127.0.0.1:4173` with fake sheets and invented data (mock transport). |
| `npm run e2e` | Browser tests (Playwright, Chromium) at 1280, 768 and 375 pixels against the dev server. |
| `npm run build` | Builds `dist/`: the server `.gs` files, one `index.html`, `appsscript.json`. |
| `npm run deploy:dev`, `npm run deploy:test` | Tests, builds and pushes to DEV or TEST with clasp. There is no LIVE command. |

First-time setup on DEV and TEST: [docs/SETUP.md](docs/SETUP.md). Gate G1 evidence: [docs/G1-CHECKLIST.md](docs/G1-CHECKLIST.md).

## Documents

| File | Purpose |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Rules for Claude Code sessions in this repo |
| [docs/PLAN.md](docs/PLAN.md) | The approved project plan |
| [docs/STATUS.md](docs/STATUS.md) | Current phase, what is done, what is next |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions adopted from TDMS and open items |
| [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md) | The TLMI subset of the TDMS business rules |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | The TLMI subset of the TDMS data model |
| [docs/SETUP.md](docs/SETUP.md) | What the owner does once to run the app on DEV and TEST |
| [docs/G1-CHECKLIST.md](docs/G1-CHECKLIST.md) | The seven gate G1 items and the evidence to record |
| [docs/COLLABORATION.md](docs/COLLABORATION.md) | Who does what: Code builds, the reviewer checks, Leo decides; how pull requests are reviewed |
| [specs/](specs/) | One spec per phase or slice (Phase 1 design) |
| [plans/](plans/) | Build plans, one per phase (Phase 1 plan) |
| [migration/LEGACY-DATA-PROFILE.md](migration/LEGACY-DATA-PROFILE.md) | What the legacy sheet looks like: columns, value lists, known problems |

## Layout

```
README.md  CLAUDE.md
docs/        plan, status, decisions, rules, data model, setup guide, G1 checklist
specs/       one spec per phase or slice
plans/       build plans
src/server/  .gs files: API entry, services, repository, platform adapters
src/client/  index.html, styles.css, api.js, app.js, views/ (inlined into one page by the build)
tools/       build, dev server, deploy
tests/       unit tests, fixtures (invented data), e2e (Playwright)
migration/   legacy data profile and import notes
```

## Deploy path

- `clasp` may push and create versions on the **DEV** and **TEST** script projects only.
- **LIVE** is deployed by hand by the owner. Claude Code never deploys to LIVE.
- A commit must exist before any push, so every deploy can be rolled back.
- DEV, TEST and LIVE each have their own `TLMI_DB` sheet. Sheet IDs live in Script Properties, never in the repo.

## Source control

`main` is what runs live. Work happens on a branch and merges through a pull request that Leo approves.
