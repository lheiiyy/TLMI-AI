# STATUS

**Phase:** 2, Team Leader workflow (Phase 1 gate G1 checks are Leo's, on TEST). Gate G0 is passed.
**Last updated:** 2026-10-22

## Done

- Phase 1 pull requests A to D merged (#4 to #7, last merge `ec4753a`): data layer, API, master data, settings, users, seed, import review, setup, screens, deploy tool, CI.
- Phase 2 spec, plan and working agreement merged (#9 `b4fbf88`); automation prompts (#10 `45ae807`); STATUS (#8 `78ab694`); #18 `d632749`.
- Phase 2 pull request E merged (#20 `31ebec0`): Employee ID and password sign-in. Spec §4 amendment merged (#21 `ea9b15b`).
- Phase 2 pull request F merged (#24 `513a6fd`): Team Leader tables, rules, `tl.*` and `persons.*` methods.
- Docs pull request #25 merged (`39a7072`): the hourly Code task.
- Phase 2 pull request G (issue #28, plan Tasks 13 and 14): Team Leader screens (`src/client/tl.js`, `views/tl.html`), `App.registerNav`, assembly of every client script, invented records in every state in the dev environment, and the browser tests `tests/e2e/tl.spec.js`. In review.

## Open items

- Before deploying E: the `users` tab of an existing database needs four new columns ([docs/SETUP.md](SETUP.md) section 3).
- Admin sets the extension limit (CFG-047) and the quit reasons (CFG-018) in the app; until then Extend is not offered and Quit has no reasons.
- Pull request G asks the Reviewer to decide: a deadline preview on the enroll form (no server method), and a list of certifying officers for non-Admin users (the screen uses the signed-in user as the only officer).
- Gate G1 checks ([docs/G1-CHECKLIST.md](G1-CHECKLIST.md)) and the timing and number-format checks on TEST are Leo's. Nothing is deployed.
- Merged branches could not be deleted from the Code session; Leo can delete them on GitHub.

## Next

- Pull request H (Tasks 15 to 18, legacy import and gate G2 documents), from updated `main` after G is merged.
