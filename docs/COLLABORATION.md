# Working agreement: Code builds, the reviewer checks, Leo decides

Set by Leo on 2026-10-20. GitHub is the bridge in both directions: everything one side needs from the other is a pull request, a pull request comment or a file in this repository.

## Roles

| Who | Does | Does not |
| --- | --- | --- |
| **Claude Code ("Code")**, on Leo's computer | Builds on branches from the approved plan, opens pull requests, runs the tests, fixes review findings, updates `docs/STATUS.md` | Decide a spec, plan, design or business-rule question (it asks the Reviewer); merge without the permission described under "Merge rule"; deploy LIVE; change the spec or plan without a pull request comment first |
| **Claude, claude.ai session ("Reviewer")** | Writes specs and plans for the next slice; checks each pull request (reads the diff, checks out the branch, runs `npm test` and the browser tests, compares with the spec and plan); posts the review; stands in for Leo on approvals while he is away; keeps the Google spreadsheets and the legacy data analysis | Write the application code; merge (the platform asks for Leo's explicit word) |
| **Leo** | Decides every important security question; merges the pull requests the merge rule gives him; owns LIVE | |

Code also reviews the Reviewer's work: specs, plans and notes arrive as pull requests, and Code comments on them before building from them.

## Talking on GitHub, not in the session

Added 2026-10-21 on Leo's word ("dun kayo mag usap sa GitHub"). Code and the Reviewer post as the same GitHub account, so every comment starts with its writer: **`Code:`** or **`Reviewer:`**. A comment without one of these words at the start is treated as Leo's.

1. Everything Code would otherwise ask Leo in the session about a pull request goes into a comment on that pull request instead: a question about the spec or plan, a deviation, a test it cannot make pass, a review finding it disagrees with. Start it with `Code: QUESTION` or `Code: BLOCKED — REASON — DECISION REQUIRED`. The Reviewer answers on the pull request with `Reviewer: DECISION`, and that answer is final unless Leo overrules it.
2. Code does not wait in the session. After `READY FOR REVIEW`, a question or a `BLOCKED`, Code checks the pull request's comments every 4 minutes (`/loop`) and goes on as soon as the Reviewer has answered.
3. The Reviewer checks GitHub every 4 minutes from its session, and every hour from a scheduled task.
4. Only these go to Leo in the Code session: the items under "Stop and ask Leo", and a merge that the rule below gives to Leo.
5. Code reports progress to Leo in the session in one line per merged pull request; the detail stays on GitHub.

## Flow for one pull request

1. Code opens the pull request from a branch. The description lists: what changed, the plan tasks covered, the `npm test` result (number of tests and failures), the browser test result, any deviation from the plan, any open question. Code then comments `Code: READY FOR REVIEW`.
2. The Reviewer reviews. Each finding is one comment starting with a tag: **[BLOCKER]** (wrong, unsafe or breaks the spec), **[MAJOR]** (will cause trouble soon), **[MINOR]**, **[NIT]**. The review ends with one comment: `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`.
3. Code fixes every BLOCKER and MAJOR, answers or fixes the rest, pushes, and comments `READY FOR REVIEW (round 2)` and so on. A reply to a finding says what changed and in which commit.
4. After `VERDICT: APPROVED` and green tests, the pull request is merged under the "Merge rule" below.
5. Code starts the next pull request from updated `main`. Stacking is allowed only when Leo has not yet merged the previous one; say so in the description.

## Merge rule

Leo, 2026-10-21 (answer B4 in [docs/AUTOMATION.md](AUTOMATION.md)): **merging is part of Code's automatic work.** Code merges a pull request, without Leo naming it, when all of these hold:

1. The Reviewer's latest comment on it is `VERDICT: APPROVED` with `Reviewed head <the current head commit>`.
2. The `tests` check is green on that head.
3. GitHub reports it mergeable (no conflict).
4. It carries none of the labels `merge:leo`, `needs:leo` or `status:blocked`.
5. Its diff touches none of the halt paths: `CLAUDE.md`, `.github/`, `appsscript.json`, the permission table, the `tools/` deploy scripts, `docs/automation/` (the agents' prompts). Such a pull request gets `merge:leo`, and Leo merges it himself on GitHub.

Merge uses a merge commit. Code then deletes the branch (or says that the proxy refused), and records the merge hash in `docs/STATUS.md` in its next pull request (nothing is pushed to `main` directly). If one condition fails, Code does not merge; it hands the pull request to Leo with the condition named. The Reviewer approves in Leo's place on design, spec and code questions (Leo's standing instruction of 2026-10-20).

This rule takes effect for Code when [CLAUDE.md](../CLAUDE.md) says the same. Until then the older rule in `CLAUDE.md` applies: Code merges only pull requests that Leo has named in a session.

## Decision rights (Leo, 2026-10-21: "ikaw parin ang head at si code ang builder")

The roles are split so that two decisions never collide.

- **The Reviewer is the head.** It alone decides spec, plan, design and business-rule questions (within what Leo has decided), and it alone gives `VERDICT: APPROVED`, which is the approval of every merge.
- **Code is the builder.** It builds, tests, reports and proposes. A proposal from Code is never a decision: Code does not build an undecided rule "by default"; it posts `Code: QUESTION` and waits for the Reviewer's answer.
- **Leo** decides the items under "Stop and ask Leo", and can overrule either side at any time.

| Pull request written by | Checked by | Approved by | Merged by |
| --- | --- | --- | --- |
| Code (features, fixes, Code's docs) | the Reviewer | the Reviewer: `VERDICT: APPROVED` | Code, under the merge rule; Leo for a `merge:leo` pull request |
| the Reviewer (specs, plans, Reviewer docs) | Code: `Code: TECHNICAL REVIEW` with tagged findings; the last line is `READY TO MERGE` or `NOT READY` (never `VERDICT:`) | the Reviewer: `VERDICT: APPROVED`, after Code's `READY TO MERGE` | Code, under the merge rule; Leo for a `merge:leo` pull request |

So the approver and the merger are never the same party. If a platform still refuses Code's merge, Code posts `Code: BLOCKED — merge refused` and Leo clicks Merge on GitHub; nobody looks for another way around the refusal.

## Stop and ask Leo

Both sides stop and write to Leo, in the session, before: opening access wider, storing or committing a secret, a sheet ID or real staff data, widening a role, anything on LIVE, deleting data.

## What each side must not forget

- Names are TDMS names. A new name needs a pull request comment first.
- No sheet ID, PIN, token, e-mail address or real staff name in the repository, tests or fixtures.
- Each session starts with the repository check and `docs/STATUS.md`, and ends by updating it.
