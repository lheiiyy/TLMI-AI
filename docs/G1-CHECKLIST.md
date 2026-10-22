# Gate G1 checklist (Phase 1)

Gate G1: all roles sign in on TEST; master lists loaded and checked. The seven items come from section 11 of the [Phase 1 design](../specs/2026-10-19-phase-1-core-data-design.md). Record the evidence next to each item when it is done. Do not paste an ID, a password, a token or a real staff name here.

| # | Item | How to check | Evidence to record | Done |
| --- | --- | --- | --- | --- |
| 1 | All five roles sign in on TEST with employee ID and password (Phase 2 part 2A replaced the name list and the Admin PIN). | On the TEST web app, sign in once as each role (Training Officer, Training Supervisor, Training Manager, Senior Training Manager, Admin). Each user types their own password. | Date, and who signed in as which role (role names only). | [ ] |
| 2 | The master lists are seeded and Leo has checked them against the `SETTINGS` tab and the `SEED_OFFICERS` tab of the legacy copy. | Seed screen: Check, then Run. Compare the Master lists screen with the two tabs. | Counts from the seed result (stores, regions, stations, users created, skipped, rejected); date and name of the checker. | [ ] |
| 3 | An Admin edits a store and sees the history and audit rows; a stale edit returns `CONFLICT`. | Stores screen: edit a store. Audit log: the `LOCATION.UPDATED` row. In a second browser, edit the same store from an old screen: "Changed by X, reload." | The audit row's event and time; the conflict message seen. | [ ] |
| 4 | Every non-Admin gets `FORBIDDEN` on every Admin method. | Covered by the unit test `every method x every role matches the permission table` and the browser test `the menu follows the role, and the server decides`. | Result of `npm test` and `npm run e2e` on the merged `main`. | [ ] |
| 5 | The import review ran on a copy of the 276-row sheet; all six tabs are present; the summary equals 276 rows and the status counts; nothing was written to the legacy copy or to any Team Leader table. | Import review screen: Run. In the review sheet: the six tabs; `summary` row `source_rows.master_log` is 276 and the status counts add up. | Counts shown on the screen; confirmation that the legacy copy is unchanged. | [ ] |
| 6 | Unit tests, the browser checks at three widths and the pull request review pass, with no critical or major finding open. | `npm test`, `npm run e2e` (1280, 768 and 375 pixels), and the reviewer's `VERDICT: APPROVED` on each pull request. | Test counts; the four Phase 1 pull request numbers. | [ ] |
| 7 | DEV and TEST are deployed through `clasp`; LIVE is untouched. | `npm run deploy:dev` and `npm run deploy:test`; LIVE has no deploy from Phase 1. | Date of each push; the commit it came from. | [ ] |

Also record before the gate is closed:

- The hash timing and iteration count from `measureHash` ([docs/SETUP.md](SETUP.md), step 5).
- That the temporary properties (`FIRST_ADMIN_NAME`, `FIRST_ADMIN_EMPLOYEE_NO`, `FIRST_ADMIN_PASSWORD`, `ADMIN_EMPLOYEE_NO`, `ADMIN_TEMP_PASSWORD`) and the Admin PIN properties are gone from the Script Properties of each environment.
- That the web app access setting on TEST is the one Leo chose, and that the TEST link was shared only with named officers.
- The open items still listed in [docs/DECISIONS.md](DECISIONS.md) ("Open for Phase 2" and the legacy-import items).
