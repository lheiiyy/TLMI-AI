#!/usr/bin/env python3
"""Decide whether a loop agent may act on a GitHub issue, and what the work is.

Deterministic and offline. Reads an issue JSON file (REST shape, or the older
`gh issue view --json` shape) plus its comments and prints one JSON object with
action = proceed | needs-leo | ignore.

One mode: autopilot. A request has "Phase 1" and "Phase 2" headings (## or ###).
A proceed result carries work_type, phase and role:
    lead (Cowork, Technical Lead): plan, revise, review, continue (phase 1)
    code (Claude Code, Engineer):   build, fix, merge, continue (phase 2)
An issue without those headings is not a request the loop can plan. If the owner labels it `to-code`,
the result is needs-leo (mode not-autopilot) so Code parks it once with a note on how to file it; every
other label state is ignored.

Who may say what:
- The owner (the repo owner's login, or "owner" in .github/github-loop.json), at the very start of a comment and
  in capitals: `APPROVED`, `REVISE: <notes>`, `CONTINUE: <answer>`.
- Agents post from the owner's account too, but every agent comment starts with a
  loop:v1 header (`from=code` or `from=lead`), so it can never read as a keyword.
- A `from=lead type=approval` comment relays the owner's approval given in a chat with the
  Lead. It counts like `APPROVED` only when it quotes the owner's own words and those words
  start with `APPROVED` (`APPROVED by <name> in chat on <date>: "APPROVED ..."`).
- Approval rules: the newest plan needs an owner `APPROVED` after it. A `REVISE:` after that
  plan cancels any approval, before or after it, until the Lead posts a revised plan.
  A `CONTINUE:` keeps the approval.
- Review verdicts are `from=lead type=verdict` comments naming the PR, the exact head
  SHA and `verdict=approved|changes`.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rules import declared_risk, declared_scope  # noqa: E402

HEADER = re.compile(r"<!--\s*loop:v1\s+([^>]*?)-->")
KEYWORD = re.compile(r"\A\s*(APPROVED\b|REVISE:|CONTINUE:)\s*(.*)\Z", re.DOTALL)
PHASE1 = re.compile(r"^#{2,3}\s*Phase 1\b", re.MULTILINE)
PHASE2 = re.compile(r"^#{2,3}\s*Phase 2\b", re.MULTILINE)
RELAY = re.compile(r"(?m)^APPROVED by [^\n]{1,60}? in chat on \d{4}-\d{2}-\d{2}: [\u201c\"]APPROVED\b")
CI_LINE = re.compile(r"(?im)^[ \t>*-]*CI required[ \t]*:[ \t]*\**[ \t]*(yes|no)\b")
AGENTS = {"code", "lead"}
OWNER_ASSOCIATIONS = {"OWNER"}  # config owner_associations can add "MEMBER" for an organization repo
ROLE = {"plan": "lead", "revise": "lead", "review": "lead",
        "build": "code", "fix": "code", "merge": "code"}


def login(value):
    if isinstance(value, dict):
        return value.get("login", "")
    return value or ""


def label_names(labels):
    return {(l.get("name") if isinstance(l, dict) else l) for l in labels or []}


def fields_of(raw):
    return dict(kv.split("=", 1) for kv in raw.split() if "=" in kv)


def headers(text):
    return [fields_of(m.group(1)) for m in HEADER.finditer(text or "")]


def first_header(text):
    m = HEADER.match((text or "").lstrip())
    return fields_of(m.group(1)) if m else None


def is_autopilot(body):
    return bool(PHASE1.search(body or "") and PHASE2.search(body or ""))


def is_owner(message, owner):
    if login(message.get("user")).lower() != owner.lower():
        return False
    return message.get("author_association") in (None, "") or message.get("author_association") in OWNER_ASSOCIATIONS


def set_owner_associations(values):
    """Which author_association values count as the owner (the login must match too)."""
    OWNER_ASSOCIATIONS.clear()
    OWNER_ASSOCIATIONS.update(values or ["OWNER"])


def thread(issue):
    """The issue body, then its comments, each as {user, author_association, body, is_body}."""
    msgs = [{"user": issue.get("user") or issue.get("author"),
             "author_association": issue.get("author_association") or issue.get("authorAssociation"),
             "body": issue.get("body") or "", "is_body": True}]
    for c in issue.get("comments") or []:
        msgs.append({"user": c.get("user") or c.get("author"),
                     "author_association": c.get("author_association") or c.get("authorAssociation"),
                     "body": c.get("body") or "", "is_body": False})
    return msgs


def count_turns(msgs, owner):
    """Highest turn number seen. An owner `type=reset` header restarts the count."""
    turns, reset_seen = [], False
    for m in msgs:
        for h in headers(m["body"]):
            if h.get("type") == "reset" and is_owner(m, owner):
                turns, reset_seen = [], True
            elif str(h.get("turn", "")).isdigit():
                turns.append(int(h["turn"]))
    return max(turns) if turns else (0 if reset_seen else 1)  # a bare pasted issue counts as turn 1


def agent_replies(msgs, owner):
    """(index, header) for owner-account comments whose first line is a from=code|lead header.
    Relayed approvals are keywords, not replies, so they are left out."""
    found = []
    for i, m in enumerate(msgs):
        if m["is_body"] or not is_owner(m, owner):
            continue
        h = first_header(m["body"])
        if h and h.get("from") in AGENTS and h.get("type") != "approval":
            found.append((i, h))
    return found


executor_replies = agent_replies  # older name, kept for callers


def owner_keywords(msgs, owner, after):
    """Owner keyword comments (and relayed approvals) with index > after, oldest first."""
    found = []
    for i in range(after + 1, len(msgs)):
        m = msgs[i]
        if m["is_body"] or not is_owner(m, owner):
            continue
        h = first_header(m["body"])
        if h:
            if h.get("from") == "lead" and h.get("type") == "approval":
                quote = RELAY.search(m["body"])
                if quote:  # a relay without the owner's own "APPROVED ..." words never counts
                    found.append({"keyword": "APPROVED", "text": "relayed from chat", "index": i, "relayed": True,
                                  "quote": relay_quote(m["body"])})
            continue
        k = KEYWORD.match(m["body"])
        if k:
            found.append({"keyword": k.group(1).rstrip(":"), "text": k.group(2).strip(), "index": i})
    return found


def relay_quote(body):
    m = re.search(r"in chat on \d{4}-\d{2}-\d{2}: [\u201c\"](.*?)[\u201d\"]?\s*$", body or "", re.M)
    return m.group(1).strip() if m else ""


def latest_plan_index(replies):
    return max((i for i, h in replies if h.get("type") == "plan"), default=None)


def approval_status(issue, owner):
    """Is the latest plan approved? Used by loop_gh.py merge and finish as an independent check.
    A REVISE: after the latest plan cancels every approval until a revised plan is posted;
    a CONTINUE: keeps it."""
    msgs = thread(issue)
    plan_idx = latest_plan_index(agent_replies(msgs, owner))
    if plan_idx is None:
        return {"approved": False, "reason": "no plan reply on the issue"}
    kws = owner_keywords(msgs, owner, plan_idx)
    approvals = [k for k in kws if k["keyword"] == "APPROVED"]
    if not approvals:
        return {"approved": False, "reason": "no owner APPROVED after the latest plan"}
    if any(k["keyword"] == "REVISE" for k in kws):
        return {"approved": False, "reason": "the owner asked for a revision after the latest plan; the Lead must "
                                             "post a revised plan before an APPROVED counts"}
    last = approvals[-1]
    relayed = bool(last.get("relayed"))
    return {"approved": True, "reason": "owner APPROVED the latest plan" + (" (relayed from chat)" if relayed else ""),
            "relayed": relayed, "quote": last.get("quote", "")}


def plan_facts(issue, owner):
    """What the latest plan reply declares: `Risk: low|normal|high`, `CI required: yes|no` and
    `Files in scope: ...` (None when the line is missing)."""
    msgs = thread(issue)
    idx = latest_plan_index(agent_replies(msgs, owner))
    body = msgs[idx]["body"] if idx is not None else ""
    ci = CI_LINE.search(body)
    return {"risk": declared_risk(body), "ci_required": bool(ci and ci.group(1).lower() == "yes"),
            "scope": declared_scope(body)}


def review_history(msgs, owner):
    """Code results and Lead verdicts after the latest plan, oldest first."""
    replies = agent_replies(msgs, owner)
    plan_idx = latest_plan_index(replies)
    after = plan_idx if plan_idx is not None else -1
    results = [(i, h) for i, h in replies
               if i > after and h.get("from") == "code" and h.get("type") == "result" and h.get("phase") == "2"]
    verdicts = [(i, h) for i, h in replies if i > after and h.get("from") == "lead" and h.get("type") == "verdict"]
    return results, verdicts


def review_status(issue, owner, head_sha, pr=None):
    """Is there an approved Lead verdict for exactly this head (and this PR)? Used by loop_gh.py merge.
    With `pr`, the verdict and the latest Code result must both name that PR, so a verdict for one PR
    can never merge another."""
    results, verdicts = review_history(thread(issue), owner)
    if not verdicts:
        return {"approved": False, "reason": "no Lead review verdict after the latest plan"}
    v = verdicts[-1][1]
    if v.get("verdict") != "approved":
        return {"approved": False, "reason": "the latest Lead verdict requests changes"}
    if v.get("head") != head_sha:
        return {"approved": False, "reason": f"the approved verdict is for head {v.get('head')}, not {head_sha}"}
    if pr is not None:
        if v.get("pr") != str(pr):
            return {"approved": False, "reason": f"the approved verdict names PR {v.get('pr')}, not {pr}"}
        if not results or results[-1][1].get("pr") != str(pr):
            return {"approved": False, "reason": f"the latest Code result does not name PR {pr}, so the PR is not "
                                                 "linked to this issue"}
    return {"approved": True, "reason": "Lead approved this exact head"}


NOT_AUTOPILOT = ("this issue has no Phase 1 and Phase 2 headings, so the loop cannot plan it: file the request with "
                 "the Autopilot issue form (references/task-template.md), or add the two headings and the to-code "
                 "label again")


def decide_not_autopilot(issue, owner, labeled_by=None):
    """An issue without Phase 1 and Phase 2 headings is never planned or built. The owner's `to-code` label on one
    gets a single answer (Code parks it with NOT_AUTOPILOT), not a silent skip; every other state is ignored."""
    labels = label_names(issue.get("labels"))
    issue_author = login(issue.get("author") or issue.get("user"))
    current = count_turns(thread(issue), owner)
    result = {"mode": "not-autopilot", "role": "code", "current_turn": current, "next_turn": current + 1}

    def out(action, reason):
        result.update(action=action, reason=reason)
        return result

    if labels & {"needs-leo", "done"}:
        return out("ignore", "issue is parked (needs-leo or done)")
    if "to-code" not in labels:
        return out("ignore", "no to-code label")
    if "code-working" in labels:
        return out("ignore", "already claimed by a running agent")
    if issue_author.lower() != owner.lower():
        return out("ignore", "issue author is not the repo owner")
    if labeled_by and labeled_by.lower() != owner.lower():
        return out("ignore", "label was not applied by the repo owner")
    return out("needs-leo", NOT_AUTOPILOT)


def decide_autopilot(issue, owner, labeled_by=None, max_replies=20, max_revisions=3, max_review_rounds=4):
    labels = label_names(issue.get("labels"))
    issue_author = login(issue.get("author") or issue.get("user"))
    msgs = thread(issue)
    current = count_turns(msgs, owner)
    replies = agent_replies(msgs, owner)
    reset_at = max((i for i, m in enumerate(msgs)
                    if is_owner(m, owner) and any(h.get("type") == "reset" for h in headers(m["body"]))), default=-1)
    live = [h for i, h in replies if i > reset_at]
    plans = [h for h in live if h.get("type") == "plan"]
    last = replies[-1][1] if replies else None
    kws = owner_keywords(msgs, owner, replies[-1][0] if replies else 0)
    kw = kws[-1] if kws else None
    results, verdicts = review_history(msgs, owner)
    last_result = results[-1] if results else None
    last_verdict = verdicts[-1] if verdicts else None
    result = {"mode": "autopilot", "current_turn": current, "next_turn": current + 1}
    nt = current + 1

    def out(action, reason, **extra):
        result.update(action=action, reason=reason, **extra)
        return result

    def work(kind, phase, notes="", header=None, **extra):
        role = ROLE.get(kind) or ("lead" if phase == 1 else "code")
        if len(live) >= max_replies:
            return out("needs-leo", f"reply cap reached ({len(live)} of {max_replies} agent replies); "
                       "a human should review this thread", phase=phase, role="code")
        if header is None:
            header = (f"<!-- loop:v1 from=lead type=plan phase=1 turn={nt} -->" if phase == 1 else
                      f"<!-- loop:v1 from=code type=result phase=2 pr=<PR> head=<SHA> turn={nt} -->")
        return out("proceed", f"{kind} (phase {phase})", work_type=kind, phase=phase, role=role, notes=notes,
                   reply_header=header, **extra)

    def revise(notes):
        if len(plans) >= 1 + max_revisions:
            return out("needs-leo", f"revision cap reached ({len(plans) - 1} of {max_revisions} revisions)",
                       phase=1, role="code")
        return work("revise", 1, notes, round=len(plans))

    if issue_author.lower() != owner.lower():
        return out("ignore", "issue author is not the repo owner")
    if "done" in labels:
        return out("ignore", "issue is done")
    if "code-working" in labels:
        return out("ignore", "already claimed by a running agent")
    if "to-code" in labels:
        if labeled_by and labeled_by.lower() != owner.lower():
            return out("ignore", "label was not applied by the repo owner")
        if len(plans) >= 1 + max_revisions:
            return out("needs-leo", f"revision cap reached ({len(plans) - 1} of {max_revisions} revisions)",
                       phase=1, role="code")
        return work("plan", 1)
    if "awaiting-approval" in labels:
        if not last or last.get("type") != "plan":
            return out("ignore", "awaiting-approval, but the latest agent reply is not a plan")
        revises = [k for k in kws if k["keyword"] == "REVISE"]
        if revises:  # a REVISE: after the plan wins over any APPROVED around it: a revised plan comes first
            return revise(revises[-1]["text"])
        if kw and kw["keyword"] == "APPROVED":
            return work("build", 2)
        return out("ignore", "waiting for the owner's APPROVED or REVISE:")
    if "to-review" in labels:
        if not last_result:
            return out("ignore", "to-review, but there is no Code result to review")
        if last_verdict and last_verdict[0] > last_result[0]:
            return out("ignore", "the latest Code result is already reviewed")
        pr, head = last_result[1].get("pr"), last_result[1].get("head")
        rnd = len(verdicts) + 1
        return work("review", 2, header=f"<!-- loop:v1 from=lead type=verdict phase=2 pr={pr} head={head} "
                                       f"verdict=<approved|changes> turn={nt} -->",
                    pr=pr, head=head, review_round=rnd,
                    since=(verdicts[-1][1].get("head") if verdicts else None))
    if "reviewed" in labels:
        if not last_verdict or (last_result and last_result[0] > last_verdict[0]):
            return out("ignore", "waiting for a review of the latest head")
        v = last_verdict[1]
        pr, head = v.get("pr"), v.get("head")
        if v.get("verdict") == "approved":
            if last_result and last_result[1].get("head") != head:
                return out("needs-leo", "the approved verdict names a different head than the latest Code result",
                           phase=2, role="code")
            return work("merge", 2, header=f"<!-- loop:v1 from=code type=summary phase=2 turn={nt} -->",
                        pr=pr, head=head)
        changes = sum(1 for _, h in verdicts if h.get("verdict") == "changes")
        if changes >= max_review_rounds:
            return out("needs-leo", f"review round cap reached ({changes} of {max_review_rounds} change requests)",
                       phase=2, role="code")
        return work("fix", 2, notes="fix every [BLOCKER] and [MAJOR] in the latest verdict comment", pr=pr, head=head,
                    round=changes)
    if "needs-leo" in labels:
        if kw and kw["keyword"] == "CONTINUE":
            raw = str((last or {}).get("phase", "1"))
            return work("continue", int(raw) if raw in ("1", "2") else 1, kw["text"])
        if kw and kw["keyword"] == "REVISE":
            return revise(kw["text"])
        return out("ignore", "parked; waiting for the owner's CONTINUE: or REVISE:")
    return out("ignore", "no loop label")


def decide(issue, owner, labeled_by=None, max_replies=20, max_revisions=3, max_review_rounds=4):
    if is_autopilot(issue.get("body")):
        return decide_autopilot(issue, owner, labeled_by, max_replies, max_revisions, max_review_rounds)
    return decide_not_autopilot(issue, owner, labeled_by)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("issue_json")
    ap.add_argument("--owner", required=True, help="login of the repo owner")
    ap.add_argument("--comments", default=None, help="JSON array of issue comments (REST shape), if not inside the issue file")
    ap.add_argument("--max-replies", type=int, default=20, help="agent reply cap")
    ap.add_argument("--max-revisions", type=int, default=3, help="plan revision cap")
    ap.add_argument("--max-review-rounds", type=int, default=4, help="change-request cap")
    ap.add_argument("--labeled-by", default=None, help="login of whoever applied the label, if known")
    args = ap.parse_args()
    with open(args.issue_json, encoding="utf-8") as f:
        issue = json.load(f)
    if args.comments:
        with open(args.comments, encoding="utf-8") as f:
            issue["comments"] = json.load(f)
    result = decide(issue, args.owner, args.labeled_by, args.max_replies, args.max_revisions, args.max_review_rounds)
    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
