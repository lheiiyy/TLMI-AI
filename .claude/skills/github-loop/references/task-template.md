# Autopilot request template (the owner's)

File it with the **Autopilot request** issue form (Issues → New issue), which applies `to-code` for you. Or paste it into a new issue, fill every `[PLACEHOLDER]`, and add the `to-code` label. The Lead (Claude Cowork) answers with a plan and a readiness matrix within minutes (the event trigger starts it; at worst the 6-hour backup run does); Claude Code builds after approval, the Lead reviews, and Code merges and reports. Reply `APPROVED` (capitals) to build and merge, `REVISE: <notes>` to change the plan, or `CONTINUE: <answer>` to answer a question. High-risk work (login, permissions, secrets, schema, deploys, workflows, the loop's own skill) waits for your Merge tap at the end. Tap **Comment**, not "Close with comment". A request that changes no code says `No PR: yes` in its body.

The `## Phase 1` and `## Phase 2` headings are what switch the loop into autopilot mode, so keep them.

```markdown
## Objective
Take this automation from business plan to merged, tested code in two phases, with one approval gate between them: [AUTOMATION GOAL, one sentence].

## Context
- Project: [PROJECT NAME], repo: [REPO NAME].
- Stack: [STACK, e.g. Frontend → service/API layer → Google Apps Script → Google Sheets, kept migration-ready for a REST backend and database].
- Users: [WHO USES IT]. Must work on desktop, tablet and phone.
- Release policy: [no deploy | staging automatic | production after my CONTINUE: release].
Model: auto
(Leave "Model: auto" and the loop picks sonnet or opus per step by risk. Write `Model: opus`, `Model: sonnet` or `Model: haiku` on its own line only to force one.)
- The repository is the source of truth. Read the existing docs first and don't re-read the whole codebase.

## Phase 1: Plan (do this first, then stop)
Write docs/plan-[FEATURE].md (inside the project folder) with these sections, each kept tight:
1. Business plan: problem, users, value, scope, out-of-scope, success metrics, risks, effort estimate.
2. Architecture: components, data flow, schema changes, integration points, migration path, key decisions with one-line reasons.
3. Task breakdown: ordered tasks, each with the responsible agent, the files touched and a pass/fail check.
4. Test plan: what gets tested, with which tooling, and what "tests pass" means.
5. Merge plan: branch name, merge method, the conditions for merging, the release policy, and three lines of their own: `Risk: low|normal|high`, `CI required: yes|no` and `Files in scope: <folders/ and files>`.
6. Readiness: READY / NEEDS SETUP / BLOCKED / NOT REQUIRED / UNVERIFIED for every dependency, and one checklist of what I must do by hand.
End the file with the line "AWAITING APPROVAL". Make no code changes in Phase 1.

## Phase 2: Build, test, debug, merge (only after I reply "APPROVED")
The approved plan authorizes everything in it, including the merge.
1. Create a feature branch. Implement the tasks in order, one commit per task.
2. Set up the test harness from the test plan, write the tests, run them.
3. Debug failures: find the root cause before fixing, fix the cause and not the symptom, then re-run.
4. The Lead reviews the exact head independently; Code fixes until the verdict is APPROVED.
5. When every acceptance criterion passes, merge to the main branch using the plan's merge method, verify the merge, and deploy only as the release policy says. Update the project docs with status, decisions and test results.

## Constraints
- Repo identity gate: confirm the repo and project match [REPO NAME] before any change. If they don't, stop.
- Do only what the approved plan says. No extra features, files or dependencies.
- Never commit secrets (API keys, clasp credentials, tokens). Assume authentication is already set up.
- Never force-push, rewrite history, or delete files or data outside the plan.
- Keep docs short and structured. Report only at checkpoints.

## Stop and ask when
- Anything must change outside the approved plan (scope, schema, architecture).
- A fix needs a new dependency or external service.
- The same error survives 2 fix attempts.
- A merge conflict touches files outside the plan.

## Acceptance Criteria
- [ ] The plan file existed and was approved before any code was written
- [ ] All planned tests ran and passed, with the output shown
- [ ] Merged to main with a clean working tree
- [ ] Docs updated with status, decisions and test results
- [ ] Final summary lists every file changed and the test results

## Progress Evidence
Back every completion claim with a command output or a changed file.
```
