# Working agreement: Code builds, the reviewer checks, Leo decides

Set by Leo on 2026-10-20. GitHub is the bridge in both directions: everything one side needs from the other is a pull request, a pull request comment or a file in this repository.

## Roles

| Who | Does | Does not |
| --- | --- | --- |
| **Claude Code ("Code")**, on Leo's computer | Builds on branches from the approved plan, opens pull requests, runs the tests, fixes review findings, updates `docs/STATUS.md` | Merge without the permission described under "Merge rule"; deploy LIVE; change the spec or plan without a pull request comment first |
| **Claude, claude.ai session ("Reviewer")** | Writes specs and plans for the next slice; checks each pull request (reads the diff, checks out the branch, runs `npm test` and the browser tests, compares with the spec and plan); posts the review; stands in for Leo on approvals while he is away; keeps the Google spreadsheets and the legacy data analysis | Write the application code; merge (the platform asks for Leo's explicit word) |
| **Leo** | Decides every important security question; merges, or tells Code to merge; owns LIVE | |

Code also reviews the Reviewer's work: specs, plans and notes arrive as pull requests, and Code comments on them before building from them.

## Talking on GitHub, not in the session

Added 2026-10-21 on Leo's word ("dun kayo mag usap sa GitHub"). Code and the Reviewer post as the same GitHub account, so every comment starts with its writer: **`Code:`** or **`Reviewer:`**. A comment without one of these words at the start is treated as Leo's.

1. Everything Code would otherwise ask Leo in the session about a pull request goes into a comment on that pull request instead: a question about the spec or plan, a deviation, a test it cannot make pass, a review finding it disagrees with. Start it with `Code: QUESTION` or `Code: BLOCKED — REASON — DECISION REQUIRED`. The Reviewer answers on the pull request with a decision.
2. Code does not wait in the session. After `READY FOR REVIEW`, a question or a `BLOCKED`, Code checks the pull request's comments every 4 minutes (`/loop`) and goes on as soon as the Reviewer has answered.
3. The Reviewer checks GitHub every 4 minutes from its session, and every hour from a scheduled task.
4. Only these go to Leo in the Code session: the items under "Stop and ask Leo", and a merge that the rule below gives to Leo.
5. Code reports progress to Leo in the session in one line per merged pull request; the detail stays on GitHub.

## Flow for one pull request

1. Code opens the pull request from a branch. The description lists: what changed, the plan tasks covered, the `npm test` result (number of tests and failures), the browser test result, any deviation from the plan, any open question. Code then comments `Code: READY FOR REVIEW`.
2. The Reviewer reviews. Each finding is one comment starting with a tag: **[BLOCKER]** (wrong, unsafe or breaks the spec), **[MAJOR]** (will cause trouble soon), **[MINOR]**, **[NIT]**. The review ends with one comment: `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`.
3. Code fixes every BLOCKER and MAJOR, answers or fixes the rest, pushes, and comments `READY FOR REVIEW (round 2)` and so on. A reply to a finding says what changed and in which commit.
4. After `VERDICT: APPROVED` and green tests, the pull request is merged under the "Merge rule" below. Merge uses a merge commit, then Code deletes the branch, pulls `main` and reports the merge hash in `docs/STATUS.md`.
5. Code starts the next pull request from updated `main`. Stacking is allowed only when Leo has not yet merged the previous one; say so in the description.

## Merge rule

One rule, the same as in [CLAUDE.md](../CLAUDE.md): **a pull request is merged only after Leo has written in the Code session which pull request(s) to merge.** A general "OK" is not a merge order. Leo may name several at once, for example "OK i-merge #3 to #7 kapag may VERDICT: APPROVED at green ang tests". For a named pull request Code then merges when both conditions hold: the Reviewer's latest comment is `VERDICT: APPROVED` and the tests are green. The Reviewer approves in Leo's place on design, spec and code questions (Leo's standing instruction of 2026-10-20); that approval does not replace Leo naming the pull request. If a number is not named, Code asks Leo.

**The approver and the merger are never the same party** (the platforms refuse a self-approved merge, and they are right to):

| Pull request written by | Reviewed and approved by | Merged by |
| --- | --- | --- |
| Code (feature and fix pull requests, Code's docs) | the Reviewer (`Reviewer: ... VERDICT: APPROVED`) | Code, for a pull request Leo has named |
| the Reviewer (specs, plans, Reviewer docs) | Code (`Code: ... VERDICT: APPROVED`) | **Leo**, with the Merge button on GitHub (one click, also from the phone). Code does not merge a pull request it approved itself, and the Reviewer never merges |

## Stop and ask Leo

Both sides stop and write to Leo, in the session, before: opening access wider, storing or committing a secret, a sheet ID or real staff data, widening a role, anything on LIVE, deleting data.

## What each side must not forget

- Names are TDMS names. A new name needs a pull request comment first.
- No sheet ID, PIN, token, e-mail address or real staff name in the repository, tests or fixtures.
- Each session starts with the repository check and `docs/STATUS.md`, and ends by updating it.
