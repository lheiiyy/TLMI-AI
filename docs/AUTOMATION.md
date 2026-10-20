# Autonomous development: audit and design

**Status:** proposal, written by the Reviewer on 2026-10-21. Nothing described here as "proposed" is switched on. Each rollout phase starts only after Leo approves it (section 10).

**Question asked by Leo (2026-10-21):** can Cowork (the Reviewer) and Claude Code (Code) hand work to each other through GitHub without Leo relaying messages, with a reconciliation check about every 5 minutes, while Leo keeps the business, security and LIVE decisions?

**Short answer:** yes for the hand-offs, but not with a 5-minute poll. The reliable design is event-driven: each agent wakes the other directly when it hands over, GitHub holds all state, and one hourly check repairs anything that got stuck. A 5-minute poll is either session-bound, best-effort or over the free GitHub Actions budget (section 6).

## 1. Answers to the seven questions

| # | Question | Answer | Evidence |
| --- | --- | --- | --- |
| 1 | Is there an exact 5-minute scheduler in Cowork? | No. Cloud scheduled tasks run at most once an hour. The in-session timer can run every few minutes but only while one session is alive and idle, and it is lost on a restart. A one-shot reminder can be chained, but it arrives 11 seconds to 6 minutes late. | V7, V9, V10 |
| 2 | Can GitHub reliably start Claude Code on "issue assigned", "task ready", "PR updated" or "CI failed"? | Not as the system stands. Cloud-task GitHub triggers cover pull request and release events only (no issues, no comments, no CI results), need the Claude GitHub App, and drop events above an hourly cap. The GitHub Action for Claude covers all four events but needs the App, a token stored as a repository secret, and Actions minutes. Neither is set up: no workflow uses the Action and no task has a GitHub trigger. | V4, V17, V19, N11 |
| 3 | How can Cowork and Code exchange work without a manual relay? | GitHub is the shared record (issues, labels, pull requests, comments). The hand-off itself is a direct wake: the agent that hands over fires the other agent's cloud task, with a short hint naming the item. The woken agent reads the state from GitHub, never from the hint. | V8 (Cowork side tested); N2 (Code side to test in the pilot) |
| 4 | Should the 5-minute reconciliation be a GitHub Actions schedule or a persistent worker? | Neither. An Actions schedule every 5 minutes bills at least 8,640 minutes a month against 2,000 free minutes, is best-effort, and needs a stored token to wake an agent. A persistent worker needs a machine and stored credentials. Use event wakes for speed and the existing hourly cloud task for repair. | V14, V15, section 6 |
| 5 | How are duplicates, conflicts, repeated failures and endless retries prevented? | One baton label per item (only its holder acts), a lease label with a claim comment, the head commit as the idempotency key, a re-read before every post, attempt caps, a "no change, no hand-off" rule, a kill switch, and the platform's hourly caps. | section 5 |
| 6 | Credentials, permissions, branch protection, tests, security escalation? | The design adds no new secret. Both agents act as Leo's GitHub user through Anthropic's proxy, so a label or comment can never prove that Leo acted; Leo's merge click is the gate for every halt. `main` has no protection, and a private repository on GitHub Free cannot have it, so "never push to `main`" rests on instructions and platform guards until Leo decides (B1). Tests gate approval by rule; a planned CI guard step and the `needs:leo` label enforce escalation. | V1, V13, section 7 |
| 7 | Which operations run on their own and which halt? | Section 8 lists both. In short: building, testing, reviewing and docs run on their own; merging, LIVE, `clasp`, secrets, access, roles, deletion, workflow and `CLAUDE.md` changes halt for Leo. | section 8 |

## 2. Audit of the current state

Checked from the Reviewer's session on 2026-10-20 between 19:00 and 20:40 UTC (2026-10-21 03:00 to 04:40 Manila time). Each item is in exactly one class.

### 2.1 VERIFIED

