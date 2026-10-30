# One-time setup (any repository, any account)

Do the steps in order and confirm each "You should see" line before the next. Everything works from a tablet browser. `<o>/<r>` is the repository and `<owner>` the Product Owner's GitHub login. Plan about 40 minutes.

## 1. Install the skill for chat sessions

Scheduled runs read the skill from the repository (step 2), so this step is only for chat and Cowork sessions. Repeat it after every skill change.

1. In a session that has the repository, ask: "Build the github-loop zip and send it to me." It runs `python3 scripts/package.py --out github-loop.zip` and sends the file.
2. Upload that zip as a skill in claude.ai, replacing the old one. Never upload SKILL.md alone: the scripts and references must come with it.

**You should see:** a new chat that uses `/github-loop` runs `python3 scripts/selfcheck.py` and gets `"ok": true`. If it lists `missing` files, or the script is not there, the upload is an old copy: upload the zip again.

## 2. Set up the repository: one command

In a session that has the repository attached (a chat, Cowork or Claude Code on the web), ask: "Set up the github-loop in `<o>/<r>`." It runs, from a full copy of this skill:

```
python3 scripts/init_repo.py --repo <o>/<r> --owner <owner> --owner-name <name> --language <language> --install-skill --install-events --create-labels --prompts
```

It writes `.github/github-loop.json` (the settings), the Autopilot issue form, the event workflow `.github/workflows/loop-fire.yml` and a starter `CLAUDE.md`, copies this skill to `.claude/skills/github-loop/`, creates the labels and prints the Code, Lead and Lead Deep task prompts. A file that already exists is kept (`--force` replaces it), and `--dry-run` shows the plan. Put the new files in a pull request; the skill folder and `.github/` are high risk, so you tap Merge.

- **Settings** (`.github/github-loop.json`, all optional): `owner`, `owner_name`, `language`, `base`, `branch_prefix`, `owner_associations`, `improve` (`scripts/config.py`). An organization repo must set `owner`, and the workflow's `if:` line needs the owner's login (`references/events.md`).
- **Labels** (`readiness.py --create-labels` makes them): `to-code` 0E8A16, `code-working` FBCA04, `awaiting-approval` 5319E7, `to-review` 1D76DB, `reviewed` 0052CC, `needs-leo` D93F0B (this name stays in every repo), `done` 6E7781.

**You should see:** a merged PR with those files and the seven labels under Issues, Labels.

## 3. Protect `main` the loop-compatible way

Settings, Branches: require pull requests and status checks, but do **not** require approvals. Every agent posts as the owner, and GitHub never lets a PR author approve their own PR, so a required-approval rule stops every merge. High-risk and out-of-scope PRs already wait for your Merge tap.

## 4. Create the two scheduled tasks

Settings for each: permission mode "auto", only the Claude Code Remote connector (remove Gmail, Drive and Sheets unless a project needs them), **Sonnet**, and push notifications on, so a failed or silent run reaches your phone. A task set to Opus pays Opus for every step; `scripts/route.py` says when a step needs it (`references/models.md`).

- **Code**: paste the `code` prompt from step 2. Schedule `3 */6 * * *` (every 6 hours).
- **Lead**: paste the `lead` prompt. Schedule `33 */6 * * *`.
- Events start these tasks (step 5). The 6-hour schedule is only the backup that catches a missed event, so it can be slow. Until step 5 passes, you may run both hourly (`3 * * * *` and `33 * * * *`) so the loop keeps moving.
- Both end with exactly "No new work." when idle, pass `--session <model>` to every posting command, and use REST only. The text lives in `references/templates/code-task.md` and `references/templates/lead-task.md`; change a rule there, not in a copy.
- **Lead Deep (optional, only for sensitive work):** an Opus task every two hours (for example `18 */2 * * *`) with the `lead_deep` prompt. It is scheduled only; events do not start it. Only after it exists, add `--max-tier sonnet` to the normal Lead's triage command: opus-tier plans and reviews then wait up to 120 minutes for Lead Deep, and the normal Lead takes them after that and says `wanted opus; ran inline`. A scheduled run showed no subagent use, so this is the dependable way to get Opus.
- **Watchdog:** each task parks the other's work that nobody picked up for 180 minutes, so a silent run shows up as a `needs-leo` issue. Your `CONTINUE:` resumes it.

**You should see:** both tasks in the task list, each with a first run that ends "No new work."

## 5. Connect GitHub events to the tasks

This is what makes the roles start in seconds. Details, the full table and fixes are in `references/events.md`.

