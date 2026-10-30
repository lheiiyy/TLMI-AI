# Runbook: when something goes wrong

Each fix keeps the GitHub record readable by the scripts. Never edit or delete an agent comment to "fix" state; post through `scripts/loop_gh.py`.

| Symptom | What happened | Fix |
|---|---|---|
| Issue stuck on `code-working`, no new comment | A run crashed after claiming | Triage lists it as `stale` after 90 min (180 for a build) and Code parks it. The owner replies `CONTINUE:` to retry. |
| `needs-leo` with "No ... run picked up" | The other role's scheduled task did not run | Check that task is enabled and its last run; then reply `CONTINUE:`. |
| `finish` exited 2 after posting | A label call failed | Run the same `finish` again: the summary is not posted twice, and the labels and close are completed. |
| `finish` exit 7 | The PR is not merged, or a no-PR issue lacks `No PR: yes` | Merge first (or park); add `No PR: yes` to the issue only when no code change was intended. |
| `merge` exit 4 | No current approval, a `REVISE:` after it, or no verdict for this head and PR | Follow the reason: wait for the owner, or send the PR back to review with `ready-for-review`. |
| `merge` exit 5 | Draft, conflicts, fork, wrong branch or base, or an incomplete file list | Fix the branch (merge `origin/main` into it), then re-run; a fork PR is never merged. |
| `merge` exit 6 | A check failed or is pending, or CI is required and none ran | Fix the cause or wait for the check; never merge around it. |
| `merge` exit 8 | High risk: the owner merges | Park with "High-risk PR ready: tap Merge, then reply CONTINUE: merged", or the owner says `MERGE ...` in a chat session and the session runs `merge --owner-merge-quote "<the owner's words>"`. |
| `merge` exit 9 | A changed file is outside the plan's `Files in scope:` (or the plan has no such line) | Park with the files it names. The owner replies `REVISE:` to widen the plan, taps Merge, or says `MERGE ...` in a chat session. |
| A merged change is wrong | Bad merge | Open the PR on GitHub and use **Revert**; that opens a revert PR. File a new request for the real fix. |
| The skill itself misbehaves | A bad skill version | Roll back: open a PR that restores `.claude/skills/github-loop/` from the last good tag (`git checkout <tag> -- .claude/skills/github-loop`). Tags are named `github-loop-<date>`, one per `CHANGELOG.md` entry. |
| Triage says `TRIAGE FAILED` | Token, network or `gh` problem | Read the error; a failure is never an idle queue. Fix access, then let the next run continue. |
