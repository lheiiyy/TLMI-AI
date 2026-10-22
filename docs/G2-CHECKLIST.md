# Gate G2 checklist (Phase 2)

Gate G2: the legacy Team Leader records are in the app and reconciled, and the old sheet is closed. The five items come from section 11 of the [Phase 2 design](../specs/2026-10-21-phase-2-enrollment-certification-design.md). Record the evidence next to each item when it is done. Do not paste an ID, a password, a token or a real staff name here.

| # | Item | How to check | Evidence to record | Done |
| --- | --- | --- | --- | --- |
| 1 | Every user signs in on TEST and LIVE with an employee ID and password; X-1 is marked ended. | On each web app, each user signs in with their own employee ID and password ([SETUP.md](SETUP.md), section 7). Then mark X-1 ended in [DECISIONS.md](DECISIONS.md). | Date, environment, and the roles that signed in (role names only). | [ ] |
| 2 | Unit and browser tests pass, and every Phase 2 pull request has the Reviewer's `VERDICT: APPROVED`. | `npm test`, then `npm run e2e` (1280, 768 and 375 pixels). Read the verdict comment on each Phase 2 pull request. | Test and failure counts of both commands on the merged `main`; the Phase 2 pull request numbers. | [ ] |
| 3 | The import on LIVE shows all 276 source rows as committed or skipped with a reason, and the RESULT and status counts agree. | Legacy import screen, newest batch: rows by result, then the reconciliation table. "Rows needing action" is 0 and "Reconciled" says Yes. | The counts shown (by result, legacy result against status in the app, Failed with Disqualified); the batch ID; the date. | [ ] |
| 4 | Officers have signed off the persons list and the duplicate decisions in the review sheet. | Each tab of the review sheet has a decision for every row, and the officers named in `decided_by` agree the list. | Date and the names of the officers who signed off (names go in the private notes, not here). | [ ] |
| 5 | MASTER_LOG in the original legacy sheet is set to read-only by Leo. | In the original legacy sheet, protect the MASTER_LOG tab so only Leo can edit it. Do this after the LIVE import is reconciled. | Date. A confirmation from Leo. | [ ] |

Also record before the gate is closed:

- That the rehearsal on TEST was done first and its result was reconciled ([SETUP.md](SETUP.md), section 9).
- That the import was run before any Team Leader was enrolled in the app on that environment, and that the TEST rehearsal started from a database without app-made Team Leaders.
- The dated copy of the LIVE `TLMI_DB` made before the LIVE import, and its date. The app cannot check that this copy exists.
- The open items still listed in [DECISIONS.md](DECISIONS.md).
