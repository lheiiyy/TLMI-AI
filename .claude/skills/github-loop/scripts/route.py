#!/usr/bin/env python3
"""Route one github-loop step: which experts to read, the risk tier, the extra gates and the model.

    route.py --step plan   --text issue.md --session sonnet
    route.py --step build  --paths <files the plan lists> --text issue.md --session sonnet
    route.py --step review --git-range origin/main...<head> --text issue.md --round 2 --session sonnet

Prints one JSON object:
  risk, risk_reasons   low | normal | high, from rules.py (the same rules the merge gate uses)
  experts              [{id, note}] from references/experts/registry.json; read only these notes
  gates                every gate that applies. The base gates always apply; routing only adds
  model                the pick_model.py report for this step (tier, action, model_line)

Rules, not judgment, set the risk: a sensitive file or the skill itself, risk words in the
request's Objective, or the plan's declared `Risk:` (--declared-risk) make it high. Nothing can
lower a tier a rule set. Documentation-only changes route to the documentation expert alone.
Adding an expert is a registry edit only (an entry plus a note of 25 lines or fewer). Path patterns
look at code files only, unless the entry sets "match_docs": true.
Exit 0, or 2 on bad input.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pick_model import objective_of, paths_from_git, pick  # noqa: E402
from rules import DOCS, RISK_TEXT, is_docs_only, norm, risk_tier  # noqa: E402

REGISTRY = os.path.join(os.path.dirname(HERE), "references", "experts", "registry.json")
STEPS = ("plan", "revise", "build", "fix", "review")
BASE_GATES = ["the owner's APPROVED on the latest plan", "a Lead verdict on the exact head",
              "no failing or pending checks on that head"]
HIGH_GATES = ["the owner merges (merge exits 8 until a Merge tap or the owner's MERGE in a chat session)",
              "review at opus when it can run, else say the gap in the Model line",
              "the full review checklist on every changed line, every round"]
EXPERT_GATES = {"database": "a migration with a rollback note for every schema change",
                "deployment": "deploy only as the plan's release policy says, verified separately",
                "security": "no secret, ID, e-mail address or real name in the diff; access never made wider"}


def load_registry(path=REGISTRY):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    experts = data.get("experts")
    if not isinstance(experts, list) or not all(isinstance(e, dict) and e.get("id") for e in experts):
        raise ValueError(f"{path}: experts must be a list of objects with an id")
    return experts


def matches(expert, step, paths, goal, tier):
    """Path patterns look at code files only (a note named database.md is not a database change), unless the
    expert sets "match_docs"."""
    if not expert.get("match_docs"):
        paths = [p for p in paths if not DOCS.search(p) or p.startswith(".github/")]
    if step in expert.get("steps", []):
        return True
    if tier in expert.get("risk", []):
        return True
    if expert.get("min_files") and len(paths) >= expert["min_files"]:
        return True
    if any(re.search(rx, p, re.I) for rx in expert.get("paths", []) for p in paths):
        return True
    return any(re.search(rx, goal, re.I) for rx in expert.get("words", []))


def route(step, paths=(), text="", declared=None, round_=1, attempt=1, tasks=0, session=None, registry=REGISTRY):
    if step not in STEPS:
        raise ValueError(f"unknown step {step!r}; use one of {', '.join(STEPS)}")
    paths = norm(paths)
    goal = objective_of(text or "")
    tier, reasons = risk_tier(paths, declared)
    words = RISK_TEXT.search(goal)
    if words and tier != "high":
        tier, reasons = "high", reasons + [f"the request mentions {words.group(1).lower()}"]
    experts = load_registry(registry)
    if is_docs_only(paths) and tier != "high":
        chosen = [e for e in experts if e["id"] == "documentation"]
    else:
        chosen = [e for e in experts if matches(e, step, paths, goal, tier)]
    gates = list(BASE_GATES)
    if tier == "high":
        gates += HIGH_GATES
    gates += [EXPERT_GATES[e["id"]] for e in chosen if e["id"] in EXPERT_GATES and EXPERT_GATES[e["id"]] not in gates]
    model = pick(step, paths, text, tasks, attempt, round_, session, declared="high" if tier == "high" else None)
    return {"step": step, "risk": tier, "risk_reasons": reasons,
            "experts": [{"id": e["id"], "note": e.get("note")} for e in chosen],
            "gates": gates, "model": model, "files": len(paths)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--step", required=True, choices=STEPS)
    ap.add_argument("--paths", nargs="*", default=[])
    ap.add_argument("--git-range", default=None)
    ap.add_argument("--text", default=None, help="the issue body file, or - for stdin")
    ap.add_argument("--declared-risk", choices=("low", "normal", "high"), default=None,
                    help="the plan's Risk: line; it can raise the tier, never lower it")
    ap.add_argument("--round", type=int, default=1, dest="round_")
    ap.add_argument("--attempt", type=int, default=1)
    ap.add_argument("--tasks", type=int, default=0)
    ap.add_argument("--session", default=None, help="model of the running task")
    ap.add_argument("--registry", default=REGISTRY)
    a = ap.parse_args()
    try:
        paths = list(a.paths) + (paths_from_git(a.git_range) if a.git_range else [])
        text = ""
        if a.text == "-":
            text = sys.stdin.read()
        elif a.text:
            with open(a.text, encoding="utf-8") as f:
                text = f.read()
        out = route(a.step, paths, text, a.declared_risk, a.round_, a.attempt, a.tasks, a.session, a.registry)
    except (ValueError, OSError) as e:
        json.dump({"ok": False, "error": str(e)}, sys.stdout, indent=2)
        print()
        sys.exit(2)
    json.dump(out, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
