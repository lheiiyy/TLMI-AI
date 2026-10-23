# STATUS

**Phase:** 2, Team Leader workflow (Phase 1 gate G1 checks are Leo's, on TEST). Gate G0 is passed.
**Last updated:** 2026-10-23

## Done

- Phase 1 pull requests A to D merged (#4 to #7, last merge `ec4753a`): data layer, API, master data, settings, users, seed, import review, setup, screens, deploy tool, CI.
- Phase 2 spec, plan and working agreement merged (#9 `b4fbf88`); automation prompts (#10 `45ae807`); STATUS (#8 `78ab694`); #18 `d632749`.
- Phase 2 pull request E merged (#20 `31ebec0`): Employee ID and password sign-in. Spec §4 amendment merged (#21 `ea9b15b`).
- Phase 2 pull request F merged (#24 `513a6fd`): Team Leader tables, rules, `tl.*` and `persons.*` methods.
- Docs pull request #25 merged (`39a7072`): the hourly Code task.
- Phase 2 pull request G merged (#30 `5e0f136`): Team Leader screens, `App.registerNav`, invented records in the dev environment, browser tests. Its two open questions were decided by the Reviewer on #30: no deadline preview (the deadline is shown after saving), and the signed-in user is the one certifying officer.
- Phase 2 pull request H merged (#33 `8e13842`; issue #31, plan Tasks 15 to 18): proposed name parts and decision words in the import review; `import.validate`, `import.get`, `import.rows.list`, `import.rows.skip`, `import.commit` (Admin only) with chunked, idempotent commit and reconciliation; the Legacy import screen; [docs/G2-CHECKLIST.md](G2-CHECKLIST.md); the rehearsal and LIVE steps in [docs/SETUP.md](SETUP.md) section 9. A certification grade with no DATE CERTIFIED is not imported and gives the warning `CERT_GRADE_NO_DATE` (spec §10.5, Reviewer's decision on #33).
- Issue #36 in review: `tools/deploy.js` starts `npm` and `clasp` through a shell on Windows and reports a command that could not start (pull request `fix/deploy-windows-shell`, `merge:leo`).

## Open items

- Before deploying E: the `users` tab of an existing database needs four new columns ([docs/SETUP.md](SETUP.md) section 3).
- Admin sets the extension limit (CFG-047) and the quit reasons (CFG-018) in the app; until then Extend is not offered and Quit has no reasons.
- Gate G1 checks ([docs/G1-CHECKLIST.md](G1-CHECKLIST.md)) and the timing and number-format checks on TEST are Leo's. Nothing is deployed.
- Merged branches could not be deleted from the Code session; Leo can delete them on GitHub.

## Next

- The rehearsal on TEST and gate G2 ([docs/G2-CHECKLIST.md](G2-CHECKLIST.md)). Deployment and the LIVE run are the owner's. The import runs before anybody enrolls a Team Leader in the app on that environment.
