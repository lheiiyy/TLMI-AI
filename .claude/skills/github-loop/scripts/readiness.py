#!/usr/bin/env python3
"""GitHub-side readiness matrix for the loop, from evidence, in one read-only call.

    python scripts/readiness.py --repo <owner>/<repo> [--owner LOGIN] [--markdown] [--create-labels]

Each row gets one status: READY, NEEDS SETUP, BLOCKED, NOT REQUIRED or UNVERIFIED, with
the evidence, the impact, who acts, and which stage it blocks. Paste the --markdown table
into the plan's Readiness section, then add the project's own rows (connectors, secrets,
hosting, database, browser tests) that this script cannot see.

What it cannot see is reported as UNVERIFIED, never as READY: classic branch protection
(the session token cannot read it), GitHub Pages (the proxy blocks that API), and anything
outside GitHub. --create-labels creates missing loop labels (a safe, authorized setup step).
Exit 0 always unless the repository itself cannot be read (exit 2).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as loop_config  # noqa: E402
from ghapi import ApiError, call  # noqa: E402

LABELS = {"to-code": "0E8A16", "code-working": "FBCA04", "awaiting-approval": "5319E7",
          "to-review": "1D76DB", "reviewed": "0052CC", "needs-leo": "D93F0B", "done": "6E7781"}


def get(path, fixtures, name):
    """(ok, data_or_error). Fixtures: a missing file means the API refused (403)."""
    if fixtures:
        full = os.path.join(fixtures, name)
        if not os.path.exists(full):
            return False, "403 (fixture missing)"
        with open(full, encoding="utf-8") as f:
            return True, json.load(f)
    try:
        out = call([path])
    except ApiError as e:
        return False, str(e).split("failed: ", 1)[-1][:160]
    try:
        return True, json.loads(out)
    except json.JSONDecodeError:
        return False, "non-JSON reply"


def row(item, status, evidence, impact="", who="", blocks=""):
    return {"item": item, "status": status, "evidence": evidence, "impact": impact, "who": who, "blocks": blocks}


def audit(repo, owner, fixtures=None, create_labels=False):
    ok, info = get(f"repos/{repo}", fixtures, "repo.json")
    if not ok:
        return None, f"cannot read {repo}: {info}"
    rows = [row("Repository access", "READY", f"{info.get('full_name')}, default branch {info.get('default_branch')}, "
                f"{info.get('visibility', 'unknown')}")]
    base = info.get("default_branch", "main")
    if info.get("visibility") == "public":
        rows.append(row("Public repository", "READY", "public: every commit is world-readable",
                        "never commit confidential documents, real staff data or secrets", "everyone", "none"))

    ok, labels = get(f"repos/{repo}/labels?per_page=100", fixtures, "labels.json")
    have = {l["name"] for l in labels} if ok else set()
    missing = [l for l in LABELS if l not in have]
    if missing and create_labels and not fixtures:
        for name in list(missing):
            try:
                call(["-X", "POST", f"repos/{repo}/labels", "-f", f"name={name}", "-f", f"color={LABELS[name]}"])
                missing.remove(name)
            except ApiError:
                pass  # stays NEEDS SETUP
    rows.append(row("Loop labels", "READY" if not missing else "NEEDS SETUP",
                    "all present" if not missing else "missing: " + ", ".join(missing),
                    "triage cannot route work without them", "Lead (--create-labels)", "implementation"))

    for item, path, name, need in [
        ("github-loop skill on the default branch", f"repos/{repo}/contents/.claude/skills/github-loop/SKILL.md?ref={base}",
         "skill.json", "scheduled runs read the skill from the default branch"),
        ("Autopilot issue form", f"repos/{repo}/contents/.github/ISSUE_TEMPLATE/autopilot.yml?ref={base}",
         "form.json", "the owner files requests without editing labels")]:
        ok, _ = get(path, fixtures, name)
        rows.append(row(item, "READY" if ok else "NEEDS SETUP", "found" if ok else "not found", need, "Lead", "plan"))

    ok, wf = get(f"repos/{repo}/actions/workflows", fixtures, "workflows.json")
    count = wf.get("total_count", 0) if ok else None
    rows.append(row("CI workflows (GitHub Actions)",
                    "READY" if count else ("NEEDS SETUP" if ok else "UNVERIFIED"),
                    f"{count} workflow(s)" if ok else f"cannot read: {wf}",
                    "without CI, tests run only inside Claude sessions and no required check can gate the merge",
                    "Code adds a workflow (needs push rights to .github/workflows)", "merge (as a gate)"))

    ok, rules = get(f"repos/{repo}/rulesets", fixtures, "rulesets.json")
    approvals = 0
    if ok:
        for rs in rules:
            for r in rs.get("rules", []) or []:
                if r.get("type") == "pull_request":
                    approvals = max(approvals, (r.get("parameters") or {}).get("required_approving_review_count", 0))
        rows.append(row("Rulesets", "READY", f"{len(rules)} ruleset(s)" + (f", {approvals} required approval(s)"
                                                                              if approvals else "")))
    else:
        rows.append(row("Rulesets", "UNVERIFIED", f"cannot read: {rules}", "", "the owner checks Settings → Rules", "merge"))
    ok, prot = get(f"repos/{repo}/branches/{base}/protection", fixtures, "protection.json")
    if ok:
        prr = (prot.get("required_pull_request_reviews") or {}).get("required_approving_review_count", 0)
        approvals = max(approvals, prr)
        checks = (prot.get("required_status_checks") or {}).get("contexts", [])
        rows.append(row(f"Branch protection on {base}", "READY", f"{prr} required approval(s); required checks: "
                        f"{', '.join(checks) or 'none'}"))
    else:
        rows.append(row(f"Branch protection on {base}", "UNVERIFIED", "the session token cannot read it (403)",
                        "an unseen rule may still refuse a merge; the merge script reports it", "the owner checks Settings → "
                        "Branches", "merge"))
    rows.append(row("Formal GitHub approval by the Lead",
                    "BLOCKED" if approvals else "NOT REQUIRED",
                    f"all agents post as {owner}; GitHub never lets a PR author approve their own PR"
                    + (f", and {approvals} approval(s) are required" if approvals else
                       "; no required approvals were found, so the Lead's verdict comment is the review record"),
                    "merges stop until a different account approves" if approvals else "",
                    "the owner: remove the approval rule and require status checks instead, or add a second "
                    "reviewer account" if approvals else "", "merge" if approvals else ""))

    ok, cfg = True, info
    if not cfg.get("allow_merge_commit", True):
        rows.append(row("Merge method", "NEEDS SETUP", "merge commits are disabled", "plans default to merge "
                        "commits; pick an allowed method in the plan", "Lead", "merge"))
    else:
        rows.append(row("Merge method", "READY", "merge commits allowed"))

    ok, co = get(f"repos/{repo}/contents/.github/CODEOWNERS?ref={base}", fixtures, "codeowners.json")
    rows.append(row("CODEOWNERS", "UNVERIFIED" if ok else "NOT REQUIRED", "present: code owner reviews may be "
                    "required" if ok else "none found"))

    ok, prs = get(f"repos/{repo}/pulls?state=open&per_page=100", fixtures, "pulls.json")
    if ok:
        others = [f"#{p['number']} {p['head']['ref']}" for p in prs if not p["head"]["ref"].startswith("claude/")]
        rows.append(row("Open pull requests", "READY", f"{len(prs)} open" + (f"; not from the loop: "
                        f"{', '.join(others)}" if others else ""), "check for overlapping files before building"))
    rows.append(row("GitHub Pages / hosting", "UNVERIFIED", "the session proxy blocks the Pages API",
                    "deploys need hosting enabled once", "the owner (Settings → Pages) when the plan deploys", "deployment"))
    return rows, None


def markdown(rows):
    out = ["| Item | Status | Evidence | Impact | Who | Blocks |", "|---|---|---|---|---|---|"]
    out += [f"| {r['item']} | {r['status']} | {r['evidence']} | {r['impact']} | {r['who']} | {r['blocks']} |"
            for r in rows]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--owner", default=None, help="the owner's login (default: config, then the repo's owner)")
    ap.add_argument("--config", default=None)
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--create-labels", action="store_true")
    ap.add_argument("--fixtures", default=None)
    a = ap.parse_args()
    try:
        owner = loop_config.resolve_owner(a.repo, a.owner, loop_config.load(a.config), a.fixtures)
    except (ApiError, ValueError) as e:
        json.dump({"error": str(e)}, sys.stdout)
        print()
        sys.exit(2)
    rows, err = audit(a.repo, owner, a.fixtures, a.create_labels)
    if err:
        json.dump({"error": err}, sys.stdout)
        print()
        sys.exit(2)
    if a.markdown:
        print(markdown(rows))
    else:
        json.dump({"repo": a.repo, "rows": rows,
                   "not_ready": [r["item"] for r in rows if r["status"] in ("NEEDS SETUP", "BLOCKED", "UNVERIFIED")]},
                  sys.stdout, indent=2)
        print()


if __name__ == "__main__":
    main()
