# Code: Claude Code as Engineer (build, fix, merge, deploy, report)

Read this when triage gives `role: code` autopilot work: `build`, `fix`, `merge`, or `continue` with phase 2. Plans and reviews are the Lead's (`references/lead.md`). Commands run from the skill folder with `export PYTHONDONTWRITEBYTECODE=1` set. `<o>/<r>` is the repo, `<N>` the issue and `<P>` the PR.

The approved plan authorizes everything in it, including the merge, and nothing beyond it.

## Every run

0. **Housekeeping first (SKILL.md, "Every run", steps 2 and 3).** Reopen each `reopen` entry, then run triage again. Park each `needs_leo`, `stale` and `stalled` entry (`--from code` for a stalled plan or review: that is the Lead's work nobody picked up). If that was all there was and `work` is empty, say what you did in one line and stop.
1. **Repo identity gate.** The repo and project folder must match the request. If they do not, run `park --phase 2` with the reason, and stop before any change.
2. **Claim:** `python scripts/loop_gh.py claim --repo <o>/<r> --issue <N>`. Exit code 3 → stop.
3. **Read only:** the plan file (it is the spec), the issue, the project's `CLAUDE.md` and the files the plan names. For a fix, also read the latest verdict.

## Build, fix, or `continue` with phase 2

For `continue`, read the last park comment first. If it parked a merge ("Merge needs one tap" or "High-risk PR ready") or a release ("Ready to release"), resume at Merge step 2 or step 3 below. If it was a stall alert ("No Lead run picked up the review"), check the PR is open and re-run `ready-for-review` for its current head, which queues the review again. If the alert was for a build ("No Code run picked up the build"), it is yours: build now. Otherwise continue the build or fix here with the answer in `notes`.

1. Check out `claude/<slug>`, the plan PR's branch. If `main` moved, merge `origin/main` into it with a merge commit. Never rebase or force-push.
   **Route the step:** `python3 scripts/route.py --step <build|fix> --paths <the files the plan lists> --tasks <n> --text <issue body file> --session <this task's model>` (for a fix, use `--git-range origin/main...HEAD --round <n>` instead of `--paths`). Read only the expert notes it lists. On `delegate`, a subagent with that model makes the edits and runs the tests in the checkout; you commit (one commit per task), push and post (`references/models.md`). Otherwise work inline.
2. **Build:** implement the plan's tasks in order, one commit per task (`T<n>: <task>`), and push after each commit. Change only files inside the plan's `Files in scope:` line. A task that needs another file is a stop-and-ask item; a `CONTINUE:` that asks for more files still leaves the merge to the owner.
   **Fix:** fix every `[BLOCKER]` and `[MAJOR]` in the latest verdict, and fix or answer each `[MINOR]` and `[NIT]`. Never weaken or skip a test.
   **Continue:** apply the answer in the entry's `notes`.
3. **Test** as the test plan says, and keep the output. On Node 22, `node --test <folder>` fails: pass a glob such as `node --test 'dir/*.test.mjs'`. Playwright and Chromium are preinstalled in scheduled runs (`require('playwright')`), so a browser check needs no install. For a changed screen, save the screenshots as `references/experts/frontend.md` says and commit them with the task. **Debug:** find the root cause before fixing, and fix the cause, not the symptom. Attempt 1 runs on the tier from the step above. If the same error survives it, run `route.py --step fix --attempt 2 ...`, which escalates to opus, for attempt 2. If the error survives that too, park.
4. **Docs:** in the plan file, replace `AWAITING APPROVAL` with `APPROVED by <owner> on <date>`, and keep a `## Status` section with the status, decisions and test results. Update any project status document the plan names. Never create a duplicate document.
5. **PR:** retitle it to `<feature>`. The body holds the purpose, the requirements covered, the changes, the tests run with their results, known limitations, and any migration, deploy or rollback notes. Use `gh api -X PATCH repos/<o>/<r>/pulls/<P> -f title=... -F body=@pr.md`.
6. **Write `result.md`:** the entry's `reply_header`, with the real `pr` and the pushed `head` (`git rev-parse HEAD`). Then `READY FOR REVIEW (round n)`, the test command with its result line, and, for a fix, which commit fixed each finding. Add the one true `Model:` line from route.py's `model_line` (the `inline` or the `subagent` one). 150 words or fewer. `ready-for-review` refuses a result without it.
7. Run `python scripts/loop_gh.py ready-for-review --repo <o>/<r> --issue <N> --pr <P> --file result.md --turn <next_turn> --session <this task's model>`, verify the hand-off (SKILL.md, step 6), then stop. The Lead reviews next.

## Merge: `merge`

1. Run `python scripts/loop_gh.py merge --repo <o>/<r> --issue <N> --pr <P> --method <the plan's method>`. It reads the plan's `Risk:` and `CI required:` lines itself.
   - Exit code 4, 5 or 6: park with the reason it gives (`--phase 2`).
   - Exit code 8 (high risk) or 9 (files outside the plan's scope), every other gate green: park with "<the problem it gives>. PR ready: <PR link>. Tap Merge, then reply CONTINUE: merged (or say MERGE in a chat with the Lead), or reply REVISE: to widen the plan". Never merge it yourself.
   - If a permission rule refuses the command itself: park with the reason "Merge needs one tap from you: <PR link>. Tap Merge, then reply CONTINUE: merged". Never work around a refusal. On the next `continue`, if the PR is already merged, go straight to step 2.
2. Run `python scripts/loop_gh.py verify --repo <o>/<r> --issue <N> --pr <P>`. It must report `on_base: true`. Note the post-merge checks it lists.
3. **Deploy only as the plan's release policy says.**
   - `no deploy`: skip this step.
   - `staging automatic`: deploy through the authorized workflow, then verify the deployment separately (its URL, health or smoke check).
   - `production after the owner's CONTINUE: release`: park with "Ready to release <merge sha>: reply CONTINUE: release".
   - Apps Script projects: clasp is not available in cloud runs, so report the deploy as a manual step for the owner, with the steps from `references/experts/appsscript.md` on the `Deployed:` line.
   - Never claim a deployment without evidence.
4. **Write `summary.md`:** the entry's `reply_header`, then five lines, each one true and backed by evidence:
   - `Implemented and tested:`
   - `Reviewed:`
   - `Merged:` (with the merge commit)
   - `Deployed:`
   - `Blocked or unverified:`
   Then one line `Model: <the model that wrote this summary> (<per step that ran, for example build sonnet, review opus via subagent>)`, and every changed file (`git diff --name-only <base>..<merge commit>`). If the approval was relayed from a chat, add `Approval: relayed from chat, "<the quoted words>"`. 250 words or fewer.
5. Run `python scripts/loop_gh.py finish --repo <o>/<r> --issue <N> --pr <P> --file summary.md --turn <next_turn> --session <this task's model>`. It refuses unless the PR is merged (a request with no code change says `No PR: yes` in the issue and omits `--pr`), labels the issue `done` and closes it. If it fails half-way, run it again: nothing is posted twice. Then verify the hand-off (SKILL.md, step 6).

## Merge conflicts

1. Inspect both sides and find the intended behavior.
2. Keep all valid work, and never drop an unrelated change silently.
3. Re-run the affected tests.
4. A resolution that materially changes the reviewed code goes back to review with `ready-for-review`.
5. A conflict in files outside the plan → park.

## Stop and ask (park with one batched question)

- Anything outside the approved plan must change (scope, schema, architecture).
- A fix needs a new dependency, an external service or a cost.
- The same error survives 2 fix attempts.
- A merge conflict touches files outside the plan.
- The repo identity gate fails.
- A required approval or permission cannot be satisfied.
- A production release or a high-risk merge needs the owner.
- A destructive operation lacks safeguards.

**Never:** commit secrets (API keys, clasp credentials, tokens), force-push, rewrite history, delete files or data outside the plan, bypass branch protection or reviews, merge with failing checks, or report success that you did not verify.

## What the owner types

| Comment, at the very start and in capitals | Effect |
|---|---|
| `APPROVED` | Approves the latest plan (Code builds; the Lead reviews; Code merges unless it is high risk) |
| `REVISE: <notes>` | The Lead rewrites the plan (up to 3 times); any earlier `APPROVED` no longer counts |
| `CONTINUE: <answer>` | Resumes the parked phase with the answer; the approval still stands, but files outside the plan's scope still wait for the owner at the merge |
| `MERGE ...` (in a chat with the Lead) | Merges a PR that the gate parked with exit 8 (high risk) or 9 (outside the scope) |
