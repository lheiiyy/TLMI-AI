# Events: how a run starts

A GitHub event starts the role that has work, within seconds. A slow backup run (every 6 hours) catches an event that was missed. The role never trusts what started it: it runs triage and reads GitHub itself.

```
owner comments / labels / opens an issue
  -> workflow "Loop fire"            runs only for the owner's own activity
  -> scripts/route_event.py          decides lead, code, both or nobody; holds no secret, prints no comment text
  -> scripts/fire.py                 the only code that reads the four fire values; posts one fixed line
  -> the role's API trigger          starts the Lead or Code scheduled task
  -> triage.py                       decides what work exists (references/autopilot.md or lead.md)
```

## What starts whom

| Event (owner only) | Starts |
|---|---|
| New issue, or `to-code` added, with Phase 1 and Phase 2 headings | Lead (plan) |
| New issue, or `to-code` added, without those headings | Code (parks it once with a note on how to file) |
| Comment starting `APPROVED` | Code (build) |
| Comment starting `REVISE:` | Lead (revised plan) |
| Comment starting `CONTINUE:` | Lead and Code (triage hands the work to the right one) |
| Agent comment `from=lead type=approval` (a chat approval relayed to the issue) | Code |
| Agent comment `from=code type=result phase=2` (the PR is ready) | Lead (review) |
| Agent comment `from=lead type=verdict` | Code (merge or fix) |
| Any other comment or header, a comment on a PR, a bot or non-owner | Nobody |

The table is `KEYWORD_ROLES` and `HEADER_ROLES` in `scripts/route_event.py`; `evals/test_route_event.py` replays each row.

A normal request runs as a chain of events: you file it, the Lead plans, you reply `APPROVED`, Code builds and posts its result, the Lead reviews, Code merges and reports. Each hand-off starts the next role within about a minute plus the run itself, so the wait is the work, not a schedule. High-risk work still ends with your Merge tap.

## What is sent

Only this fixed line: `loop-fire v1 role=<role> issue=<N> event=<event name>`. Nothing from an issue or comment is ever copied into it. The task prompts tell the run to ignore it (`references/templates/code-task.md`, `lead-task.md`), so it is a label for you in the run list, never an instruction.

## Setup

The ordered steps are in `references/setup.md` (step 5). In short:

1. Install the workflow: `init_repo.py ... --install-events` writes `.github/workflows/loop-fire.yml` from `references/templates/loop-fire.yml`. The two files must stay identical (a test checks it). The workflow is high risk, so you tap Merge.
2. On each of the Lead and Code scheduled tasks, add an **API trigger** (claude.ai, Code, Scheduled tasks). It shows a fire URL and a token. The token is shown once.
3. Save four repository secrets (GitHub, Settings, Secrets and variables, Actions): `LOOP_LEAD_FIRE_URL`, `LOOP_LEAD_FIRE_TOKEN`, `LOOP_CODE_FIRE_URL`, `LOOP_CODE_FIRE_TOKEN`. Paste each value straight into GitHub; never into a chat, an issue, a file or a comment.
4. Put the two scheduled tasks on a 6-hour cron (Code `3 */6 * * *`, Lead `33 */6 * * *`) once the smoke test below passes. Until then leave the old schedule as it is.

## Smoke test (three steps, in this order)

1. **Dry run.** Actions, Loop fire, Run workflow, role `lead`, dry run on. The log says `dry run: would fire lead with text 'loop-fire v1 ...'` and fires nothing. This proves the workflow, the router and the script run.
2. **One real fire.** Run it again with dry run off. A Lead run appears in the scheduled-task list and ends "No new work." This proves the secrets and the trigger. Repeat for `code`.
3. **A live request.** File a small request with the Autopilot form. The Lead run starts within a minute and posts a plan. Reply `APPROVED` and watch Code start the same way.

## When something does not start

| Symptom | Cause and fix |
|---|---|
| The workflow run is skipped | The actor is not the owner (an organization repo needs the owner's login in the workflow's `if:`), or the event was not one in the table |
| The log says "fire secrets are not set up yet, skipped" | A role's two secrets are missing. Add them. The role still runs at the next 6-hour backup |
| `only one of the two fire secrets is set` | One of the pair is missing or blank. Save both again |
| `the fire URL is not an api.anthropic.com routine fire URL` | The URL secret was pasted wrong. Paste the trigger's fire URL again |
| `fire failed (401)` or `(403)` | The token is wrong or was regenerated. Create a new token on the trigger and save it |
| `fire failed (429)` | Rate limit (30 per hour per task, 100 per hour per account). The 6-hour backup catches the rest |
| The run started but did nothing | Judge by labels and replies, not by "succeeded" (`references/runbook.md`) |
| Nothing at all after 6 hours | The backup task is paused or deleted. Check the scheduled-task list |

The workflow's output never contains a URL, a token, a header or a response body, so a log can be shared.

## Why this is safe to leave on

- It runs only when `github.actor` is the repository owner, and the router again requires the issue author, the comment author and (for a manual run) the sender to be the owner. A stranger's issue or comment on a public repo starts nothing.
- It has no `pull_request` or `pull_request_target` trigger, so a pull request cannot run workflow code or reach the secrets. `issue_comment` runs the default branch's copy.
- Permissions are `contents: read`; the one action it uses is pinned to a commit; the secrets are visible to the fire step only; the fire URL must match `https://api.anthropic.com/v1/claude_code/routines/trig_.../fire` or the script refuses.
- Comment text is parsed, never printed, and never reaches a shell: the `run:` lines hold no `${{ }}` expression.
- It cannot run away: agents post as you, so their comments are told apart by the header on the first line, and only the three header rows above start anyone. The existing caps still bound a back-and-forth (20 agent replies, 3 plan revisions, 4 change requests per issue).

## Limits

- **Research preview.** The API trigger header (`anthropic-beta: experimental-cc-routine-2026-04-01`) can change. If a fire starts failing after a platform change, the 6-hour backup keeps the loop alive; update `scripts/fire.py`.
- **Two fires for one issue.** Creating an issue with the form can raise both an opened and a labeled event. The second run normally finds the issue claimed and ends "No new work.", and the turn rule refuses a duplicate plan.
- **A finished check is not an event.** If Code reaches the merge while a check is still pending, `merge` exits 6 and Code parks. Reply `CONTINUE:` (it starts both roles) or wait for the next backup run.
- **Lead Deep stays scheduled** (every 2 hours, optional). Events do not start it; opus-tier plans and reviews wait for it as before (`references/models.md`).
- **Rollback** is disabling or deleting the workflow. The 6-hour tasks keep working; set their cron back to hourly if you want the old cadence.
