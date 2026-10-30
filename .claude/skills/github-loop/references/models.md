# Model routing: the right model for each step

Use the cheapest model that does the step reliably. Move up on **risk**, not on effort, and never skimp on review. The choice comes from `scripts/pick_model.py`, which reads facts (files, goal, attempt, round, the plan's declared risk) and not a feeling, so two runs choose alike. `scripts/route.py` runs it for every thinking step and adds the experts and gates; call `pick_model.py` directly only for merge, verify and report.

```
python3 scripts/pick_model.py --step <plan|revise|build|fix|review|merge|verify|report> \
    [--git-range <base>...<head> | --paths <files>] [--text <issue body file>] \
    [--tasks N] [--attempt N] [--round N] [--declared-risk high] --session <model of this task>
```

`--session` is the model this task runs on: `haiku`, `sonnet` or `opus` (a full ID such as `claude-sonnet-5-5` also works; if unsure, `sonnet`). The reply gives `tier`, `action` (`run inline` or `delegate`), the reason, and the signals it saw. Exit 2 means bad input.

## The rules

| Step | Default | Moves to opus when | Cheaper when |
|---|---|---|---|
| `merge`, `verify` | haiku | never | always: a scripted command and its exit code |
| `report` | sonnet | never | never: it states results as facts |
| `plan`, `revise` | sonnet | the goal names sensitive things (login, permissions, schema, payments, credentials), the goal is architecture-heavy (new system, rewrite), 5 or more tasks, or this is the second revision | never: sonnet is the floor |
| `review` | sonnet | sensitive files changed, 8 or more files, or the third round | never: sonnet is the floor, even for documentation |
| `build` | sonnet | sensitive files **and** a big change | haiku when only `.md`, `.txt` or `.rst` files change |
| `fix` | sonnet | sensitive files, the third review round, or the **second attempt** at the same failure | haiku for documentation only |

Sensitive files: names containing auth, permission, role, acl, secret, token, credential, password, pin, schema, migration, `.sql`, payment, billing, payroll, security, deploy, `.env`; also `.github/`, `appsscript.json`, `.clasp*` and the skill folder itself (`.claude/skills/`). These rules live in `scripts/rules.py`, shared with route.py and the merge gate. Documentation-only changes are never sensitive, except under `.github/` or the skill folder. A plan's `Risk: high` counts as sensitive too.

Only the goal counts for risk words in a request (the Objective section), because the rest of the template holds boilerplate such as "schema changes" and "credentials".

## Who decides

1. **The owner** beats everything: a `Model: opus|sonnet|haiku` line in the request, or the Model field of the issue form (Auto means no override). It applies to plan, revise, build, fix and review, never to merge or verify.
2. **The script** decides the rest. The plan's `Model plan:` line is the Lead's estimate from the request; the run asks again with the real files.
3. A run may go **one tier up** from the script's answer with its reason written in the reply. It never goes down, and it never uses `fable`, the top tier, which only the owner asks for.

## Using the answer

- **`run inline`:** do the step on this task's model. If the tier is lower than the task's, still run inline: a subagent restarts cold and costs more than it saves. The task's own model sets the cost.
- **`delegate`:** the tier is above this task's model. Hand the **judgment** to a subagent (Agent tool, `model` set to the tier) and keep the scripts, the checks and the posting in this session. Give the subagent only what it needs:

  > You are doing one step of the github-loop for `<o>/<r>`, issue #N: `<step>`. Work in `<dir>` on branch `<branch>`. Read only `<files>`. Deliverable: write `<file>` as `<format from lead.md or autopilot.md>`. Do not post to GitHub, change labels, merge or push. Reply with the file path and the test result line.

  Then verify its work yourself: for a review, `git rev-parse` must equal the head Code named, and the tests must have run fresh; run `check_reply.py` or `check_plan.py`; post with the `loop_gh.py` command.
- **No Agent tool in this session:** run the step inline and use the `inline` model line, which names what was wanted. For a sensitive review, the owner can say "review the PR" in a chat on Opus.
- **Say what ran:** put exactly one line `Model: <haiku|sonnet|opus>` in a plan, phase 2 result, verdict and summary, naming the model that produced the judgment. `pick_model.py` prints the true line in `model_line`: `Model: opus (via subagent)` when a subagent did it, or `Model: sonnet (wanted opus; ran inline, no subagent)` when the step wanted more than this task has. `check_reply.py` rejects a missing or doubled line, and a "wanted" tier that does not say how the gap was handled. With `--session <this task's model>` on the posting command, it also rejects a line that names another model without `via subagent`, so a Sonnet task cannot claim an Opus review. Never claim a model that did not run.

## Recommended task setup

Put both scheduled tasks on **Sonnet**: triage costs almost nothing and Sonnet is the workhorse for builds and reviews. Opus is then used only where the rules above say so. A task whose own model is Opus pays Opus for every step, even when the script says sonnet (`run inline` never goes down), so routing saves nothing there. The skill cannot change a task's own model: ask Claude in chat to change it, and write the task's model into its prompt (`--session sonnet`) so the Model line is checked.

**Is it applied?** Check three things: the task's model in its settings, `--session` in the task prompt, and the `Model:` lines on recent issues (`scripts/outcomes.py` collects them; `scripts/improve.py` proposes a fix when steps keep wanting a stronger tier).

## Two Lead tasks (optional): how sensitive work reaches Opus

A scheduled run showed no subagent use, so a Sonnet Lead cannot reliably hand a review to Opus. Triage routes by tier instead:

| Task | Triage flags | Takes |
|---|---|---|
| Lead (Sonnet, started by events) | `--role lead --max-tier sonnet` | Work whose tier is sonnet or lower. Opus-tier work waits in `deferred`. |
| Lead Deep (Opus, scheduled every 2 hours; events do not start it) | `--role lead --min-tier opus` | Only opus-tier work: sensitive files or goal words, 8 or more files, an architecture-heavy goal, the third round, the second revision, or Leo's `Model: opus`. |

- Each work entry carries `tier` and `tier_reason`, an estimate from the request and the PR's file list (one extra call, review and fix only). The step still runs `pick_model.py` with the real diff, and that answer wins.
- **No deadlock:** after `--defer-minutes` (default 120) the normal Lead takes deferred work anyway. The entry then has a `tier_note`, and the Model line must say `wanted opus; ran inline`. If Lead Deep does not exist, leave `--max-tier` off.
- The owner's `Model:` override feeds the same estimate, so `Model: opus` sends a request to Lead Deep and `Model: sonnet` keeps it on the normal Lead.

## Known limits

- Whether a scheduled cloud run can start subagents is **UNVERIFIED**, and the one live run did not use any. Without them, the fallback above keeps the loop working on the task's model, and the Model line says so.
- The script sees file names and the goal, not hidden complexity. That is why a run may go one tier up, and why review never drops below sonnet.