1. On the Code task and on the Lead task, add an **API trigger**. Each shows a fire URL and a token (the token appears once).
2. In the repository, Settings, Secrets and variables, Actions, save four repository secrets: `LOOP_LEAD_FIRE_URL`, `LOOP_LEAD_FIRE_TOKEN`, `LOOP_CODE_FIRE_URL`, `LOOP_CODE_FIRE_TOKEN`. Paste each value straight into GitHub, never into a chat, an issue or a file.
3. Actions, **Loop fire**, Run workflow, role `lead`, dry run on. Then dry run off for `lead`, and again for `code`.

**You should see:** the dry run logs `dry run: would fire lead ...`; each real run logs `lead: fired` or `code: fired` and a run appears in the scheduled-task list that ends "No new work.". When both work, the backup schedules from step 4 may stay at every 6 hours.

## 6. Fill in the project's `CLAUDE.md`

Keep it short: what the project is, the test command, the design tokens (colors, fonts, spacing) and the folders the loop may touch. Scheduled runs read it every time. For a web app, also read `references/web-apps.md`.

## 7. Run one small request

1. Issues, New issue, **Autopilot request**. Pick a small change, for example a README. The form applies `to-code`.
2. The Lead run starts by itself and posts a plan, usually within minutes. Read it, then reply `APPROVED` (capitals), or `REVISE: <notes>`. Tap **Comment**, not "Close with comment": closing hides the issue, and triage reopens it only after up to 48 hours.
3. Your `APPROVED` starts Code; Code's result starts the Lead's review; the verdict starts Code again, which merges unless the change is high risk.

**You should see:** the issue labeled `done` and closed, with a five-line summary and a merged PR. If a hand-off does not start the next role, see `references/events.md` ("When something does not start"); if the issue stalls, see `references/runbook.md`.

## 8. Add CI (recommended)

Copy `references/templates/tests.yml` to `.github/workflows/tests.yml` through a PR, add the project's own test command, then require the `test` check on `main`. Write `CI required: yes` in each plan's merge plan; the merge gate then refuses a head with no checks. A workflow change is high risk, so you tap Merge. Whether the session token may push workflow files is UNVERIFIED: if the push is refused, upload the file with GitHub's Add file button.

## 9. Release policy

Each plan states one of these:

| Policy | What happens after the merge |
|---|---|
| `no deploy` | Nothing |
| `staging automatic` | Code deploys through the authorized workflow and verifies the deployment |
| `production after the owner's CONTINUE: release` | Code parks; your reply releases |

- **GitHub Pages:** enable it once in Settings, Pages. The session proxy blocks the Pages API.
- **Apps Script:** deploys stay manual. clasp is not available in cloud runs, and credentials are never committed (`references/experts/appsscript.md`).

## Readiness before a request

Run `python scripts/readiness.py --repo <o>/<r> --markdown` and fix the NEEDS SETUP rows. The Lead repeats it in every plan.

## Facts to keep in mind

- **GitHub access is per repository.** Test a new repository with one run before relying on it.
- **A chat cannot start the tasks; GitHub events do** (step 5). Without them, a hand-off waits for the next backup run.
- **Scheduled Code runs have Playwright and Chromium** preinstalled. On Node 22, `node --test` needs a glob, not a folder.
- **Run logs are not visible from chat.** A run that "succeeded" may have done nothing, so judge by labels and replies.
- **Return path in chat:** say "check the loop".

## Your one-time checklist

- [ ] Merge the setup PR (step 2).
- [ ] Do not turn on "required approvals" for `main` (step 3).
- [ ] Put both loop tasks on Sonnet, with `--session` in their prompts, and push notifications on (step 4).
- [ ] Add the two API triggers and the four secrets, and run the dry run and one real fire (step 5).
- [ ] Try the Autopilot form once, in the browser and on the phone (step 7).
- [ ] Answer issues with **Comment**, not "Close with comment".
- [ ] When a plan deploys: enable GitHub Pages, or keep Apps Script deploys manual.

## Known limits

- **Chat cannot be woken by GitHub.** When you are away, the Lead runs as an event-started task.
- **Timing:** a role starts within about a minute of the event that gives it work, then the run itself takes the time the work takes. If an event is missed, the next 6-hour backup run picks the work up.
- **Rate limits:** the API trigger allows 30 starts per hour per task and 100 per hour per account. A busy day stays far below that.
- **Shared budget:** all scheduled tasks and chat share the account's budget.
- **Escalation by subagent is unproven.** Treat `delegate` as "no subagent" unless a run proves otherwise; the Model line says what really ran.
- **Claims are best effort:** GitHub has no atomic label claim, so two runs in the same second could both claim one issue. One issue per run and the turn rule keep this rare and harmless.
- **Research preview:** scheduled tasks and the API trigger may change.