| ID | Finding | Evidence |
| --- | --- | --- |
| V1 | The repository is private; the default branch is `main`; `main` is not protected. Rulesets cannot be used on this plan. | `GET /repos/.../branches/main` returns `"protected": false`. `GET /repos/.../rulesets` returns 403 "Upgrade to GitHub Pro or make this repository public to enable this feature." |
| V2 | Merge commits and squash merges are allowed; auto-merge is off; branches are not deleted on merge. | `GET /repos/...`: `allow_merge_commit: true`, `allow_auto_merge: false`, `delete_branch_on_merge: false`. |
| V3 | No issues exist and only GitHub's default labels exist. | `GET /repos/.../issues?state=all` has no issues; the label list holds only the defaults. |
| V4 | One workflow, `tests` (`.github/workflows/test.yml`): runs on every pull request and on pushes to `main`; `GITHUB_TOKEN` is read-only (`contents: read`); one job: `npm ci`, `npm test`, `npm run build`, Playwright. It has no `concurrency` and no `timeout-minutes`. | The workflow file on `main`. |
| V5 | Ten workflow runs exist. A run takes 66 seconds to 9 minutes (docs-only runs about 1.5 minutes; the push to `main` after PR #7 6.5 minutes; PR #8 about 9 minutes). | `GET /repos/.../actions/runs`, start and end times. |
| V6 | One run failed on a docs-only commit (run 39481209264, PR #9, 2026-10-20 19:10 UTC); the next commits passed. A flaky browser test is the likely cause. | Run list. The log could not be read from this session (proxy 403), so the cause is N8. |
| V7 | A cloud scheduled task cannot run more often than once an hour. | A more frequent schedule was rejected when the Reviewer's task was created; the Claude Code documentation states "The minimum interval is one hour". |
| V8 | The Reviewer's cloud task, "TLMI-AI: review Claude Code's pull requests", runs hourly at minute 46 UTC on Sonnet 5.5, with automatic approval and push notifications to Leo. Its last scheduled run (19:46) started at 19:47:35 and succeeded. The Reviewer's live session fired it on demand at 20:34:07; the run was created within a second and recorded as succeeded at 20:34:30. | `list_triggers` (`last_run`), `fire_trigger` result. The work done inside the 20:34 run was not inspected (N7). |
| V9 | The live session's 4-minute check (`CronCreate`) works only while that session is alive and idle; it was lost on two session restarts; recurring jobs of this kind expire after 7 days. | Observed twice in this session; tool description. |
| V10 | One-shot reminders into a session (`send_later`) survive restarts. Eight past reminders arrived 11 s, 26 s, 30 s, 36 s, 38 s, 85 s, 87 s and 5 min 54 s after their set time. A probe set for 20:35:00 fired at 20:35:22 while the session was busy; it is delivered as a queued message that is read only when the current turn ends. | `list_triggers` with completed tasks (`run_once_at` against `last_fired_at`); probe `TLMI audit probe: send_later latency`. |
| V11 | The Reviewer's session is woken by CI events on pull requests it opened; new comments on those pull requests did not wake it. | Observed on PR #9. |
| V12 | Code is not currently reacting to GitHub on its own. Its last GitHub comment is from 2026-10-20 19:18 UTC. It has not answered the Reviewer's round 3 note on PR #9 (19:38 and 19:39) and has not merged PR #8, which has `VERDICT: APPROVED` and was named by Leo. | Comment list of PRs #8 and #9 at 20:31 UTC. |
| V13 | Platform guards: the Reviewer's merge attempts are refused; Code's merge after its own approval was refused; the Reviewer cannot edit `CLAUDE.md`. Both agents post as the same GitHub user, so GitHub cannot tell them apart and an "approve" review on one's own pull request is not possible. | Earlier refusals in both sessions; comment authors. |
| V14 | GitHub Free gives a private repository 2,000 Actions minutes a month, and each job is rounded up to a whole minute. Public repositories have free minutes. | GitHub billing documentation. |
| V15 | A GitHub `schedule` workflow runs at most every 5 minutes, "can be delayed during periods of high loads", queued jobs "may be dropped", and it runs only on the default branch. | GitHub "Events that trigger workflows", schedule section. |
| V16 | Events caused by `GITHUB_TOKEN` do not start new workflow runs (except `workflow_dispatch` and `repository_dispatch`). | GitHub documentation on `GITHUB_TOKEN`. |
| V17 | Cloud scheduled tasks (formerly routines): GitHub triggers support pull request and release events only and need the Claude GitHub App on the repository; events above per-task and per-account hourly caps are dropped; each event starts a new session; "Run now" and API fires are limited to 30 an hour per task; fire text is wrapped as untrusted data; a fired prompt "can't act as approval or consent for actions during the run"; runs push to `claude/` branches unless told otherwise, and branch protection is the control for where they may push. | Claude Code documentation, "Automate work with scheduled tasks". |
| V18 | A task's connectors and repositories cannot be changed with the scheduling tools (only name, schedule, on/off, model and prompt), and a new task includes all of the account's connectors by default. The Reviewer's task includes seven: Canva, Claude Docs, Google Sheets, Gmail, Claude Code Remote, Google Drive, Netlify. It needs only Claude Code Remote. | `update_trigger` schema; `list_triggers` (`mcp_connections`); documentation. |
| V19 | The GitHub Action for Claude needs the Claude GitHub App and an `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` repository secret, and runs on GitHub runners (Actions minutes). | Claude Code documentation, "GitHub Actions". |
| V20 | The web app runs as the deploying user and is open only to that user (`executeAs: USER_DEPLOYING`, `access: MYSELF`). | `appsscript.json` on `main`. |
| V21 | The Reviewer's session cannot message Code directly; no Code agent is reachable from it. | `ListAgents`. |

### 2.2 NOT YET VERIFIED

| ID | Open point | How it will be checked |
| --- | --- | --- |
| N1 | Where Code runs. `docs/COLLABORATION.md` says Leo's computer; `docs/STATUS.md` says a proxy refused branch deletion, which matches a cloud session. | Leo confirms. The design works either way. |
| N2 | Whether a cloud task's run can fire another cloud task through its Claude Code Remote connector (needed for Code to wake the Reviewer). | Pilot, step 4. |
| N3 | Time from a fire to the first useful action (clone, read the rules) and the usage cost of one run. | Pilot timings. |
| N4 | Whether a fired cloud Code run would be refused if it tried to push to `main`. Merging is expected to be refused (V13, V17). | Not tested on purpose: testing it risks the thing it tests. Closed by B1 instead. |
| N5 | Delay of cloud-task GitHub triggers. | Only if Phase 5 is approved. |
| N6 | Actions minutes used this month. | Leo: GitHub, Settings, Billing and plans. |
| N7 | What the 20:34 run of the Reviewer's task actually did (it ended 23 seconds after the fire). | Leo can open it from claude.ai/code (scheduled task history). |
| N8 | Cause of the failed run 39481209264. | Pilot task. |
| N9 | Whether the repository has any Actions secrets. | Leo: Settings, Secrets and variables, Actions (expected: none). |
| N11 | Whether the Claude GitHub App is installed on the account (the installations list cannot be read from this session). | Leo: GitHub, Settings, Applications. Not needed by the recommended design. |

### 2.3 NOT IMPLEMENTED

- Issues as work items, the label protocol, an issue template.
- A cloud task for Code, and Code waking the Reviewer.
- Reconciliation logic (stale batons, stuck leases) in the hourly task.
- A kill switch.
- CI guard step (secret and ID scan, protected paths), a `main` push alarm, `concurrency` and `timeout-minutes` in `tests`.
- Removing unneeded connectors from the Reviewer's task.
- Branch protection on `main`.

### 2.4 BLOCKED — DECISION REQUIRED (Leo)

| ID | Item | Options |
| --- | --- | --- |
| B1 | `main` cannot be protected on a private repository under GitHub Free (V1). | (a) Upgrade the account to GitHub Pro and protect `main`: pull request required, `tests` must pass, no force push, no deletion. **Recommended.** (b) Make the repository public: free protection and free minutes, but the code and business rules become public. Not recommended. (c) Keep it unprotected and add only the `main` push alarm (detection, not prevention). |
| B2 | A cloud task for Code would build and push branches as Leo's GitHub user with no person approving each step. This widens what runs without Leo. | Approve for the pilot only, then for Phase 2 building; or keep Code as today (started by Leo). |
| B3 | Connectors are removed only in the web page of the task (V18). | Leo removes all connectors except Claude Code Remote from the Reviewer's task now, and from the Code task when it is created. |
| B4 | Merge path. A fired run carries no word from Leo (V17), so "Leo names the pull request in the Code session" cannot work unattended. | Leo merges by clicking Merge on GitHub after `VERDICT: APPROVED` and green tests (one tap from the GitHub app). `CLAUDE.md` and `docs/COLLABORATION.md` are updated to say so; Leo or Code edits `CLAUDE.md` (the Reviewer cannot). |

## 3. Recommended architecture

```mermaid
flowchart LR
  subgraph GitHub["GitHub: the only shared state"]
    I["Issue: task spec"] --> P["Pull request"]
    P --> CI["tests workflow"]
    L[("Labels: baton, lease, needs:leo, paused")]
  end
  R["Reviewer (Cowork)<br/>live session + hourly cloud task"]
  C["Code (builder)<br/>cloud task, fired on demand"]
  Leo([Leo])
  R -- "opens issue, sets agent:code" --> I
  R -- "fire: item + head" --> C
  C -- "branch, commits, PR, waits for CI" --> P
  C -- "sets agent:reviewer, fire" --> R
  R -- "review, VERDICT, sets agent:leo" --> P
  Leo -- "Merge, needs:leo answers, LIVE" --> P
  R -. "hourly: repair stuck items" .-> L
```

Principles:

1. **GitHub is the single source of truth.** Every decision, finding and hand-off is an issue, a label, a commit or a comment. Sessions hold no state that matters.
2. **Wake, do not poll.** The agent that hands over wakes the other one with `fire_trigger`. The wake text is only a hint; the woken agent re-reads GitHub and acts only if the labels agree.
3. **One baton per item.** Exactly one of `agent:code`, `agent:reviewer`, `agent:leo` is on an open item. Only its holder acts.
4. **Idempotent by head commit.** Each action records the head commit it covers (`Reviewed head <sha>`, `Code: built head <sha>`). An agent that finds its action already recorded for the current head does nothing.
5. **CI inside the run.** Code waits for the `tests` result of its own push inside the same run (about 1.5 to 9 minutes, V5), so no CI event is needed.
6. **Repair, not speed, is hourly.** The existing hourly task finds stuck items and re-fires once. Speed comes from the wakes.
7. **People keep the gates.** Merge, LIVE, `clasp`, secrets, access and roles stay with Leo (section 8).

Wake paths:

| Event | Who wakes | How | Expected delay |
| --- | --- | --- | --- |
| Task ready (issue gets `status:ready` + `agent:code`) | Code | Reviewer fires the Code task | about 1 s to start (V8), plus start-up (N3) |
| Code's pull request ready, question or blocked | Reviewer | Code fires the Reviewer task (N2) | same |
| Review done with changes requested | Code | Reviewer fires the Code task | same |
| CI finished on Code's push | Code (already running) | Code waits for the check in the same run | 1.5 to 9 min (V5) |
| Approved and green | Leo | `agent:leo`; the Reviewer task's push notification; GitHub's own notification | when Leo looks |
| Leo comments or changes a label | the baton holder | Leo tells the live session, or the hourly task picks it up | up to 60 min |
| Anything stuck | the baton holder | hourly task re-fires once, then escalates | up to 60 min |

## 4. Responsibilities

| Party | Does | Does not |
| --- | --- | --- |
| **Cowork, the Reviewer (head)**: the live claude.ai session when Leo is present; the cloud task "TLMI-AI: review Claude Code's pull requests" otherwise | Plans and sets priorities; writes specs, plans and task issues; decides spec, plan, design and business-rule questions within Leo's decisions; reviews each pull request and gives the `VERDICT`; writes docs; keeps TDMS alignment across modules; product-level review; fires Code; runs the hourly repair | Write application code; merge; touch LIVE; add secrets; widen access |
| **Code (builder)**: a fire-only cloud task (new, B2); Leo's own Claude Code session for `clasp` to DEV and TEST and for the TEST smoke test | Claims an item; investigates the repository; builds with tests first; debugs; runs the tests; waits for and fixes CI; opens and updates pull requests; posts `Code: TECHNICAL REVIEW` on the Reviewer's pull requests; updates `docs/STATUS.md`; fires the Reviewer | Decide an open rule (asks with `Code: QUESTION`); merge; push to `main`; deploy; edit workflows or `CLAUDE.md` without `needs:leo` |
| **GitHub** | Holds the issues, labels, pull requests and comments; runs `tests`; notifies Leo | Wake an agent (nothing in GitHub calls the agents in this design) |
| **Leo** | Answers B1 to B4; merges; answers every `needs:leo` item; owns LIVE and `clasp`; can pause everything | Relay messages between the agents |

The two agents do not repeat each other's work. Code builds and proves; the Reviewer judges. The Reviewer uses the CI result for the exact head commit as its fresh test run, and runs the tests itself only when CI is missing or red for that head, or when a screen changed (to look at screenshots at 1280, 768 and 375 pixels).

## 5. Coordination protocol

### 5.1 Work items

Each unit of work is a GitHub issue written by the Reviewer from the approved spec and plan. One issue becomes one pull request. The issue body follows this template:

```
Goal: one sentence.
Source: spec section(s) and plan task number(s).
Files expected: paths.
Done when: the tests that must exist and pass; the checks in CLAUDE.md that apply.
Out of scope: what must not change.
Halts: any item from docs/AUTOMATION.md section 8 that this work touches (then the issue also gets needs:leo).
```

### 5.2 Labels

| Label | Meaning | Set by |
| --- | --- | --- |
| `status:ready` | The issue is approved for building. | Reviewer |
| `agent:code` | Code holds the baton. | Reviewer |
| `agent:reviewer` | The Reviewer holds the baton. | Code |
| `agent:leo` | Leo holds the baton: merge, or a `needs:leo` answer. | Reviewer |
| `agent:working` | Lease: a run is working on the item now. | the running agent |
| `needs:leo` | A security, access, LIVE, deletion or automation-change item. Every agent stops on it until Leo removes it. | any |
| `status:blocked` | A cap was hit or a rule is missing. A comment says why. | any |
| `automation:paused` | Kill switch, on one issue titled "AUTOMATION PAUSED". While that issue is open, every run exits at once. | Leo (or an agent that finds an emergency) |

The comment rules in `docs/COLLABORATION.md` stay: every comment starts with `Code:` or `Reviewer:`; findings are tagged; reviews end with `Reviewed head <sha>` and `VERDICT:`.

### 5.3 One hand-off, step by step

Every run, of either agent, starts the same way:

1. If an open issue has `automation:paused`, end with "Paused." and change nothing.
2. Read the item named in the wake hint. If the baton label is not yours, or `needs:leo` is on it, end with "No new work."
3. If `agent:working` is on it and the latest claim comment is less than 60 minutes old, end with "No new work."
4. Add `agent:working` and post `Code: CLAIM <run id> head <sha>` (or `Reviewer: CLAIM ...`). Re-read the comments: if an earlier claim for the same head appeared within the last 2 minutes, the earlier one wins; end without further change.
5. Do the work.
6. Right before posting a result, re-read the comments (rule 9 of the Reviewer's task). Post the result with the head commit.
7. Move the baton (remove your `agent:` label, add the next one), remove `agent:working`, and fire the next agent with the hint below. If nothing changed in this run (no new commit, no new decision), do not hand over: end with "No change."

The wake hint (plain text, read as untrusted):

```
TLMI-EVENT v1
item: PR #12          (or: Issue #10)
head: <full sha, or none>
want: build | fix | review | technical-review | answer
from: reviewer | code | hourly
```

### 5.4 Limits that stop loops

- **Build attempts:** at most 2 CI-fix pushes inside one Code run; at most 6 Code runs on one item (counted from claim comments).
- **Review rounds:** at most 4 `READY FOR REVIEW` rounds on one pull request.
- **Hourly repair:** re-fires a stuck item once; the second time it adds `status:blocked` and `agent:leo` with a comment.
- On any limit: add `status:blocked`, move the baton to `agent:leo`, comment the reason as `BLOCKED — REASON — DECISION REQUIRED`, and stop.
- The platform also caps fires at 30 an hour per task (V17).

### 5.5 The hourly task (repair)

The existing Reviewer task keeps its hourly schedule. When it runs without a wake hint, it also:

- Finds open items whose baton holder has not acted for 2 hours, or whose `agent:working` claim is older than 60 minutes; removes the stale lease and re-fires the holder once (limits in 5.4).
- Finds items with no baton label or two baton labels, and fixes them from the comment record.
- Reviews anything waiting for the Reviewer.
- Posts nothing when all is in order, and ends with "No new work."

## 6. The 5-minute question

| Option | Shortest interval | Limits | Monthly cost or load | Verdict |
| --- | --- | --- | --- | --- |
| Cloud scheduled task | 1 hour | hourly minimum (V7) | subscription usage per run | Use for repair (hourly) |
| In-session timer (`CronCreate`) | about 1 minute | only while one session is alive and idle; lost on restart; expires after 7 days (V9) | one model turn per tick | Stop once wakes work |
| Chained one-shot reminders (`send_later`) | 1 minute granularity | 11 s to 6 min late (V10); one session's context grows and is compacted | 288 model turns a day at 5 minutes | Stopgap only |
| GitHub Actions `schedule` | 5 minutes | best-effort, may be delayed or dropped, default branch only (V15); needs a task API token stored as a repository secret to wake an agent | at least 8,640 billed minutes a month at 5 minutes (12 an hour, each rounded up to 1 minute) against 2,000 free (V14); 1,440 at 30 minutes | Not feasible on this plan |
| Persistent worker (a VM or Leo's computer) | any | a machine to run and patch; stored credentials; Leo's computer sleeps | hosting cost | Not recommended |
| **Direct wake on hand-off (recommended)** | none needed | 30 fires an hour per task (V17); Code-side wake to be proven (N2) | one run per real hand-off | Use for every hand-off |

So no exact 5-minute loop is available, and none is needed: a hand-off reaches the other agent in seconds instead of up to 5 minutes, and nothing runs when nothing happens.

## 7. Permissions, credentials and security controls

**Identity.** Both agents act as Leo's GitHub user through Anthropic's git proxy. No personal access token, GitHub App token or API token is stored in GitHub or in the repository by this design. The wake uses the account's own `fire_trigger` tool, not the HTTP fire endpoint, so no fire token exists to leak.

**One GitHub user for three parties.** GitHub cannot tell Leo, the Reviewer and Code apart (V13). A label or a comment therefore never proves that Leo acted, and no design here treats one as Leo's approval. The acts that only Leo can do are the ones the platform keeps for a person: clicking Merge, his own words in a session, and the settings pages (billing, protection, connectors, Apps). Every halt in section 8 ends at one of these.

**Least privilege.**

- Each cloud task keeps only the Claude Code Remote connector (B3). It needs no Google, mail or hosting connector.
- The cloud environment keeps the default "Trusted" network allowlist; the agents need only GitHub and the npm registry.
- `GITHUB_TOKEN` in workflows stays `contents: read`.
- `clasp` credentials, Script Properties, sheet IDs and the Admin PIN never enter a cloud task. `clasp` runs only in Leo's own session, to DEV and TEST.

**Branch protection (B1).** With GitHub Pro: protect `main` with "require a pull request", "require status check `tests`", "block force pushes" and "restrict deletions". Until then, three layers apply: the instruction in every prompt, the platform guards (V13), and the `main` push alarm below.

**CI guard step (to be built by Code in Phase 3, reviewed by the Reviewer, merged by Leo).** Added to the `tests` job, so no extra job minutes:

1. Fails if the diff adds a `.clasprc.json`, a Google sheet or script ID pattern, a spreadsheet or script URL, an e-mail address outside an allow list of invented test addresses, or a token pattern. Invented test-only values stay allowed where a comment says so (Phase 1 rule).
2. Writes a "needs Leo" notice in the run summary when the diff touches `CLAUDE.md`, `.github/`, `appsscript.json` (web app access and run-as), the permission table, or `tools/` deploy scripts. It does not fail the run (a label cannot prove Leo cleared it); instead the Reviewer adds `needs:leo`, its `VERDICT` names the item for Leo, and Leo decides by merging or not.
3. `concurrency: { group: tests-${{ github.ref }}, cancel-in-progress: true }` and `timeout-minutes: 20`, to stop paying for superseded runs.

**`main` push alarm.** A workflow on `push` to `main` that fails, and so e-mails Leo through GitHub's failed-run notice (on by default), when the pushed commit is not the merge of a pull request that carries `VERDICT: APPROVED`.

**Escalation is enforced, not only written.** An item that touches a halt area gets `needs:leo` from the issue template, from the guard step, or from either agent; every run exits on that label; the Reviewer does not approve while it is present; and only Leo merges.

**Kill switch.** Leo opens an issue titled "AUTOMATION PAUSED" with the label `automation:paused`, from the GitHub app. Every run checks it first. Turning the two cloud tasks off at claude.ai/code/routines is the second switch.

## 8. Autonomous or halt

| Runs on its own | Halts for Leo (`needs:leo` or `agent:leo`) |
| --- | --- |
| Creating, labelling and commenting on issues | Merging any pull request into `main` |
| Branches, commits and pushes to feature and docs branches | Pushing to `main`; force push; deleting a branch that is not merged |
| Opening and updating pull requests | Anything on LIVE; `clasp` push (Leo's session only, DEV and TEST); Script Properties |
| Running unit and browser tests; fixing a red CI run within the limits | Adding or changing a secret, token or credential; installing a GitHub App |
| Code's technical review of the Reviewer's pull requests | Repository visibility, collaborators, branch protection, billing |
| The Reviewer's review and `VERDICT` on Code's pull requests | Widening a role, the permission table or the web app access (`appsscript.json`) |
| The Reviewer's answers to `Code: QUESTION` on spec, plan, design and business rules within Leo's decisions | A business decision Leo has kept, or one that changes a decision he made |
| Docs, specs and plans on branches | Deleting data or history; anything touching real staff data |
| Re-firing a stuck item once | Changes to `CLAUDE.md`, `.github/` workflows or this automation |
| | Any limit in 5.4 reached |

## 9. Recovery

| Situation | What happens |
| --- | --- |
| Stop everything | Leo opens "AUTOMATION PAUSED"; resume by closing it. |
| A run failed (not "succeeded" in the task history) | The hourly task re-fires once; then `status:blocked`. |
| An item is stuck (no action for 2 hours) or a lease is older than 60 minutes | The hourly task clears the lease and re-fires once; then `status:blocked`. |
| CI stays red after 2 fixes in a run | Code posts `BLOCKED`, sets `status:blocked`, hands the baton to the Reviewer, who decides or escalates. |
| Two comments for the same head | Harmless: the earlier one counts; nothing is deleted. |
| A commit reached `main` without an approved pull request | The alarm fails; Leo decides; Code prepares a revert pull request. No force push. |
| Usage limit reached | Runs are refused until the window resets; the hourly task picks the items up again. |
| A session restarts | Nothing is lost: all state is on GitHub. |

## 10. Rollout phases

| Phase | Content | Acceptance | Rollback |
| --- | --- | --- | --- |
| 0. Audit (this pull request) | This document | Leo has answered B1 to B4 | Close the pull request |
| 1. Protocol | Labels created; the "AUTOMATION PAUSED" issue created and closed; the task prompts kept as files in `docs/automation/` so every change is reviewed in a pull request; Reviewer task prompt rewritten for wake hints, the start checks in 5.3 and the repair in 5.5; Leo removes connectors (B3); `docs/COLLABORATION.md` points to this document | The labels exist; one hourly run and one fired run both end "No new work." with nothing posted; a run while the pause issue is open ends "Paused." | Delete the labels; set the previous prompt file version back on the task |
| 2. Pilot (needs B2) | One fire-only Code task; one real task handled end to end (section 11) | Section 11 pass criteria | Turn the Code task off; close the pilot issue |
| 3. Guards | Code builds the guard step, the `main` alarm and the CI settings in section 7 (with `needs:leo`) | A test pull request with an invented sheet-ID pattern fails; one touching `CLAUDE.md` shows the "needs Leo" notice; superseded runs are cancelled | Revert the workflow pull request |
| 4. Steady state | Phase 2 pull requests E to H run through the protocol; the live session's 4-minute timer is stopped | PR E goes from issue to `VERDICT: APPROVED` with no relay by Leo; no duplicate verdicts; no push to `main` | Pause; return to Leo-started Code |
| 5. Optional | Claude GitHub App and a pull-request label trigger, so Leo's own labels wake an agent at once | Only if Leo wants faster than hourly reaction to his own actions | Remove the trigger and the App |

## 11. Pilot

**Task:** "Make the browser tests stable on docs-only commits" (failed run 39481209264, N8). It is real, small, inside Code's area (`tests/`), touches no halt area, and exercises the CI-wait and retry limits.

**Steps and measurements** (times from the GitHub record and the task history):

1. t0: the Reviewer opens the issue with the template, `status:ready` and `agent:code`, and fires the Code task.
2. t1: Code's claim comment appears (measures wake and start-up, N3).
3. t2: Code pushes a branch and opens a pull request; t3: the CI result for that head; Code fixes red runs within the limits.
4. t4: Code moves the baton to `agent:reviewer` and fires the Reviewer task; t5: the Reviewer's claim (proves N2).
5. t6: the Reviewer's `VERDICT`. On changes requested, steps 2 to 6 repeat.
6. t7: approved and green; baton `agent:leo`; Leo merges.
7. Kill-switch check: Leo opens "AUTOMATION PAUSED", the Reviewer fires the Code task once, Code must end "Paused." with no change; Leo closes the issue.

**Pass:** no message relayed by Leo between t0 and t6; each wake (t0 to t1, t4 to t5) under 5 minutes; exactly one claim and one result per head; labels always show one baton; no push to `main`; no secret or ID in any diff; the kill switch works; the flaky test passes 10 full runs in a row (`npx playwright test --repeat-each=10` locally) and CI is green.

**Abort:** any push to `main`, any secret or ID in a diff, two runs acting on the same head, or a limit in 5.4 hit twice. Then the Code task is turned off and the findings are written here.

## 12. Sources

- Claude Code documentation: "Automate work with scheduled tasks" (code.claude.com/docs/en/routines), "Claude Code GitHub Actions" (code.claude.com/docs/en/github-actions), "Run prompts on a schedule" (code.claude.com/docs/en/scheduled-tasks).
- GitHub documentation: "Events that trigger workflows" (schedule, workflow_dispatch, repository_dispatch), "Automatic token authentication" (`GITHUB_TOKEN` events), "About billing for GitHub Actions" (included minutes), "Actions runner pricing" ("GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute").
- Repository API responses and task history listed in section 2, read on 2026-10-20 between 19:00 and 20:40 UTC.
