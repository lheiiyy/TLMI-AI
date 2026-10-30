#!/usr/bin/env python3
"""Read-only check at the start of every github-loop run (event-started or backup).

One command replaces the "list issues, fetch comments, run the guard" steps, so an
idle scheduled run costs almost no tokens: if `work` is empty, the run just says
"No new work." and stops.

    python scripts/triage.py --repo <owner>/<repo> --role code
    python scripts/triage.py --repo <owner>/<repo> --role lead

--owner defaults to "owner" in .github/github-loop.json, else the user who owns the repo.

--role code  the Engineer: build, fix, merge, continue (phase 2). It also parks needs_leo and
             stale entries.
--role lead  the Technical Lead (Cowork): plan, revise, review, continue (phase 1).
--role all   both (one session doing every role; avoid it when a separate Lead task exists,
             because a review should come from a different session than the build).
--max-tier T / --min-tier T   split the work between tasks that run different models. Every
             work entry carries `tier` (what its step needs, from pick_model.py). A task with
             --max-tier sonnet leaves opus-tier work in `deferred` for a stronger task, and
             takes it anyway after --defer-minutes (default 120) so nothing waits forever, with
             tier_note telling it to say so in its Model line. A task with --min-tier opus takes
             only opus-tier work.

Prints one JSON object:
  work       issues for this role that passed every guard (oldest first), each with
             next_turn, reply_header, work_type, phase, role, notes, and for review, fix and
             merge the pr and head.
  needs_leo  issues the guard parked: a cap was reached, or the owner put `to-code` on an issue
             that has no Phase 1 and Phase 2 headings (such an entry has no phase)
  reopen     closed issues the owner answered with APPROVED, REVISE: or CONTINUE: ("Close with
             comment" was tapped); run `loop_gh.py reopen`, then run triage again
  deferred   work that needs a stronger model than --max-tier; another task takes it
  stalled    the OTHER role's work that no run picked up for --stall-minutes (default 180); park it
             with `loop_gh.py park --from <your role>` so the owner sees it
  stale      issues stuck on code-working longer than --stale-minutes, or
             --build-stale-minutes for an approved autopilot build (a crashed run)
  ignored    issues skipped, with the reason (for example "waiting for the owner's APPROVED")

Exit codes: 0 ok (including "No new work."), 2 API or input failure (including a missing `gh`).
A failure is never reported as "No new work.", so a broken token cannot look like an idle queue.
Every list is read to its last page (comments come oldest first, so the newest keyword is on the
last page); a rate limit or server error is retried before the run gives up.

Test without the network: --fixtures DIR with issues.json, <N>.comments.json, <N>.events.json.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as loop_config  # noqa: E402
from ghapi import ApiError, get_all, get_json  # noqa: E402
from loop_guard import approval_status, decide, is_autopilot, set_owner_associations  # noqa: E402
from pick_model import RANK, pick  # noqa: E402

LOOP_LABELS = {"to-code", "code-working", "awaiting-approval", "needs-leo", "to-review", "reviewed"}
OWNER_WAITS = {"awaiting-approval", "needs-leo"}  # states where the owner's keyword is the next event
STEP_FOR = {"plan": "plan", "revise": "revise", "build": "build", "fix": "fix", "review": "review",
            "merge": "merge"}


def fetch(path, fixtures, fixture_name, all_pages=True):
    """Every page of a REST list, or a fixture file when --fixtures is set (missing = empty)."""
    if fixtures:
        full = os.path.join(fixtures, fixture_name)
        if not os.path.exists(full):
            return []  # a missing fixture means "no comments / no events"
        with open(full, encoding="utf-8") as f:
            return json.load(f)
    return get_all(path) if all_pages else get_json(path)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def latest_label_event(events, label):
    """Return the newest `labeled` event for this label, or None."""
    found = [e for e in events if e.get("event") == "labeled" and (e.get("label") or {}).get("name") == label]
    return max(found, key=lambda e: e.get("created_at", ""), default=None)


def minutes_since(value, now):
    return int((now - parse_time(value)).total_seconds() // 60) if value else 0


def tier_of(item, issue, repo, fixtures):
    """What model tier this step needs, from pick_model.py. The PR's file list (one call) sharpens review and
    fix; if it is unavailable the tier is a floor and says so. The step itself re-runs pick_model.py with the
    real diff, and that answer wins."""
    wt = item.get("work_type")
    step = STEP_FOR.get(wt) or ("plan" if item.get("phase") == 1 else "build")
    paths, caveat = [], ""
    if step in ("review", "fix") and item.get("pr"):
        try:
            files = fetch(f"repos/{repo}/pulls/{item['pr']}/files", fixtures,
                          f"pr{item['pr']}.files.json")
            paths = [f.get("filename", "") for f in files]
        except ApiError:
            caveat = " (the PR's files could not be read, so this tier is a floor)"
    report = pick(step, paths, issue.get("body") or "", round_=item.get("round") or item.get("review_round") or 1)
    return report["tier"], report["reasons"][0] + caveat


def reopen_candidates(repo, owner, now, fixtures, reopen_hours, max_replies, max_revisions, max_review_rounds):
    """Closed autopilot issues where the owner's keyword is the next event. 'Close with comment' closes the
    issue along with the comment, and the loop only scans open issues, so without this the approval is never
    seen. Closed as 'not planned' means the owner abandoned it, and finished issues carry `done`; both are left
    closed. Only the 30 most recently updated closed issues are looked at (a recency window, by design)."""
    closed = fetch(f"repos/{repo}/issues?state=closed&sort=updated&direction=desc&per_page=30", fixtures,
                   "closed.json", all_pages=False)
    found = []
    for issue in closed:
        if "pull_request" in issue or issue.get("state_reason") == "not_planned":
            continue
        labels = {l["name"] if isinstance(l, dict) else l for l in issue.get("labels") or []}
        if "done" in labels or not labels & OWNER_WAITS or not is_autopilot(issue.get("body")):
            continue
        if reopen_hours and minutes_since(issue.get("updated_at"), now) > reopen_hours * 60:
            continue
        number = issue["number"]
        issue = dict(issue, comments=fetch(f"repos/{repo}/issues/{number}/comments", fixtures,
                                           f"{number}.comments.json"))
        decision = decide(issue, owner, None, max_replies, max_revisions, max_review_rounds)
        if decision["action"] == "proceed":
            found.append({"number": number, "title": issue.get("title", ""), "would_run": decision.get("work_type"),
                          "reason": "closed with the owner's keyword as the newest comment"})
    return found


def triage(repo, owner, stale_minutes, now, fixtures, build_stale_minutes=180,
           max_replies=20, max_revisions=3, role="code", max_review_rounds=4,
           max_tier=None, min_tier=None, defer_minutes=120, stall_minutes=180, reopen_hours=48):
    issues = fetch(f"repos/{repo}/issues?state=open", fixtures, "issues.json")
    result = {"repo": repo, "owner": owner, "role": role, "work": [], "needs_leo": [], "stale": [], "ignored": [],
              "reopen": [], "deferred": [], "stalled": []}
    parks = role in ("code", "all")
    result["reopen"] = reopen_candidates(repo, owner, now, fixtures, reopen_hours, max_replies, max_revisions,
                                         max_review_rounds)

    for issue in sorted(issues, key=lambda i: i["number"]):
        if "pull_request" in issue:
            continue  # the issues endpoint also returns PRs
        number = issue["number"]
        labels = {l["name"] if isinstance(l, dict) else l for l in issue.get("labels") or []}
        autopilot = is_autopilot(issue.get("body"))
        watched = {"to-code", "code-working"} | (LOOP_LABELS if autopilot else set())
        if not labels & watched or "done" in labels:
            continue
        comments = fetch(f"repos/{repo}/issues/{number}/comments", fixtures, f"{number}.comments.json")
        issue = dict(issue, comments=comments)
        needs_events = bool(labels & {"to-code", "code-working"})
        events = fetch(f"repos/{repo}/issues/{number}/events", fixtures,
                       f"{number}.events.json") if needs_events else []

        if "code-working" in labels:
            building = autopilot and approval_status(issue, owner)["approved"]
            limit = build_stale_minutes if building else stale_minutes
            claim = latest_label_event(events, "code-working")
            started = parse_time(claim["created_at"]) if claim else parse_time(issue["updated_at"])
            minutes = int((now - started).total_seconds() // 60)
            if minutes >= limit and parks:
                turn_info = decide(issue, owner)
                result["stale"].append({"number": number, "title": issue.get("title", ""), "minutes": minutes,
                                        "next_turn": turn_info["next_turn"], "phase": 2 if building else 1})
            else:
                result["ignored"].append({"number": number, "reason": f"claimed {minutes} min ago, still running"})
            continue

        event = latest_label_event(events, "to-code") if "to-code" in labels else None
        labeled_by = ((event or {}).get("actor") or {}).get("login")
        decision = decide(issue, owner, labeled_by, max_replies, max_revisions, max_review_rounds)
        entry = {"number": number, "title": issue.get("title", ""), "labeled_by": labeled_by, "mode": decision["mode"]}
        if decision["action"] == "proceed":
            waited = minutes_since(issue.get("updated_at"), now)
            if role != "all" and decision.get("role", "code") != role:
                work_type = decision.get("work_type", "task")
                if autopilot and waited >= stall_minutes:
                    # the other role's work sat untouched for several cycles: a silent or broken run
                    result["stalled"].append(dict(entry, next_turn=decision["next_turn"], work_type=work_type,
                                                  phase=decision.get("phase", 1), for_role=decision.get("role"),
                                                  waiting_minutes=waited))
                else:
                    result["ignored"].append(dict(entry, reason=f"{work_type} is {decision.get('role')} work"))
                continue
            item = dict(entry, next_turn=decision["next_turn"], reply_header=decision["reply_header"],
                        role=decision.get("role", "code"))
            if autopilot:
                for key in ("work_type", "phase", "notes", "pr", "head", "review_round", "round", "since"):
                    if key in decision:
                        item[key] = decision[key]
                item["tier"], item["tier_reason"] = tier_of(item, issue, repo, fixtures)
                if min_tier and RANK[item["tier"]] < RANK[min_tier]:
                    result["ignored"].append(dict(entry, reason=f"{item['tier']}-tier {item['work_type']}; this task "
                                                                f"only takes {min_tier} and above"))
                    continue
                if max_tier and RANK[item["tier"]] > RANK[max_tier]:
                    if waited < defer_minutes:
                        result["deferred"].append(dict(entry, work_type=item["work_type"], tier=item["tier"],
                                                       waiting_minutes=waited,
                                                       takes_over_in=defer_minutes - waited))
                        continue
                    item["tier_note"] = (f"waited {waited} min for a {item['tier']} task; run it at your own tier "
                                         f"({max_tier}) and say so in the Model line")
            result["work"].append(item)
        elif decision["action"] == "needs-leo":
            target = result["needs_leo"] if parks else result["ignored"]
            parked = dict(entry, next_turn=decision["next_turn"], reason=decision["reason"])
            if decision.get("phase"):  # a request that is not autopilot has no phase to resume
                parked["phase"] = decision["phase"]
            target.append(parked)
        else:
            result["ignored"].append(dict(entry, reason=decision["reason"]))

    parts = []
    if result["work"]:
        parts.append(f"{len(result['work'])} to do")
    if result["needs_leo"]:
        parts.append(f"{len(result['needs_leo'])} need the owner")
    if result["stale"]:
        parts.append(f"{len(result['stale'])} stale")
    if result["stalled"]:
        parts.append(f"{len(result['stalled'])} stalled")
    if result["reopen"]:
        parts.append(f"{len(result['reopen'])} to reopen")
    result["summary"] = ", ".join(parts) if parts else "No new work."
    if result["deferred"]:
        result["summary"] += f" ({len(result['deferred'])} deferred to a stronger task)"
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, help="owner/name")
    ap.add_argument("--owner", default=None, help="login of the owner (default: config, then the repo's owner)")
    ap.add_argument("--config", default=None, help="settings file (default .github/github-loop.json)")
    ap.add_argument("--role", choices=("code", "lead", "all"), default="code")
    ap.add_argument("--stale-minutes", type=int, default=90)
    ap.add_argument("--build-stale-minutes", type=int, default=180, help="stale limit for approved builds")
    ap.add_argument("--max-replies", type=int, default=20, help="agent reply cap")
    ap.add_argument("--max-revisions", type=int, default=3, help="plan revision cap")
    ap.add_argument("--max-review-rounds", type=int, default=4, help="change-request cap")
    ap.add_argument("--max-tier", choices=("haiku", "sonnet", "opus"), default=None,
                    help="the model this task runs on; stronger-tier work is deferred to another task")
    ap.add_argument("--min-tier", choices=("haiku", "sonnet", "opus"), default=None,
                    help="take only work at this tier or above (for a task that runs a stronger model)")
    ap.add_argument("--defer-minutes", type=int, default=120,
                    help="how long deferred work waits for a stronger task before this one takes it")
    ap.add_argument("--stall-minutes", type=int, default=180,
                    help="the other role's pending work older than this is reported as stalled")
    ap.add_argument("--reopen-hours", type=int, default=48,
                    help="only closed issues updated within this many hours can be reopened (0 = any)")
    ap.add_argument("--fixtures", default=None, help="directory of JSON fixtures instead of the network")
    ap.add_argument("--now", default=None, help="ISO time to treat as now (for tests)")
    args = ap.parse_args()

    now = parse_time(args.now) if args.now else datetime.now(timezone.utc)
    try:
        cfg = loop_config.load(args.config)
        set_owner_associations(cfg["owner_associations"])
        owner = loop_config.resolve_owner(args.repo, args.owner, cfg, args.fixtures)
        result = triage(args.repo, owner, args.stale_minutes, now, args.fixtures,
                        args.build_stale_minutes, args.max_replies, args.max_revisions, args.role,
                        args.max_review_rounds, args.max_tier, args.min_tier, args.defer_minutes,
                        args.stall_minutes, args.reopen_hours)
    except (ApiError, KeyError, ValueError) as e:
        json.dump({"error": str(e), "summary": "TRIAGE FAILED, not an empty queue"}, sys.stdout, indent=2)
        print()
        sys.exit(2)
    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
