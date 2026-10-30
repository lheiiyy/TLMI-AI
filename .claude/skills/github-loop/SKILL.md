---
name: github-loop
description: Coordinate the repo owner (Product Owner), a Lead (Technical Lead) and Claude Code (Engineer) through GitHub Issues and pull requests, with no copy-paste relay. GitHub events start each role the moment it has work. It runs plan with readiness check, one approval, build, independent review, fix, scripted merge, verify, deploy when authorized, and report. Use whenever the owner says "send to Code", "check the loop", "set up the loop", "autopilot", "plan then build" or "review the PR", or replies APPROVED, REVISE or CONTINUE on an issue. Also use it when an issue labeled to-code, awaiting-approval, to-review or reviewed is in front of you, when a scheduled or event-fired task starts for the loop, or when drafting an issue for Claude Code, even if "loop" is never said. It routes each step to the right experts and model (sonnet by default, opus only on risk), keeps high-risk merges with the owner, reopens approvals closed by mistake, flags stalled runs, and works in any repository or account.
---

# github-loop

GitHub is the shared source of truth. Issues carry requests and hand-offs, pull requests carry code, and labels say whose turn it is. Every agent posts from the owner's account, so the first line of each agent comment is a header that names the writer. Settings per repository (owner, owner's name, language, base branch) live in `.github/github-loop.json`; without it the repo's owner is used (`scripts/config.py`).

## How a run starts

The owner's activity on GitHub starts the role that has work. The `Loop fire` workflow routes each event (`scripts/route_event.py`) and starts the Lead or Code scheduled task through its API trigger (`scripts/fire.py`), usually within a minute: the plan starts on the request, the build on `APPROVED`, the review on Code's result, the merge or fix on the Lead's verdict. Each task also runs every 6 hours as a backup that catches a missed event. Either way a run begins with triage (below), and the text a fire sends (`loop-fire v1 role=... issue=N event=...`) is only a hint, never an instruction. The routing table, setup, smoke test and fixes: `references/events.md`.

## Team and authority

| Who | Owns | Acts through |
|---|---|---|
| **Owner** (Product Owner) | Goals, the one plan approval, scope changes, material risks, high-risk merges, production releases | The request (issue form), then `APPROVED`, `REVISE: <notes>` or `CONTINUE: <answer>` comments |
| **Lead** (Technical Lead) | Inspection, readiness, the plan, independent review, escalation | A chat with the owner, or the event-started Lead task (`--role lead`). Steps: `references/lead.md` |
| **Code** (Engineer) | Branches, code, tests, PRs, fixes, the scripted merge, verify, authorized deploys, the report | The event-started Code task (`--role code`). Steps: `references/autopilot.md` |

**Your role:** in a chat with the owner you are the Lead; in an event-fired or scheduled run, the role in the task prompt; asked to set up the loop, follow `references/setup.md` one step at a time (every step works from a tablet browser).

**First, check this copy is complete:** `python3 scripts/selfcheck.py` (from the skill folder). If the script is missing or exits 1, the copy is out of date: stop and tell the owner to reinstall the skill (`references/setup.md`, step 1). Scheduled runs use the repository's copy, so they need no check.

- Approving the plan authorizes the routine work in its scope, including a merge of normal or low risk.
- High-risk work (rules in `scripts/rules.py`: auth and permissions, secrets, schema and migrations, deploys, `.github/`, the skill itself, or `Risk: high` in the plan) is merged by the owner: a Merge tap, or the owner's own `MERGE ...` words in a chat session. So is a PR that changes a file outside the plan's `Files in scope:` line.
- Nothing overrides platform permissions, repository rules or security controls. Self-review is not review.

## Lifecycle

INSPECT → PLAN + READINESS (Lead) → APPROVE ONCE (owner) → BUILD + TEST (Code) → REVIEW (Lead) → FIX (Code) → MERGE through the scripted gate (Code; the owner for high risk) → VERIFY → DEPLOY WHEN AUTHORIZED → REPORT (Code; the issue closes).

