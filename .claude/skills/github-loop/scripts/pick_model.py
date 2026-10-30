#!/usr/bin/env python3
"""Pick the model tier for one github-loop step, from facts and not from a feeling.

    pick_model.py --step review --git-range origin/main...HEAD --session sonnet
    pick_model.py --step plan --text issue.md --session sonnet
    pick_model.py --step fix --paths src/auth.js tests/auth.test.js --attempt 2 --session sonnet

Prints a JSON report: tier (haiku, sonnet or opus), action ("run inline" or
"delegate"), the reasons, and the signals it saw. Exit 0, or 2 on bad input.

Rules (the table in references/models.md mirrors them):
- merge, verify: haiku (a scripted command and its exit code).
- report: sonnet (it states results as facts).
- plan, revise, review: sonnet is the floor. They go to opus on risk, on a big
  change, on an architecture-heavy goal, on the third review round, and on the
  second plan revision.
- build: sonnet (haiku for documentation only); opus only when risky AND big.
- fix: sonnet (haiku for documentation only); opus on risk, on the third review
  round, and on the second attempt at the same failure (before the run parks).
- The owner can force a tier with `Model: opus` in the request, or with the Model field of
  the issue form. It applies to plan, revise, build, fix and review.
- fable (the top tier) is never picked. It costs the most, so only the owner asks for it.

`delegate` means the tier is above the model this task runs on (--session): hand
the judgment to a subagent with that model and keep the scripts and the posting in
this session. A lower tier than the session's runs inline, because a subagent
restarts cold and costs more than it saves.
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rules import ARCHITECTURE, DOCS, RISK_PATH, RISK_TEXT, is_docs_only, norm, sensitive_paths  # noqa: E402,F401

RANK = {"haiku": 1, "sonnet": 2, "opus": 3, "fable": 4}
STEPS = ["plan", "revise", "build", "fix", "review", "merge", "verify", "report"]
THINKING = {"plan", "revise", "build", "fix", "review"}  # steps the owner may force a tier for

FORCED = re.compile(r"(?im)^[ \t]*(?:#{1,4}[ \t]*)?model\b(?![ \t]+plan)[^\n:]*?(?::[ \t]*|\n+[ \t]*)"
                    r"(auto|haiku|sonnet|opus)\b")
HEADING = re.compile(r"(?m)^#{2,3}[ \t]+(.+?)[ \t]*$")


def parse_session(value):
    """The model family of the running task: 'sonnet', 'claude-opus-5-5' or 'Opus 5.5' all work."""
    if not value:
        return "sonnet"
    low = value.lower()
    for name in ("haiku", "sonnet", "opus", "fable", "mythos"):
        if name in low:
            return "fable" if name == "mythos" else name
    raise ValueError(f"unknown model: {value!r}; use haiku, sonnet or opus")


def objective_of(text):
    """The Objective section of an autopilot request. The rest of the template (Phase 1, constraints) holds
    boilerplate words such as 'schema' and 'credentials', which must not count as risk. Without an Objective
    heading (a free-form request), the whole text is used."""
    heads = list(HEADING.finditer(text))
    for n, h in enumerate(heads):
        if h.group(1).strip().lower() == "objective":
            end = heads[n + 1].start() if n + 1 < len(heads) else len(text)
            return text[h.end():end]
    return text


def forced_tier(text):
    m = FORCED.search(text or "")
    if m and m.group(1).lower() != "auto":
        return m.group(1).lower()
    return None


def pick(step, paths=(), text="", tasks=0, attempt=1, round_=1, session=None, declared=None):
    if step not in STEPS:
        raise ValueError(f"unknown step {step!r}; use one of {', '.join(STEPS)}")
    paths = norm(paths)
    docs_only = is_docs_only(paths)
    risk_paths = sensitive_paths(paths)  # shared with route.py and the merge gate (rules.py)
    goal = objective_of(text or "")
    risk_text = RISK_TEXT.search(goal)
    risky = bool(risk_paths or risk_text or declared == "high")
    large = len(paths) >= 8 or tasks >= 5
    heavy = bool(ARCHITECTURE.search(goal))
    why_risk = ("sensitive files: " + ", ".join(risk_paths[:3])) if risk_paths else (
        f"the goal mentions {risk_text.group(1).lower()}" if risk_text else
        "the plan declares Risk: high" if declared == "high" else "")
    forced = forced_tier(text) if step in THINKING else None

    if step in ("merge", "verify"):
        tier, why = "haiku", "a scripted command: run it and read its exit code"
    elif forced:
        tier, why = forced, f"the owner's request sets the model to {forced}"
    elif step == "report":
        tier, why = "sonnet", "the report states results as facts, so keep it accurate"
    elif step in ("plan", "revise"):
        tier, why = "sonnet", "planning needs real reasoning, so sonnet is the floor"
        if risky:
            tier, why = "opus", why_risk + "; plan it with the stronger model"
        elif heavy:
            tier, why = "opus", "an architecture-heavy goal"
        elif large:
            tier, why = "opus", "a big change"
        elif step == "revise" and round_ >= 2:
            tier, why = "opus", "the owner has asked for a second revision"
    elif step == "review":
        tier, why = "sonnet", "independent review: sonnet is the floor, even for documentation"
        if risky:
            tier, why = "opus", why_risk + "; review it with the stronger model"
        elif large:
            tier, why = "opus", "a big diff"
        elif round_ >= 3:
            tier, why = "opus", "the third review round: the earlier fixes did not settle it"
    elif step == "build":
        tier, why = ("haiku", "documentation only") if docs_only else ("sonnet", "ordinary implementation")
        if risky and large:
            tier, why = "opus", "a big change in sensitive code" + (": " + why_risk if why_risk else "")
    else:  # fix
        tier, why = ("haiku", "documentation only") if docs_only else ("sonnet", "an ordinary fix")
        if attempt >= 2:
            tier, why = "opus", "the second attempt at the same failure: escalate before parking"
        elif risky:
            tier, why = "opus", why_risk + "; fix it with the stronger model"
        elif round_ >= 3:
            tier, why = "opus", "the third review round: the earlier fixes did not settle it"

    running = parse_session(session)
    if RANK[tier] > RANK[running]:
        action = "delegate"
        note = (f"Hand the judgment to a subagent with model={tier}; keep the scripts and the posting in this "
                f"session. With no Agent tool, run inline and say so in the reply.")
        lines = {"subagent": f"Model: {tier} (via subagent)",
                 "inline": f"Model: {running} (wanted {tier}; ran inline, no subagent)"}
    elif RANK[tier] < RANK[running]:
        action = "run inline"
        note = f"{tier} would be enough. Run inline, because a subagent restarts cold and costs more than it saves."
        lines = {"inline": f"Model: {running} (wanted {tier}; ran inline)"}
    else:
        action = "run inline"
        note = "This task's model fits."
        lines = {"inline": f"Model: {running}"}
    return {
        "step": step, "tier": tier, "action": action, "session": running, "reasons": [why], "note": note,
        "model_line": lines,  # paste the one that is true; check_reply.py rejects a reply without it
        "forced": bool(forced),
        "signals": {"docs_only": docs_only, "risk_paths": risk_paths,
                    "risk_text": risk_text.group(1).lower() if risk_text else None,
                    "large": large, "files": len(paths), "tasks": tasks, "attempt": attempt, "round": round_},
    }


def paths_from_git(rng):
    proc = subprocess.run(["git", "diff", "--name-only", rng], capture_output=True, text=True)
    if proc.returncode != 0:
        raise ValueError(f"git diff --name-only {rng} failed: {proc.stderr.strip()[:200]}")
    return proc.stdout.split()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--step", required=True, choices=STEPS)
    ap.add_argument("--paths", nargs="*", default=[], help="changed or planned files")
    ap.add_argument("--git-range", default=None, help="take the files from git diff --name-only <range>")
    ap.add_argument("--text", default=None, help="the issue or request text file, or - for stdin")
    ap.add_argument("--tasks", type=int, default=0, help="number of tasks in the plan")
    ap.add_argument("--attempt", type=int, default=1, help="attempt at the same failure, 1 or 2")
    ap.add_argument("--round", type=int, default=1, dest="round_", help="plan revision or review round")
    ap.add_argument("--session", default=None, help="model of the running task: haiku, sonnet, opus (default sonnet)")
    ap.add_argument("--declared-risk", choices=("low", "normal", "high"), default=None,
                    help="the plan's Risk: line; high counts as a sensitive change")
    args = ap.parse_args()

    try:
        paths = list(args.paths)
        if args.git_range:
            paths += paths_from_git(args.git_range)
        text = ""
        if args.text:
            text = sys.stdin.read() if args.text == "-" else open(args.text, encoding="utf-8").read()
        report = pick(args.step, paths, text, args.tasks, args.attempt, args.round_, args.session, args.declared_risk)
    except (ValueError, OSError) as e:
        json.dump({"ok": False, "error": str(e)}, sys.stdout, indent=2)
        print()
        sys.exit(2)
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
