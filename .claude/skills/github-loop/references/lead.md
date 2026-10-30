# Lead: Claude Cowork as Technical Lead

Read this when triage gives `role: lead` work (`plan`, `revise`, `review`, or `continue` with phase 1), or when the owner asks in chat to plan a feature, review a PR or check the loop. Commands run from the skill folder with `export PYTHONDONTWRITEBYTECODE=1` set.

## Every run

0. **Housekeeping first (SKILL.md, "Every run", steps 2 and 3).** Reopen each `reopen` entry, then run triage again. Park each `stalled` entry with `--from lead` (it is Code's work that nobody picked up). If that was all there was and `work` is empty, say what you did in one line and stop.
1. **Repo identity gate.** The request's repo and project folder must match the repo you are in. If they do not, run `python scripts/loop_gh.py park --repo <o>/<r> --issue <N> --turn <next_turn> --phase 1 --from lead --reason "repo mismatch: ..."` and stop before any change.
2. **Claim:** `python scripts/loop_gh.py claim --repo <o>/<r> --issue <N>`. Exit code 3 → stop.
3. **Read only what is needed:** the issue, the project's `CLAUDE.md`, the docs the request names, and for a review, the plan file. Never read the whole codebase.

## Plan: `plan`, `revise`, and `continue` with phase 1

For a new project or system, plan with **web-app-project-planning**: in chat, its Docs artifact; in a scheduled run, its section list inside the repo plan file. For a web app, internal tool or portal, also read `references/web-apps.md`. For a feature, write `<project folder>/docs/plan-<slug>.md` on branch `claude/<slug>`, where the slug is the request's feature name.

**Route first.** Save the issue body to a file and run `python3 scripts/route.py --step plan --text <file> --session <this task's model>` (`--step revise --round <n>` for a revision; the entry's `round` is the number). Read only the expert notes it lists. Its `risk` is the floor for the plan's `Risk:` line (raise it for sensitive data or destructive steps a file name cannot show; never lower it). Its `model` part is the `pick_model.py` answer: on `delegate`, a subagent with that model drafts the plan file and you run the checks and the posting yourself (`references/models.md`); otherwise plan inline. Keep the `model_line` that is true for the reply. If the entry has a `tier_note`, the work waited for a stronger task that never came: do it at your own tier and use the `inline` line.

1. **Inspect** the repo state, open PRs that touch the same files, existing docs, tests and CI. Reuse what works. Name the project's existing status document (its equivalent of PROJECT_STATUS.md, for example `specs/plan.md` or `docs/STATUS.md`) in the plan, so Code updates it instead of creating a new one.
2. **Readiness.** Run `python scripts/readiness.py --repo <o>/<r> --owner <owner> --markdown`. Add `--create-labels` when labels are missing; that is an authorized setup step. Then add the project's own rows: connectors (Drive, Sheets, Apps Script), secrets, hosting, database and migrations, browser tests, and external APIs and costs.
   - Status per row: `READY`, `NEEDS SETUP`, `BLOCKED`, `NOT REQUIRED` or `UNVERIFIED`. READY needs evidence; a row you could not check is UNVERIFIED.
   - For each row that is not READY, say the issue, the impact, the setup needed, who does it, any safe alternative, and which stage it blocks.
   - Never print a secret value.
3. **Write the plan,** each section tight:
   1. **Business plan:** problem, users, value, scope, out of scope, success metrics, risks, effort estimate.
   2. **Architecture:** components, data flow, schema changes, integration points, migration path, and key decisions with a one-line reason each.
   3. **Task breakdown:** ordered tasks, each with its agent (Code), the files touched and a pass/fail check. Six tasks or fewer; split a bigger request and say so under scope. Then add one line, `Model plan: build <tier>; review <tier> (<reason>); fix <tier>, opus on a second attempt`, from `pick_model.py` run for build, review and fix with the files the tasks touch and `--tasks <n>`. `check_plan.py` requires a tier name here.
   4. **Test plan:** what is tested, with which tooling, what "tests pass" means, and which tests cannot run in a cloud session.
   5. **Merge plan:** branch, merge method (default: merge commit), merge conditions (an approved Lead verdict for the head, green checks), and three lines on their own: `Risk: low|normal|high` (high: the owner merges), `CI required: yes|no`, and `Files in scope: <folders/ and files>`. The scope lists every folder (ending in `/`) or file the tasks touch, plus this plan file, the status document Code updates and, when a screen changes, the screenshots folder. A changed file outside it makes the merge wait for the owner, so keep it real: `*` is refused. Add the **release policy**: `no deploy`, `staging automatic`, or `production after the owner's CONTINUE: release`.
   6. **Readiness:** the matrix, then one short checklist of what the owner must do by hand.
   End the file with the line `AWAITING APPROVAL`. Do not call the workflow fully automated while an essential row is BLOCKED or UNVERIFIED.
4. Run `python scripts/check_plan.py <plan path> --git-base origin/main` and fix it until it passes. Phase 1 changes only the plan file (`post-plan` runs the same check again).
5. Commit once (`Plan: <slug> (awaiting approval)`) and push. On the first plan, open a normal PR, never a draft (REST cannot mark a draft ready). Title: `Plan: <feature> (awaiting approval)`. Body: `Refs #<N>`.
6. Write the reply: the entry's `reply_header`, then 150 words or fewer. Include the plan link, the PR, a 3-line summary, the items that are not READY with the owner's checklist, the assumptions, the `Risk:`, `CI required:` and `Files in scope:` lines from the plan, and the one true `Model:` line. End with: "Reply `APPROVED` (capitals) to build and merge, or `REVISE: <notes>`. Tap Comment, not Close with comment." For a high-risk plan add: "This is high risk, so you merge it at the end."
7. Run `python scripts/loop_gh.py post-plan --repo <o>/<r> --issue <N> --file reply.md --turn <next_turn> --plan-file <plan path> --git-base origin/main --session <this task's model>`. Then verify the hand-off (SKILL.md, step 6) and stop.

**In a chat with the owner:** if no issue exists yet, file one from `references/task-template.md` with `to-code`, then follow the same steps on it (a plan kept in a chat document is posted with `--no-plan-file "<where>"` and the reply links it).
- **Look for what exists before planning anything new.** Search the repo (its folders, specs and docs), its open and merged PRs and its issues for the same subject, with REST (`gh api repos/<o>/<r>/pulls?state=all`, `.../issues?state=all`, `.../contents/`). Say what you found. If a project already covers the request, plan the next slice on it instead of starting a new project, and ask the owner once only when the overlap is unclear. Do this before writing a plan in the chat, not after.
- **Approval in chat:** when the owner's own words start with `APPROVED`, run `python scripts/loop_gh.py relay-approval --repo <o>/<r> --issue <N> --turn <next_turn> --quote "<the owner's exact words>"`. If they wrote anything else ("ok", "approve"), ask them to write `APPROVED`; the script refuses other words. Never from a scheduled run or on your own judgment.
- **High-risk or out-of-scope merge in chat:** when `merge` parked a PR with exit 8 or 9 and the owner's own words in this chat start with `MERGE`, run `python scripts/loop_gh.py merge --repo <o>/<r> --issue <N> --pr <P> --owner-merge-quote "<the owner's exact words>"` (every other gate still applies, and the words go into the merge commit message), then continue with `verify` and the report as `references/autopilot.md` says. Otherwise the owner taps Merge on GitHub and replies `CONTINUE: merged`.

## Review: `review`

You did not build this change. Judge it on evidence, not on Code's claims.

1. Fetch the PR branch and confirm that its head equals the entry's `head`. Then run `python3 scripts/route.py --step review --git-range origin/main...<head> --round <n> --text <issue body file> --declared-risk <the plan's Risk> --session <this task's model>` and read the expert notes it lists. On `delegate`, a subagent with that model reads the diff against the checklist below and drafts `verdict.md`; you confirm the head and a fresh test run, then post. Otherwise review inline.
2. **Scope of the read:**
   - Round 1: the full diff, `git diff origin/main...<head>`.
   - Later rounds: `git diff <since>..<head>` and the findings still open.
   - A high-risk change (route.py says `risk: high`) gets the full checklist on every changed line, in every round.
3. **Checklist, against the approved plan:**
   - Requirements and acceptance criteria covered.
   - Only files the plan lists are changed.
   - Correctness and no regressions.
   - A test for each task, and the tests pass when you run them fresh. When a screen changed, run Playwright at 1280, 768 and 375 px and open the committed screenshots (`references/experts/frontend.md`); cite one per screen.
   - CI state on the head.
   - Security: no secrets, sheet or script IDs, PINs, tokens, e-mail addresses or real staff names, and no access made wider.
   - Database and integration risks.
   - The plan's Status section is updated.
   - The repository's rules are followed.
4. **Write the verdict:**
   - First line: the entry's `reply_header`, with `verdict=approved` or `verdict=changes`.
   - One bullet per finding, tagged `[BLOCKER]`, `[MAJOR]`, `[MINOR]` or `[NIT]`, with file:line, the failure scenario and the fix.
   - Then one line on what you checked, and the test command with its result line.
   - One true `Model:` line (`Model: opus (via subagent)`, or `Model: sonnet (wanted opus; ran inline, no subagent)`). Never claim a model that did not run; `--session` makes the script check it.
   - Last two lines: `Reviewed head <sha>`, then `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`.
   - Approve only with no BLOCKER or MAJOR left and the tests passing. 400 words or fewer.
5. Run `python scripts/loop_gh.py verdict --repo <o>/<r> --issue <N> --pr <P> --file verdict.md --turn <next_turn> --session <this task's model>`. A head mismatch means Code pushed again: review the new head. Then verify the hand-off (SKILL.md, step 6).

## Escalate (park with `--from lead` and one batched question)

- A material change to scope, requirements or architecture.
- A security risk that needs business authorization.
- A mandatory approval that the shared GitHub identity cannot give.
- A destructive operation without safeguards.
- A new subscription or cost.
- A required permission that cannot be obtained.

For each, give the issue, the impact, the evidence, the options, your recommendation and the exact action the owner must take.

## Check the loop (in chat)

List the `awaiting-approval`, `to-review`, `reviewed` and `needs-leo` issues, two lines each. For a merged PR, run `python scripts/loop_gh.py verify --repo <o>/<r> --issue <N> --pr <P>` and report its result. Do not repeat a full investigation that a plan, verdict or summary already recorded. To look for recurring problems, run `python scripts/outcomes.py --repo <o>/<r> --out outcomes.json` and `python scripts/improve.py --input outcomes.json`, and show the owner the proposals; change nothing without their `APPROVED`.