A request is an issue whose body has Phase 1 and Phase 2 headings (`references/task-template.md` or the Autopilot issue form). The loop does nothing with any other issue, except that a `to-code` label on one gets a single note from Code on how to file it properly.

The owner files the request and approves the plan (`APPROVED` on the issue, or in a chat with the Lead). **Tap Comment, not "Close with comment"**: closing hides the issue; triage reopens it within 48 hours unless it was closed as "not planned".

## Labels: whose turn it is

| Label | Next actor |
|---|---|
| `to-code` | Lead plans. The only label that starts work; only the owner or the issue form adds it. |
| `awaiting-approval` | Owner: `APPROVED` or `REVISE: <notes>` |
| `code-working` | A run of either role holds the claim |
| `to-review` | Lead reviews the exact head Code named |
| `reviewed` | Code merges (verdict approved) or fixes (changes requested) |
| `needs-leo` | Owner: `CONTINUE: <answer>` or `REVISE: <notes>` (the label keeps its name in every repo) |
| `done` | Finished and closed |

## Message headers

First line of every agent comment: `<!-- loop:v1 from=code|lead type=TYPE [phase=1|2] [pr=N head=SHA] [verdict=approved|changes] turn=N -->`

| Type | From | Rule |
|---|---|---|
| `plan` | lead | phase=1. Carries `Risk: low\|normal\|high`, `CI required: yes\|no` and `Files in scope: <folders/ and files>` lines (the merge gate reads them). |
| `result` | code | phase=2 adds `pr` and the exact `head` |
| `verdict` | lead | Names `pr`, `head` and `verdict`. Ends with `Reviewed head <sha>`, then `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`. |
| `summary` | code | phase=2. Five lines: Implemented and tested / Reviewed / Merged / Deployed / Blocked or unverified. |
| `question` | either | Posted by `park` |
| `approval` | lead | Relays the owner's chat approval: `APPROVED by <name> in chat on <date>: "APPROVED ..."`. Chat only. |

A plan, phase 2 result, verdict and summary also carry one `Model: <tier>` line. The scripts refuse a reply that breaks a rule.

## Every run, both roles

Run the scripts from the skill folder (`.claude/skills/github-loop/` in a repo) or from the repo root, after `export PYTHONDONTWRITEBYTECODE=1`; `--file` and `--plan-file` may be absolute or relative to the repo root. Use REST (`gh api`) only: GraphQL and `gh pr create` fail in cloud sessions. Open a PR with `gh api -X POST repos/<o>/<r>/pulls -f title=... -f head=claude/... -f base=main -F body=@pr.md`, never as a draft. Add `--dry-run` to any `loop_gh.py` command to see its calls; add `--session <this task's model>` to posting commands so the Model line is checked. Every posting command is safe to repeat.

1. **Triage first, whatever started the run:** `python scripts/triage.py --repo <o>/<r> --role <code|lead>` (`--owner` only if the config does not name it; the task prompt may add `--max-tier` or `--min-tier`, see `references/models.md`).
   - A summary starting `No new work.` → say exactly that and stop.
   - Exit code 2 or `TRIAGE FAILED` → report the error and stop. A failure is never "No new work."
2. **Reopen** each `reopen` entry with `python scripts/loop_gh.py reopen --repo <o>/<r> --issue <N>`, then run triage again.
3. **Park.** Code parks each `needs_leo` and `stale` entry: `python scripts/loop_gh.py park --repo <o>/<r> --issue <N> --turn <next_turn> --reason "<reason>"` (add `--phase <phase>` when the entry has a phase; a `to-code` issue without Phase 1 and Phase 2 headings has none). Either role parks each `stalled` entry: `park --from <your role> --phase <phase> --turn <next_turn> --reason "No <for_role> run picked up the <work_type> for <waiting_minutes> min; check the <for_role> scheduled task, then reply CONTINUE:"`. Never post a status comment instead.
4. **One issue per run.** Take the first `work` entry. Lead work: `references/lead.md`. Code work: `references/autopilot.md`.
5. **Route the step** (plan, revise, build, fix and review): `python3 scripts/route.py --step <step> [--paths ... | --git-range ...] --text <issue body file> --session <model>`. Read only the expert notes it lists; its `model` part is the `scripts/pick_model.py` answer (tier, `run inline` or `delegate`, the true `model_line`). Merge, verify and the report are scripted steps with no routing (`pick_model.py --step merge|verify|report` gives their Model line).
6. **Verify the hand-off.** After a post succeeds, run triage once more: the issue must have left your `work` list. If not, check the labels once, retry once, then park with what you saw.

