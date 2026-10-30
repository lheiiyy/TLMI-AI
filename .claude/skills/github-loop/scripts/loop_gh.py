#!/usr/bin/env python3
"""The loop agents' GitHub writes, as validated commands (REST only, no GraphQL).

Lead (Cowork or a chat session, Technical Lead):
    loop_gh.py post-plan      --repo o/r --issue N --file plan-reply.md --turn T --plan-file <plan.md>
    loop_gh.py verdict        --repo o/r --issue N --pr P --file verdict.md --turn T
    loop_gh.py relay-approval --repo o/r --issue N --turn T --quote "APPROVED ..."   (chat only)
Code (Claude Code, Engineer):
    loop_gh.py ready-for-review --repo o/r --issue N --pr P --file result.md --turn T
    loop_gh.py merge   --repo o/r --issue N --pr P [--method merge] [--require-checks]
    loop_gh.py verify  --repo o/r --issue N --pr P
    loop_gh.py finish  --repo o/r --issue N --pr P --file summary.md --turn T
Either role:
    loop_gh.py claim   --repo o/r --issue N
    loop_gh.py reopen  --repo o/r --issue N
    loop_gh.py park    --repo o/r --issue N --turn T --reason "..." [--phase 1|2] [--from code|lead]

claim             adds code-working (the claim label for either role) and removes the waiting
                  labels that are present. Refuses (exit 3) if code-working is already there.
                  GitHub has no compare-and-set for labels, so two runs in the same second could
                  both claim; staggered schedules and one issue per run keep that rare.
post-plan         Phase 1: runs check_plan.py on --plan-file (and, with --git-base, checks that
                  the plan is the only changed file), then posts a type=plan phase=1 reply;
                  label awaiting-approval. --no-plan-file "<where>" is for a plan kept outside
                  the repo (a chat document); the reply must then link it.
relay-approval    posts `APPROVED by <owner> in chat on <date>: "<quote>"` for a chat Lead whose
                  conversation holds that approval. The quote must start with APPROVED.
                  Never from a scheduled run.
ready-for-review  posts a type=result phase=2 reply naming pr and the PR's CURRENT head;
                  label to-review.
verdict           posts the Lead's review verdict for the PR's CURRENT head; label reviewed.
merge             merges ONLY when (1) the owner approved the latest plan and no REVISE: came
                  after it (exit 4), (2) the latest Lead verdict approves exactly the PR's head
                  and names this PR, and the latest Code result names it too (exit 4), (3) no
                  check run or commit status on that head is failing or pending, and at least one
                  exists when the plan says `CI required: yes` or --require-checks is given
                  (exit 6), (4) the PR is open, not a draft, from this repository (never a fork),
                  on a claude/ branch, against the base, cleanly mergeable, and its whole file
                  list was read (exit 5), (5) every changed file is inside the plan's
                  `Files in scope:` (exit 9), and (6) the change is not high risk (exit 8): a
                  sensitive file, the skill itself, or `Risk: high` in the plan. A PR that fails
                  (5) or (6) is merged by the owner: a Merge tap on GitHub, or --owner-merge-quote
                  with the owner's own words from a chat session, starting with MERGE (recorded in
                  the merge commit message). The head SHA is pinned, so nothing pushed later
                  slips in.
verify            after a merge: the PR is merged, the merge commit is on the base branch, and
                  the check runs on the merge commit are reported (exit 7 if not merged or
                  not on the base).
finish            checks that the PR is merged (--pr), or that the issue says `No PR: yes`
                  (exit 7), and that a relayed approval's quote is in the summary (exit 1); then
                  posts a type=summary phase=2 reply with the five report lines, adds done and
                  closes the issue as completed.
park              posts a short question; labels needs-leo. The owner answers with CONTINUE: or
                  REVISE:.
reopen            reopens an issue that the owner closed by tapping "Close with comment" together
                  with APPROVED, REVISE: or CONTINUE: (triage lists it under `reopen`). Refuses an
                  issue that is `done` or was closed as "not planned". Posts nothing.

Every posting command is safe to run again: a reply whose header (from, type, turn and, for a
result or verdict, the head) is already on the issue is not posted twice, and the labels are then
brought up to date. No command can add to-code. --session <model> makes the Model line name the
model this task runs on. --dry-run prints the planned writes without sending them (reads still
happen, except the duplicate-post check when no --fixtures are given; --fixtures DIR replaces
the reads with issue.json, comments.json, pr.json, files.json, checks.json, status.json,
compare.json and repo.json for offline tests).
The owner is --owner, else "owner" in .github/github-loop.json, else the user who owns the repo.
Exit codes: 0 ok, 1 reply failed validation, 2 GitHub call failed, 3 already claimed,
4 not approved, 5 PR not mergeable, 6 checks not green, 7 not merged or no PR, 8 high risk:
the owner merges, 9 a changed file outside the plan's scope: the owner decides.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as loop_config  # noqa: E402
from check_plan import changed_files_from_git, check as check_plan  # noqa: E402
from check_reply import check  # noqa: E402
from ghapi import ApiError, call, from_fixture, get_all, get_json  # noqa: E402
from loop_guard import (approval_status, first_header, plan_facts, review_status,  # noqa: E402
                        set_owner_associations)
from rules import outside_scope, risk_tier, scope_problems  # noqa: E402

GhError = ApiError  # older name, kept for callers
WAITING =["to-code", "awaiting-approval", "needs-leo", "to-review", "reviewed"]
GOOD = {"success", "neutral", "skipped"}
NO_PR = re.compile(r"(?im)^[ \t>*-]*No PR[ \t]*:[ \t]*\**[ \t]*yes\b")


def gh(args, dry_run, plan, tolerate_404=False, retry=True):
    plan.append("gh api " + " ".join(args))
    if dry_run:
        return ""
    try:
        return call(args, retry=retry)
    except ApiError as e:
        msg = str(e).lower()
        if tolerate_404 and ("404" in msg or "not found" in msg or "does not exist" in msg):
            return ""
        raise


def read_json(path, fixtures, name, default=None):
    """A read is never skipped by --dry-run; --fixtures replaces the network."""
    return from_fixture(fixtures, name, default) if fixtures else get_json(path)


def read_list(path, fixtures, name, default=None, key=None):
    """Every page of a list (or one fixture file)."""
    if fixtures:
        data = from_fixture(fixtures, name, default)
        return data.get(key, []) if key and isinstance(data, dict) else data
    return get_all(path, key)


def add_label(repo, issue, label, dry_run, plan):
    gh(["-X", "POST", f"repos/{repo}/issues/{issue}/labels", "-f", f"labels[]={label}"], dry_run, plan)


def remove_labels(repo, issue, labels, dry_run, plan):
    for label in labels:
        gh(["-X", "DELETE", f"repos/{repo}/issues/{issue}/labels/{label}"], dry_run, plan, tolerate_404=True)


def comments_of(a):
    return read_list(f"repos/{a.repo}/issues/{a.issue}/comments", a.fixtures, "comments.json", default=[])


def already_posted(a, fields):
    """True when a comment with the same header (from, type, turn, and head if any) is on the issue."""
    if a.dry_run and not a.fixtures:
        return False  # a dry run without fixtures plans the post and skips this read
    keys = ("from", "type", "turn", "head")
    want = {k: fields.get(k) for k in keys}
    for c in comments_of(a):
        h = first_header(c.get("body") or "")
        if h and {k: h.get(k) for k in keys} == want:
            return True
    return False


def post_file(a, path, fields, plan):
    """Post once: a retry after a partial failure never posts the same reply twice."""
    if already_posted(a, fields):
        return False
    gh(["-X", "POST", f"repos/{a.repo}/issues/{a.issue}/comments", "-F", f"body=@{path}"], a.dry_run, plan,
       retry=False)
    return True


def post_text(a, body, fields, plan):
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(body)
        path = f.name
    try:
        return post_file(a, path, fields, plan)
    finally:
        os.unlink(path)


def read_reply(a, add, want_type, expect_from, want_phase=None):
    with open(a.file, encoding="utf-8") as f:
        text = f.read()
    report = check(text, a.turn, [add] if add else None, ["code-working"], expect_from=expect_from,
                   session=getattr(a, "session", None))
    if report["ok"] and want_type and report["type"] != want_type:
        report["ok"] = False
        report["problems"].append(f"this command posts a type={want_type} reply, found type={report['type']}")
    if report["ok"] and want_phase and report["fields"].get("phase") != want_phase:
        report["ok"] = False
        report["problems"].append(f"this command posts a phase={want_phase} reply")
    report["text"] = text
    return report


def pr_head(a):
    pr = read_json(f"repos/{a.repo}/pulls/{a.pr}", getattr(a, "fixtures", None), "pr.json")
    return pr, (pr.get("head") or {}).get("sha")


def deliver(a, plan, report, add, remove):
    """Post the checked reply once, then set the labels (both steps are safe to repeat)."""
    posted = post_file(a, a.file, report["fields"], plan)
    remove_labels(a.repo, a.issue, remove, a.dry_run, plan)
    add_label(a.repo, a.issue, add, a.dry_run, plan)
    out = {k: v for k, v in report.items() if k != "text"}
    out.update(posted=a.issue, label=add)
    if not posted:
        out["already_posted"] = True
    return out


def cmd_claim(a, plan):
    present = WAITING
    if not a.dry_run:
        raw = gh([f"repos/{a.repo}/issues/{a.issue}", "--jq", "[.labels[].name]"], False, plan)
        labels = json.loads(raw or "[]")
        if "code-working" in labels:
            return 3, {"ok": False, "problem": "already claimed (code-working is set); do nothing"}
        present = [lbl for lbl in WAITING if lbl in labels]
    add_label(a.repo, a.issue, "code-working", a.dry_run, plan)
    remove_labels(a.repo, a.issue, present, a.dry_run, plan)
    return 0, {"ok": True, "claimed": a.issue}


def plan_file_problems(a):
    """check_plan.py on the plan file, and with --git-base, the Phase 1 'plan only' rule."""
    if a.plan_file and a.no_plan_file:
        return ["pass --plan-file or --no-plan-file, not both"]
    if not a.plan_file:
        if not (a.no_plan_file or "").strip():
            return ['pass --plan-file <docs/plan-x.md> (or --no-plan-file "<where the plan is>" for a plan kept '
                    "outside the repo)"]
        return []
    try:
        with open(a.plan_file, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return [f"plan file not found: {a.plan_file} (give a path from the repository root, or an absolute path)"]
    plan_rel, changed = os.path.normpath(a.plan_file), None
    if a.git_base and a.git_base != "none":
        try:
            top, changed = changed_files_from_git(a.git_base)
        except RuntimeError as e:
            return [str(e)]
        plan_rel = os.path.relpath(os.path.abspath(a.plan_file), top)
    return [f"plan file: {p}" for p in check_plan(text, plan_rel, changed)["problems"]]


def cmd_post_plan(a, plan):
    problems = plan_file_problems(a)
    if problems:
        return 1, {"ok": False, "problems": problems}
    report = read_reply(a, "awaiting-approval", "plan", a.sender)
    if report["ok"] and a.no_plan_file and "http" not in report["text"]:
        report.update(ok=False, problems=["the plan is kept outside the repo, so the reply must link it"])
    if not report["ok"]:
        report.pop("text", None)
        return 1, report
    return 0, deliver(a, plan, report, "awaiting-approval", ["code-working", "to-code", "needs-leo"])


def cmd_ready_for_review(a, plan):
    report = read_reply(a, "to-review", "result", "code", want_phase="2")
    if not report["ok"]:
        report.pop("text", None)
        return 1, report
    _, head = pr_head(a)
    f = report["fields"]
    if f.get("pr") != str(a.pr) or f.get("head") != head:
        problem = f"header must name pr={a.pr} head={head} (the PR's current head)"
        return 1, {"ok": False, "fields": f, "problems": [problem]}
    return 0, deliver(a, plan, report, "to-review", ["code-working", "awaiting-approval", "needs-leo", "reviewed"])


def cmd_verdict(a, plan):
    report = read_reply(a, "reviewed", "verdict", "lead")
    if not report["ok"]:
        report.pop("text", None)
        return 1, report
    _, head = pr_head(a)
    f = report["fields"]
    if f.get("pr") != str(a.pr) or f.get("head") != head:
        problem = f"the verdict must name pr={a.pr} head={head}; the PR moved, so review the new head"
        return 1, {"ok": False, "fields": f, "problems": [problem]}
    out = deliver(a, plan, report, "reviewed", ["code-working", "to-review"])
    return 0, dict(out, verdict=f.get("verdict"))


def cmd_relay_approval(a, plan):
    quote = " ".join(a.quote.split())
    if not quote.startswith("APPROVED"):
        return 1, {"ok": False, "problems": ["relay only the owner's own words, and only when they start with "
                                             "APPROVED (capitals); otherwise ask the owner to write APPROVED"]}
    name = a.owner_name or a.owner or "the owner"
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    body = (f"<!-- loop:v1 from=lead type=approval turn={a.turn} -->\n"
            f"APPROVED by {name} in chat on {today}: “{quote}”\n")
    report = check(body, a.turn, None, None, expect_from="lead")
    if not report["ok"]:
        return 1, report
    posted = post_text(a, body, report["fields"], plan)
    return 0, {"ok": True, "relayed": a.issue, "comment": body, "already_posted": not posted}


def issue_with_comments(a):
    issue = read_json(f"repos/{a.repo}/issues/{a.issue}", a.fixtures, "issue.json")
    issue["comments"] = comments_of(a)
    return issue


def cmd_finish(a, plan):
    report = read_reply(a, "done", "summary", "code")
    if not report["ok"]:
        report.pop("text", None)
        return 1, report
    issue = issue_with_comments(a)
    if a.pr:
        pr = read_json(f"repos/{a.repo}/pulls/{a.pr}", a.fixtures, "pr.json")
        if not pr.get("merged"):
            return 7, {"ok": False, "problem": f"PR {a.pr} is not merged; finish only after `merge` and `verify`, or "
                                               "park with the reason"}
        report["merge_sha"] = pr.get("merge_commit_sha")
    elif not NO_PR.search(issue.get("body") or ""):
        return 7, {"ok": False, "problem": "no --pr given and the issue does not say `No PR: yes`; finish closes an "
                                           "issue only after its PR is merged"}
    approval = approval_status(issue, a.owner)
    if approval.get("relayed"):
        quote = " ".join((approval.get("quote") or "").split())
        if quote and quote not in " ".join(report["text"].split()):
            return 1, {"ok": False, "problems": [f"the approval was relayed from a chat: add a line `Approval: relayed "
                                                 f"from chat, “{quote}”` to the summary"]}
    out = deliver(a, plan, report, "done", ["code-working", "awaiting-approval", "needs-leo", "to-review",
                                            "reviewed"])
    gh(["-X", "PATCH", f"repos/{a.repo}/issues/{a.issue}", "-f", "state=closed", "-f", "state_reason=completed"],
       a.dry_run, plan)
    out["closed"] = True
    if report.get("merge_sha"):
        out["merge_sha"] = report["merge_sha"]
    return 0, out


def cmd_reopen(a, plan):
    issue_ = read_json(f"repos/{a.repo}/issues/{a.issue}", a.fixtures, "issue.json")
    labels = {lbl["name"] if isinstance(lbl, dict) else lbl for lbl in issue_.get("labels") or []}
    if "done" in labels or issue_.get("state_reason") == "not_planned":
        return 1, {"ok": False, "problem": "this issue is done or was closed as not planned; leave it closed"}
    if issue_.get("state") == "open":
        return 0, {"ok": True, "reopened": a.issue, "already_open": True}
    gh(["-X", "PATCH", f"repos/{a.repo}/issues/{a.issue}", "-f", "state=open"], a.dry_run, plan)
    return 0, {"ok": True, "reopened": a.issue}


def cmd_park(a, plan):
    phase = f" phase={a.phase}" if a.phase else ""
    body = f"<!-- loop:v1 from={a.sender} type=question{phase} turn={a.turn} -->\nPaused: {a.reason.strip()}\n"
    if a.phase:
        body += "Reply `CONTINUE: <answer>` to resume, or `REVISE: <notes>` to change the plan.\n"
    report = check(body, a.turn, ["needs-leo"], ["code-working"], expect_from=a.sender)
    if not report["ok"]:
        return 1, report
    posted = post_text(a, body, report["fields"], plan)
    remove_labels(a.repo, a.issue, ["to-code", "code-working", "awaiting-approval", "to-review", "reviewed"],
                  a.dry_run, plan)
    add_label(a.repo, a.issue, "needs-leo", a.dry_run, plan)
    return 0, {"ok": True, "parked": a.issue, "comment": body, "already_posted": not posted}


def checks_on(a, sha):
    runs = read_list(f"repos/{a.repo}/commits/{sha}/check-runs", a.fixtures, "checks.json",
                     default={"check_runs": []}, key="check_runs")
    status = read_json(f"repos/{a.repo}/commits/{sha}/status", a.fixtures, "status.json",
                       default={"state": "pending", "total_count": 0})
    return runs, status


def cmd_merge(a, plan):
    issue = issue_with_comments(a)
    approval = approval_status(issue, a.owner)
    if not approval["approved"]:
        return 4, {"ok": False, "problem": f"not merging: {approval['reason']}"}

    pr = read_json(f"repos/{a.repo}/pulls/{a.pr}", a.fixtures, "pr.json")
    for _ in range(5):  # GitHub computes mergeability in the background
        if pr.get("mergeable") is not None or a.fixtures:
            break
        time.sleep(3)
        pr = read_json(f"repos/{a.repo}/pulls/{a.pr}", a.fixtures, "pr.json")
    head = pr.get("head") or {}
    review = review_status(issue, a.owner, head.get("sha"), pr=a.pr)
    if not review["approved"]:
        return 4, {"ok": False, "problem": f"not merging: {review['reason']}"}

    facts = plan_facts(issue, a.owner)
    require = a.require_checks or facts["ci_required"]
    runs, status = checks_on(a, head.get("sha"))
    bad = [f"{r.get('name')}={r.get('conclusion') or r.get('status')}" for r in runs
           if r.get("status") != "completed" or r.get("conclusion") not in GOOD]
    if status.get("total_count", 0) and status.get("state") != "success":
        bad.append(f"commit status={status.get('state')}")
    if bad:
        return 6, {"ok": False, "problem": "not merging: checks not green: " + ", ".join(bad)}
    if require and not runs and not status.get("total_count", 0):
        return 6, {"ok": False, "problem": "not merging: the plan requires CI checks and none reported on this head"}

    files = read_list(f"repos/{a.repo}/pulls/{a.pr}/files", a.fixtures, "files.json", default=[])
    paths = [f.get("filename", "") for f in files]
    problems = []
    if pr.get("state") != "open" or pr.get("merged"):
        problems.append("PR is not open")
    if pr.get("draft"):
        problems.append("PR is a draft")
    source = ((head.get("repo") or {}).get("full_name") or "").lower()
    if source != a.repo.lower():
        problems.append(f"PR comes from {source or 'an unknown repository'}, not {a.repo} (forks are never merged)")
    if not str(head.get("ref", "")).startswith(a.branch_prefix):
        problems.append(f"PR head is not a {a.branch_prefix} branch")
    if (pr.get("base") or {}).get("ref") != a.base:
        problems.append(f"PR base is not {a.base}")
    if pr.get("mergeable") is not True or pr.get("mergeable_state") not in ("clean", "has_hooks"):
        problems.append(f"PR is not cleanly mergeable (mergeable={pr.get('mergeable')}, "
                        f"state={pr.get('mergeable_state')})")
    if "changed_files" in pr and pr["changed_files"] != len(paths):
        problems.append(f"read {len(paths)} of {pr['changed_files']} changed files, so the risk check is incomplete")
    if problems:
        return 5, {"ok": False, "problem": "not merging: " + "; ".join(problems)}

    scope = facts["scope"]
    outside = scope_problems(scope) or outside_scope(paths, scope)
    risk, reasons = risk_tier(paths, facts["risk"])
    owner_needed = []  # (exit code, why): the owner decides these, never an agent
    if outside:
        owner_needed.append((9, "files outside the plan's scope (" + ", ".join(outside) + ")"))
    if risk == "high":
        owner_needed.append((8, "a high-risk change (" + "; ".join(reasons) + ")"))
    args = ["-X", "PUT", f"repos/{a.repo}/pulls/{a.pr}/merge", "-f", f"merge_method={a.method}", "-f",
            f"sha={head['sha']}"]
    if owner_needed:
        quote = " ".join((a.owner_merge_quote or "").split())
        why = " and ".join(text for _, text in owner_needed)
        if not quote:
            return owner_needed[0][0], {
                "ok": False, "risk": risk, "risk_reasons": reasons, "outside_scope": outside,
                "problem": f"not merging: {why}. Every other gate is green, so the owner decides: REVISE: to widen the "
                           "plan, a Merge tap on GitHub, or the owner's own words starting with MERGE in a chat "
                           "session (--owner-merge-quote)"}
        if not quote.startswith("MERGE"):
            return 1, {"ok": False, "problems": ["--owner-merge-quote must be the owner's own words, starting with "
                                                 "MERGE (capitals)"]}
        args += ["-f", f"commit_message=Merge of {why} authorized by {a.owner_name or a.owner} in a chat session: "
                       f"“{quote}”"]
    raw = gh(args, a.dry_run, plan, retry=False)
    result = json.loads(raw) if raw else {}
    return 0, {"ok": True, "approval": approval["reason"], "review": review["reason"], "risk": risk,
               "checks": len(runs) + status.get("total_count", 0), "merged": result.get("merged", a.dry_run),
               "merge_sha": result.get("sha"), "head_sha": head["sha"]}


def cmd_verify(a, plan):
    pr = read_json(f"repos/{a.repo}/pulls/{a.pr}", a.fixtures, "pr.json")
    sha, base = pr.get("merge_commit_sha"), (pr.get("base") or {}).get("ref", "main")
    out = {"merged": bool(pr.get("merged")), "merge_sha": sha, "base": base}
    if not out["merged"] or not sha:
        return 7, dict(out, ok=False, problem="the PR is not merged")
    cmp_ = read_json(f"repos/{a.repo}/compare/{sha}...{base}", a.fixtures, "compare.json")
    out["on_base"] = cmp_.get("status") in ("identical", "ahead")
    runs, status = checks_on(a, sha)
    out["post_merge_checks"] = [f"{r.get('name')}={r.get('conclusion') or r.get('status')}" for r in runs]
    if status.get("total_count", 0):
        out["post_merge_checks"].append(f"commit status={status.get('state')}")
    out["ok"] = out["on_base"]
    return (0 if out["ok"] else 7), out


COMMANDS = {"claim": cmd_claim, "park": cmd_park, "post-plan": cmd_post_plan,
            "ready-for-review": cmd_ready_for_review, "verdict": cmd_verdict,
            "relay-approval": cmd_relay_approval, "merge": cmd_merge, "verify": cmd_verify,
            "finish": cmd_finish, "reopen": cmd_reopen}
NEEDS_OWNER = {"merge", "finish"}


def parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in COMMANDS:
        p = sub.add_parser(name)
        p.add_argument("--repo", required=True)
        p.add_argument("--issue", type=int, required=True)
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--fixtures", default=None)
        p.add_argument("--config", default=None, help="settings file (default .github/github-loop.json)")
        p.add_argument("--session", default=None, help="the model this task runs on (checks a reply's Model line; "
                                                       "accepted and unused by commands that post none)")
        if name in ("post-plan", "ready-for-review", "verdict", "finish"):
            p.add_argument("--file", required=True)
            p.add_argument("--turn", type=int, required=True)
        if name in ("ready-for-review", "verdict", "merge", "verify"):
            p.add_argument("--pr", type=int, required=True)
        if name == "finish":
            p.add_argument("--pr", type=int, default=None, help="the merged PR (omit only for `No PR: yes` issues)")
        if name in NEEDS_OWNER or name == "relay-approval":
            p.add_argument("--owner", default=None, help="the owner's login (default: config, then the repo owner)")
        if name in ("park", "post-plan"):
            p.add_argument("--from", dest="sender", choices=("code", "lead"),
                           default="lead" if name == "post-plan" else "code")
        if name == "post-plan":
            p.add_argument("--plan-file", default=None, help="the plan file; check_plan.py runs on it before posting")
            p.add_argument("--git-base", default=None, help="also require the plan to be the only changed file")
            p.add_argument("--no-plan-file", default=None, help="where the plan is, when it is not a repo file")
        if name == "park":
            p.add_argument("--turn", type=int, required=True)
            p.add_argument("--reason", required=True)
            p.add_argument("--phase", type=int, choices=(1, 2), default=None)
        if name == "relay-approval":
            p.add_argument("--turn", type=int, required=True)
            p.add_argument("--quote", required=True, help="the owner's own words from the chat, starting with APPROVED")
        if name == "merge":
            p.add_argument("--method", choices=("merge", "squash", "rebase"), default="merge")
            p.add_argument("--base", default=None, help="default: config base, else main")
            p.add_argument("--require-checks", action="store_true")
            p.add_argument("--owner-merge-quote", default=None,
                           help="for a high-risk PR: the owner's own words from a chat session, starting with MERGE")
    return ap


def from_repo_root(path):
    """A relative path that is missing here is tried from the top of the git checkout, so --file and
    --plan-file also work when the command runs from the skill folder. Anything else is returned as given."""
    if not path or os.path.isabs(path) or os.path.exists(path):
        return path
    try:
        proc = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    except FileNotFoundError:
        return path
    candidate = os.path.join(proc.stdout.strip(), path) if proc.returncode == 0 else ""
    return candidate if candidate and os.path.exists(candidate) else path


def main():
    a = parser().parse_args()
    plan = []
    for name in ("file", "plan_file"):
        if getattr(a, name, None):
            setattr(a, name, from_repo_root(getattr(a, name)))
    try:
        cfg = loop_config.load(a.config)
        set_owner_associations(cfg["owner_associations"])
        a.branch_prefix, a.owner_name = cfg["branch_prefix"], cfg.get("owner_name")
        if getattr(a, "base", "unset") is None:
            a.base = cfg["base"]
        if a.cmd in NEEDS_OWNER:
            a.owner = loop_config.resolve_owner(a.repo, a.owner, cfg, a.fixtures)
            a.owner_name = a.owner_name or a.owner
        code, out = COMMANDS[a.cmd](a, plan)
    except (ApiError, ValueError) as e:
        code, out = 2, {"ok": False, "problem": str(e)}
    if a.dry_run:
        out["dry_run_calls"] = plan
    json.dump(out, sys.stdout, indent=2)
    print()
    sys.exit(code)


if __name__ == "__main__":
    main()
