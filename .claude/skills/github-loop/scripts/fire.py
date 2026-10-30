#!/usr/bin/env python3
"""Start the loop's scheduled tasks through their API trigger. The only code that sees secrets.

Usage: fire.py --roles lead,code --issue N --event NAME [--dry-run]
Env per role: LOOP_<ROLE>_FIRE_URL and LOOP_<ROLE>_FIRE_TOKEN.
Never prints a URL, a secret value, a header or a response body.
"""
import argparse
import json
import os
import re
import sys
import urllib.request

URL_OK = re.compile(r"\Ahttps://api\.anthropic\.com/v1/claude_code/routines/trig_[A-Za-z0-9]+/fire\Z")
EVENTS = {"issues", "issue_comment", "workflow_dispatch"}
ROLES = ("lead", "code")
TIMEOUT = 20


def payload_text(role, issue, event):
    return "loop-fire v1 role=%s issue=%d event=%s" % (role, issue, event)


def fire_role(role, issue, event, env, opener=urllib.request.urlopen):
    """Return 'ok', 'skipped' (secrets not set up) or 'failed'. Output never holds a secret."""
    url = env.get("LOOP_%s_FIRE_URL" % role.upper(), "").strip()
    secret = env.get("LOOP_%s_FIRE_TOKEN" % role.upper(), "").strip()
    if not url and not secret:
        print("::warning::%s: fire secrets are not set up yet, skipped" % role)
        return "skipped"
    if not url or not secret:
        print("::error::%s: only one of the two fire secrets is set" % role)
        return "failed"
    if not URL_OK.match(url):
        print("::error::%s: the fire URL is not an api.anthropic.com routine fire URL" % role)
        return "failed"
    req = urllib.request.Request(
        url, method="POST",
        data=json.dumps({"text": payload_text(role, issue, event)}).encode(),
        headers={"Authorization": "Bearer " + secret,
                 "anthropic-beta": "experimental-cc-routine-2026-04-01",
                 "anthropic-version": "2023-06-01",
                 "Content-Type": "application/json"})
    try:
        with opener(req, timeout=TIMEOUT) as resp:
            status = getattr(resp, "status", 200)
    except Exception as exc:  # never print str(exc): it can hold the URL
        code = getattr(exc, "code", None)
        print("::error::%s: fire failed (%s)" % (role, code if code else type(exc).__name__))
        return "failed"
    if not 200 <= status < 300:
        print("::error::%s: fire failed (HTTP %s)" % (role, status))
        return "failed"
    print("%s: fired" % role)
    return "ok"


def main(argv=None, env=None, opener=urllib.request.urlopen):
    env = os.environ if env is None else env
    ap = argparse.ArgumentParser()
    ap.add_argument("--roles", default="")
    ap.add_argument("--issue", type=int, default=0)
    ap.add_argument("--event", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    roles = [r for r in a.roles.split(",") if r]
    if a.event not in EVENTS or any(r not in ROLES for r in roles) or a.issue < 0:
        print("::error::bad arguments")
        return 1
    if not roles:
        print("nothing to fire")
        return 0
    failed = False
    for role in roles:
        if a.dry_run:
            print("dry run: would fire %s with text '%s'" % (role, payload_text(role, a.issue, a.event)))
            continue
        if fire_role(role, a.issue, a.event, env, opener) == "failed":
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