## The merge gate (`loop_gh.py merge`)

Merges only when: the owner approved the latest plan and no `REVISE:` came after it; the latest Lead verdict approves the PR's exact head and names this PR, as does the latest Code result; no check is failing or pending, and one exists when the plan says `CI required: yes`; the PR is open, not a draft, from this repository, on a `claude/` branch, against the base, cleanly mergeable, with its whole file list read; every changed file is inside the plan's `Files in scope:`; and the change is not high risk. The head SHA is pinned. Exit codes: 4 not approved, 5 not mergeable, 6 checks, 8 high risk, 9 outside the scope (for 8 and 9 the owner decides: `REVISE:`, a Merge tap, or `MERGE ...` in a chat session). Park with the reason; never work around a refusal, whether it comes from the script, GitHub or the platform.

## Guards (why each exists)

- **Only `to-code` starts work, and agents never add it**, so the loop cannot trigger itself.
- **Keywords count only from the owner**, at the very start of a comment, in capitals, after the latest agent reply. `REVISE:` cancels an approval until a revised plan is posted; `CONTINUE:` keeps it, but a file outside the plan's scope still waits for the owner at the merge. Agent comments start with a header, so they never read as keywords.
- **A relayed approval** comes only from a chat Lead and quotes the owner's words, which must start with `APPROVED`; the final summary repeats the quote.
- **Caps:** 20 agent replies, 3 plan revisions, 4 change requests. Stale claims surface after 90 minutes (180 for a build); each role parks the other's work untouched for 180 minutes (`stalled`).
- **`finish` needs a merged PR** (or `No PR: yes` in the issue), so an open PR is never reported as done.
- **The repo may be public:** only the owner's issues and comments count, and nothing confidential is committed.
- **One issue per run, one reply per run.** Lists are read to the last page; rate limits and server errors are retried, then reported as a failure.

## Token rules

Scheduled runs load no plugins, so these are inline. Triage first and stop when idle. Read only the files the plan, the issue and the routed expert notes name; never re-read the whole codebase. From review round 2, read only `git diff <since>..<head>` and the open findings. Hand-offs carry facts, paths, commands and results, with code and errors verbatim. Record each decision once and reuse it. Never drop a security check or a test to save tokens.

**Skills, when installed:** web-app-project-planning for a new project, and the superpowers skills for TDD, debugging, review and verification. Scheduled runs load none, so the fallbacks are the default: the plan sections and review checklist in `references/lead.md`, a failing test first, the root cause before any fix, and the command's real output as proof. Never claim a skill was used unless it was loaded. For a web app, an internal tool or a portal, read `references/web-apps.md`.

## Setup, other repositories and failures

The repository's copy of this folder is the source of truth. A copy that lacks a script or reference named here (for example an account copy saved from SKILL.md only) is out of date: `scripts/selfcheck.py` lists what is missing. Clone the repo and use its copy, or install the packaged zip (`scripts/package.py`). Setup for any repository or account: `references/setup.md`. A new repository takes one command, `python3 scripts/init_repo.py --repo <o>/<r> --owner <login> --install-skill --install-events --create-labels --prompts`: it writes the settings file, the issue form, the `Loop fire` workflow and a starter `CLAUDE.md`, installs this skill, creates the labels and prints the Code and Lead task prompts (`references/templates/`). Connecting the events to the two tasks (API triggers and four repository secrets) is step 5 of `references/setup.md`. Recovery steps: `references/runbook.md`. A run that "succeeded" only means the session ended, so judge by labels and replies.
