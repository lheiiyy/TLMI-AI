#!/usr/bin/env python3
"""Collect loop outcomes from the GitHub record, as fixed fields only (read-only).

    outcomes.py --repo <owner>/<repo> [--owner LOGIN] [--limit 50] [--out outcomes.json]

Each autopilot issue by the owner becomes one record built from the loop headers, labels and
counts. Nothing an agent claims is trusted, and no comment text is ever stored, so a secret in a
comment cannot leak into the outcomes. Comments by other accounts are never read; they are only
counted as rejected evidence.

Record fields: number, state, outcome (done | parked | open | closed), plans, revisions, verdicts,
review_rounds, parks, park_reasons (fixed categories), replies, merged, relayed_approval,
model_gaps (Model lines that say a stronger tier was wanted), models (tier per reply type),
risk (the plan's Risk line), rejected_comments. `evidence` says which fields are verified
(counted from headers and labels) and which are uncertain (read from free text, such as a park
reason). improve.py turns repeated patterns into proposals; neither script changes anything.
Exit 0, or 2 on an API or input failure.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as loop_config  # noqa: E402
from ghapi import CALLS, ApiError, from_fixture, get_all, get_json  # noqa: E402
from loop_guard import (agent_replies, is_autopilot, is_owner, label_names, login, owner_keywords,  # noqa: E402
                        set_owner_associations, thread)
from rules import declared_risk  # noqa: E402

PARK_CATEGORIES = [
    ("stale", r"previous run stopped"),
    ("stalled", r"\bNo (code|lead) run picked up"),
    ("merge_tap", r"Merge needs one tap"),
    ("release", r"Ready to release"),
    ("out_of_scope", r"outside the plan's scope|outside the approved scope|Files in scope"),
    ("high_risk", r"high-risk"),
    ("not_approved", r"not merging: (no owner APPROVED|the owner asked)"),
    ("checks", r"checks not green|requires CI"),
    ("not_mergeable", r"not cleanly mergeable|PR is not open|draft|forks are never|not a \S+ branch|changed files"),
    ("repo_mismatch", r"repo mismatch"),
    ("cap", r"cap reached"),
    ("fix_failed", r"same error|fix attempts|survives"),
    ("scope", r"outside the (approved )?plan|scope"),
    ("dependency", r"dependency|external service|subscription|cost"),
]
MODEL = re.compile(r"(?im)^Model:[ \t]*(haiku|sonnet|opus|fable)\b([^\n]*)$")
FIELDS = {"number": int, "state": str, "outcome": str, "plans": int, "revisions": int, "verdicts": int,
          "review_rounds": int, "parks": int, "park_reasons": list, "replies": int, "merged": bool,
          "relayed_approval": bool, "model_gaps": int, "models": dict, "risk": (str, type(None)),
          "rejected_comments": int, "evidence": dict}
ENUMS = {"state": {"open", "closed"}, "outcome": {"done", "parked", "open", "closed"},
         "risk": {"low", "normal", "high", None}}
CATEGORY_NAMES = {name for name, _ in PARK_CATEGORIES} | {"other"}
TIER_NAMES = {"haiku", "sonnet", "opus", "fable"}


def park_category(text):
    for name, rx in PARK_CATEGORIES:
        if re.search(rx, text or "", re.I):
            return name
    return "other"


def validate(record):
    """Reject anything that is not one of the fixed fields with a fixed-shape value."""
    if set(record) != set(FIELDS):
        raise ValueError(f"unexpected fields: {sorted(set(record) ^ set(FIELDS))}")
    for key, kind in FIELDS.items():
        if not isinstance(record[key], kind) or (kind is int and isinstance(record[key], bool)):
            raise ValueError(f"{key} has the wrong type")
    for key, allowed in ENUMS.items():
        if record[key] not in allowed:
            raise ValueError(f"{key} is not one of the fixed values")
    if not set(record["park_reasons"]) <= CATEGORY_NAMES:
        raise ValueError("park_reasons holds a value outside the fixed categories")
    if not all(k in {"plan", "result", "verdict", "summary"} and v in TIER_NAMES for k, v in record["models"].items()):
        raise ValueError("models holds a value outside the fixed tiers")
    return record


def record_for(issue, owner):
    msgs = thread(issue)
    rejected = sum(1 for m in msgs[1:] if not is_owner(m, owner))
    replies = agent_replies(msgs, owner)
    kinds = [h.get("type") for _, h in replies]
    verdicts = [h for _, h in replies if h.get("type") == "verdict"]
    parks = [(i, h) for i, h in replies if h.get("type") == "question"]
    models, gaps, risk, merged = {}, 0, None, False
    for i, h in replies:
        body = msgs[i]["body"]
        m = MODEL.search(body)
        if m and h.get("type") in ("plan", "result", "verdict", "summary"):
            models[h["type"]] = m.group(1).lower()
            gaps += 1 if re.search(r"\bwanted\b", m.group(2), re.I) else 0
        if h.get("type") == "plan":
            risk = declared_risk(body) or risk
        if h.get("type") == "summary":
            line = re.search(r"(?im)^[ \t>*-]*\**Merged\**[ \t]*:[ \t]*\**[ \t]*(.*)$", body)
            merged = bool(line and not re.match(r"(no|not|none)\b", line.group(1).strip(), re.I))
    labels = label_names(issue.get("labels"))
    state = issue.get("state") or "open"
    outcome = ("done" if "done" in labels else "parked" if "needs-leo" in labels else
               "open" if state == "open" else "closed")
    relayed = any(k.get("relayed") for k in owner_keywords(msgs, owner, 0))
    return validate({
        "number": int(issue["number"]), "state": "closed" if state == "closed" else "open", "outcome": outcome,
        "plans": kinds.count("plan"), "revisions": max(kinds.count("plan") - 1, 0), "verdicts": len(verdicts),
        "review_rounds": sum(1 for h in verdicts if h.get("verdict") == "changes"), "parks": len(parks),
        "park_reasons": [park_category(msgs[i]["body"]) for i, _ in parks], "replies": len(replies),
        "merged": merged, "relayed_approval": relayed, "model_gaps": gaps, "models": models, "risk": risk,
        "rejected_comments": rejected,
        "evidence": {"verified": ["plans", "revisions", "verdicts", "review_rounds", "parks", "replies", "outcome",
                                  "relayed_approval", "model_gaps", "models", "risk"],
                     "uncertain": ["park_reasons", "merged"], "rejected": rejected},
    })


def collect(repo, owner, fixtures=None, limit=50):
    if fixtures:
        issues = from_fixture(fixtures, "issues.json", [])
    else:
        issues = get_json(f"repos/{repo}/issues?state=all&sort=updated&direction=desc&per_page=100")
    records = []
    for issue in issues[:limit]:
        if "pull_request" in issue or login(issue.get("user")).lower() != owner.lower():
            continue
        if not is_autopilot(issue.get("body")):
            continue
        n = issue["number"]
        comments = (from_fixture(fixtures, f"{n}.comments.json", []) if fixtures else
                    get_all(f"repos/{repo}/issues/{n}/comments"))
        records.append(record_for(dict(issue, comments=comments), owner))
    return {"repo": repo, "owner": owner, "collected_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "issues": records, "api_calls": len(CALLS)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--owner", default=None)
    ap.add_argument("--config", default=None)
    ap.add_argument("--limit", type=int, default=50, help="the most recently updated issues to look at")
    ap.add_argument("--fixtures", default=None)
    ap.add_argument("--out", default=None, help="write the JSON here instead of stdout")
    a = ap.parse_args()
    try:
        cfg = loop_config.load(a.config)
        set_owner_associations(cfg["owner_associations"])
        owner = loop_config.resolve_owner(a.repo, a.owner, cfg, a.fixtures)
        result = collect(a.repo, owner, a.fixtures, a.limit)
    except (ApiError, ValueError, KeyError) as e:
        json.dump({"ok": False, "error": str(e)}, sys.stdout, indent=2)
        print()
        sys.exit(2)
    text = json.dumps(result, indent=2)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)


if __name__ == "__main__":
    main()
