#!/usr/bin/env python3
"""Decide which github-loop roles to fire for one GitHub event. No secrets, no network.

Usage: route_event.py --event <name> --payload <file> --owner <login> [--output <file>]
Used by the loop-fire workflow (references/events.md); the decision table lives in KEYWORD_ROLES and HEADER_ROLES.
Prints the roles (one per line). With --output, also appends "roles=lead,code" for GitHub Actions.
Comment text is only parsed here, never printed, so it cannot reach a shell or a payload.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loop_guard import KEYWORD, first_header, is_autopilot  # noqa: E402

KEYWORD_ROLES = {"APPROVED": ["code"], "REVISE:": ["lead"], "CONTINUE:": ["lead", "code"]}
HEADER_ROLES = {("lead", "approval"): ["code"], ("code", "result"): ["lead"],
                ("lead", "verdict"): ["code"]}


def _login(value):
    return (value or {}).get("login", "") if isinstance(value, dict) else ""


def _is_owner(person, owner):
    return _login(person).lower() == owner.lower() and \
        person.get("author_association") in (None, "", "OWNER")


def route_issue(payload, owner):
    issue = payload.get("issue") or {}
    if "pull_request" in issue or not _is_owner(issue.get("user"), owner):
        return []
    if _login(payload.get("sender")).lower() != owner.lower():
        return []
    if payload.get("action") not in ("opened", "labeled"):
        return []
    if payload.get("action") == "labeled" and (payload.get("label") or {}).get("name") != "to-code":
        return []
    names = {l.get("name") for l in issue.get("labels") or []}
    if "to-code" not in names:
        return []
    return ["lead"] if is_autopilot(issue.get("body")) else ["code"]


def route_comment(payload, owner):
    issue = payload.get("issue") or {}
    comment = payload.get("comment") or {}
    if payload.get("action") != "created" or "pull_request" in issue:
        return []
    if not _is_owner(issue.get("user"), owner) or not _is_owner(comment.get("user"), owner):
        return []
    body = comment.get("body") or ""
    head = first_header(body)
    if head is not None:
        if head.get("type") == "result" and head.get("phase") != "2":
            return []
        return list(HEADER_ROLES.get((head.get("from"), head.get("type")), []))
    m = KEYWORD.match(body)
    return list(KEYWORD_ROLES.get(m.group(1), [])) if m else []


def route(event, payload, owner):
    if event == "issues":
        return route_issue(payload, owner)
    if event == "issue_comment":
        return route_comment(payload, owner)
    if event == "workflow_dispatch":
        role = (payload.get("inputs") or {}).get("role")
        ok = _login(payload.get("sender")).lower() == owner.lower()
        return [role] if ok and role in ("lead", "code") else []
    return []


def issue_number(payload):
    n = (payload.get("issue") or {}).get("number")
    return n if isinstance(n, int) and n > 0 else 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True)
    ap.add_argument("--payload", required=True)
    ap.add_argument("--owner", required=True)
    ap.add_argument("--output")
    a = ap.parse_args(argv)
    with open(a.payload, encoding="utf-8") as f:
        payload = json.load(f)
    roles = route(a.event, payload, a.owner)
    for r in roles:
        print(r)
    if not roles:
        print("nothing to fire", file=sys.stderr)
    if a.output:
        with open(a.output, "a", encoding="utf-8") as f:
            f.write("roles=%s\nissue=%d\n" % (",".join(roles), issue_number(payload)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
