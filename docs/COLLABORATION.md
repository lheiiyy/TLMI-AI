# Working agreement: Code builds, the reviewer checks, Leo decides

Set by Leo on 2026-10-20. GitHub is the bridge in both directions: everything one side needs from the other is a pull request, a pull request comment or a file in this repository.

## Roles

| Who | Does | Does not |
| --- | --- | --- |
| **Claude Code ("Code")**, on Leo's computer | Builds on branches from the approved plan, opens pull requests, runs the tests, fixes review findings, updates `docs/STATUS.md` | Merge unless Leo has said so in the Code session; deploy LIVE; change the spec or plan without a pull request comment first |
| **Claude, claude.ai session ("Reviewer")** | Writes specs and plans for the next slice; checks each pull request (reads the diff, checks out the branch, runs `npm test` and the browser tests, compares with the spec and plan); posts the review; stands in for Leo on approvals while he is away; keeps the Google spreadsheets and the legacy data analysis | Write the application code; merge (the platform asks for Leo's explicit word) |
| **Leo** | Decides every important security question; merges, or tells Code to merge; owns LIVE | |

Code also reviews the Reviewer's work: specs, plans and notes arrive as pull requests, and Code comments on them before building from them.

## Flow for one pull request

1. Code opens the pull request from a branch. The description lists: what changed, the plan tasks covered, the `npm test` result (number of tests and failures), the browser test result, any deviation from the plan, any open question. Code then comments `READY FOR REVIEW`.
2. The Reviewer reviews. Each finding is one comment starting with a tag: **[BLOCKER]** (wrong, unsafe or breaks the spec), **[MAJOR]** (will cause trouble soon), **[MINOR]**, **[NIT]**. The review ends with one comment: `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`.
3. Code fixes every BLOCKER and MAJOR, answers or fixes the rest, pushes, and comments `READY FOR REVIEW (round 2)` and so on. A reply to a finding says what changed and in which commit.
4. After `VERDICT: APPROVED` and green tests, the pull request waits for the merge. Merge uses a merge commit, then Code deletes the branch, pulls `main` and reports the merge hash in `docs/STATUS.md`.
5. Code starts the next pull request from updated `main`. Stacking is allowed only when Leo has not yet merged the previous one; say so in the description.

## Stop and ask Leo

Both sides stop and write to Leo, in the session, before: opening access wider, storing or committing a secret, a sheet ID or real staff data, widening a role, anything on LIVE, deleting data.

## What each side must not forget

- Names are TDMS names. A new name needs a pull request comment first.
- No sheet ID, PIN, token, e-mail address or real staff name in the repository, tests or fixtures.
- Each session starts with the repository check and `docs/STATUS.md`, and ends by updating it.
