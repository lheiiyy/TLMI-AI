#!/usr/bin/env python3
"""Recommend-only improvements from collected outcomes. It never edits a file.

    outcomes.py --repo <owner>/<repo> --out outcomes.json
    improve.py --input outcomes.json [--min-count 3]

A pattern becomes a proposal only when it shows up on at least --min-count issues (default 3).
Each proposal names its evidence (the issue numbers, and whether the counts are verified from
headers or uncertain because they come from free text) and its area. Proposals that touch
approval, merging, secrets, authorization or the scheduled tasks need the owner's APPROVED
before anyone changes anything; every adopted change is its own PR with a changelog line.
Records whose shape is not the fixed outcome shape are rejected, so text from a comment can
never become a proposal. Set "improve": false in .github/github-loop.json to switch it off.
Exit 0, or 2 on bad input.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as loop_config  # noqa: E402
from outcomes import validate  # noqa: E402

GUARDED = {"approval", "merge", "secrets", "authorization", "setup"}
PARK_ADVICE = {
    "stale": ("setup", "Runs stop after claiming an issue. Check the scheduled task's run history and its time "
                       "limit, and keep one issue per run."),
    "stalled": ("setup", "A role's scheduled task did not pick up its work. Check that both tasks are enabled and "
                         "on schedule, and turn on push notifications for them."),
    "merge_tap": ("merge", "A repository rule refuses the scripted merge. Check branch protection: require status "
                           "checks, not approvals (setup.md, step 5)."),
    "not_approved": ("approval", "Merges reached the gate without a current approval. Remind the owner to reply "
                                 "APPROVED after the latest plan, and check that agents do not build early."),
    "checks": ("process", "Checks fail at merge time. Run the full test command before ready-for-review, and add "
                          "the project's tests to the CI workflow."),
    "not_mergeable": ("process", "PRs are not mergeable at merge time. Merge origin/main into the branch before "
                                 "ready-for-review."),
    "out_of_scope": ("requirements", "PRs change files outside the plan's scope. List every folder the tasks "
                                     "touch on the plan's Files in scope line, or ask for a REVISE: before building."),
    "cap": ("process", "Threads hit a cap. Split requests into smaller ones (six tasks or fewer)."),
    "fix_failed": ("process", "Fixes fail twice. Add the failing case as a test before fixing, and reproduce it "
                              "first (qa expert note)."),
    "scope": ("requirements", "Builds need changes outside the plan. Tighten scope and out-of-scope in plans "
                              "(requirements expert note)."),
    "dependency": ("requirements", "Builds need new dependencies or services. Ask for them in the plan's readiness "
                                   "section instead of during the build."),
    "repo_mismatch": ("process", "Requests name another repo. Check the Repo field of the issue form."),
}


def proposals(records, min_count=3):
    out = []

    def add(pid, area, count, issues, evidence, text):
        out.append({"id": pid, "area": area, "count": count, "issues": sorted(issues), "evidence": evidence,
                    "needs_owner_approval": area in GUARDED, "proposal": text,
                    "applies": "never automatically; open one PR for it after the owner agrees"})

    revised = [r["number"] for r in records if r["revisions"] >= 2]
    if len(revised) >= min_count:
        add("plan-revisions", "requirements", len(revised), revised, "verified",
            "Plans needed two or more revisions. Ask the owner's open questions in the first plan and list "
            "assumptions (requirements expert note).")
    rounds = [r["number"] for r in records if r["review_rounds"] >= 2]
    if len(rounds) >= min_count:
        add("review-rounds", "process", len(rounds), rounds, "verified",
            "Builds needed two or more review rounds. Read the expert notes route.py lists before building, and run "
            "the reviewer's checklist yourself before ready-for-review.")
    gaps = [r["number"] for r in records if r["model_gaps"]]
    if len(gaps) >= min_count:
        add("model-gaps", "setup", len(gaps), gaps, "verified",
            "Steps wanted a stronger model than the task runs. Create the Lead Deep task, or ask the owner to change "
            "the task's model (models.md).")
    by_reason = {}
    for r in records:
        for reason in set(r["park_reasons"]):
            by_reason.setdefault(reason, []).append(r["number"])
    for reason, issues in sorted(by_reason.items()):
        if reason in PARK_ADVICE and len(issues) >= min_count:
            area, text = PARK_ADVICE[reason]
            add(f"park-{reason}", area, len(issues), issues, "uncertain", text)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, help="outcomes.json from outcomes.py")
    ap.add_argument("--min-count", type=int, default=3)
    ap.add_argument("--config", default=None)
    a = ap.parse_args()
    try:
        if not loop_config.load(a.config).get("improve", True):
            json.dump({"disabled": True, "proposals": []}, sys.stdout, indent=2)
            print()
            return
        with open(a.input, encoding="utf-8") as f:
            data = json.load(f)
        records, rejected = [], 0
        for rec in data.get("issues", []):
            try:
                records.append(validate(dict(rec)))
            except (ValueError, TypeError):
                rejected += 1
    except (OSError, ValueError) as e:
        json.dump({"ok": False, "error": str(e)}, sys.stdout, indent=2)
        print()
        sys.exit(2)
    json.dump({"issues_read": len(records), "rejected_records": rejected,
               "proposals": proposals(records, a.min_count)}, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
