#!/usr/bin/env python3
"""Set up the github-loop in a repository with one command.

    python3 scripts/init_repo.py --repo <owner>/<repo> --owner <login> [--owner-name NAME]
        [--language Taglish] [--model sonnet] [--stack "..."] [--project NAME] [--dir CHECKOUT]
        [--install-skill] [--install-events] [--create-labels] [--prompts] [--force] [--dry-run]

Writes, inside the checkout (--dir, default: the git checkout the command runs in):
  .github/github-loop.json                 the repository's settings (scripts/config.py)
  .github/ISSUE_TEMPLATE/autopilot.yml     the request form, from references/templates/
  CLAUDE.md                                a short starter for the project rules, only if none exists
  .claude/skills/github-loop/              this skill, with --install-skill (never the tests)
  .github/workflows/loop-fire.yml          the event trigger that starts Lead and Code, with --install-events
A file that already exists is kept, unless it is identical (then it is unchanged) or --force replaces it.
--create-labels creates the loop labels on GitHub (readiness.py). --prompts adds the ready-to-paste Code,
Lead and Lead Deep scheduled-task prompts (references/templates/) to the report.

Prints a JSON report: each file with its status, the owner's next steps, and the prompts. Nothing is
committed or pushed: put the files in a pull request (the skill folder and `.github/` are high risk, so the
owner merges it). Exit 0, or 2 on bad input.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import package  # noqa: E402

SKILL = package.SKILL
TEMPLATES = os.path.join(SKILL, "references", "templates")
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
LOGIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
MODELS = ("haiku", "sonnet", "opus")
DEFAULT_STACK = "Describe the stack and the folders the loop may touch."
PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")
NEXT_STEPS = [
    "Put the files in a pull request. The skill folder and .github/ are high risk, so you merge it.",
    "Create the Code and Lead scheduled tasks from the printed prompts (references/setup.md, step 4). "
    "Use Sonnet, turn on push notifications, and run each every 6 hours (Code `3 */6 * * *`, "
    "Lead `33 */6 * * *`) as the slow backup.",
    "Give each task an API trigger, save the four fire values as GitHub repository secrets, and run the "
    "Loop fire workflow once as a dry run (references/events.md). Events start the tasks; the 6-hour "
    "run only catches a missed event.",
    "Do not require approvals on the main branch; every agent posts as you. Status checks are fine.",
    "File one small request with the Autopilot issue form, and answer with Comment, not Close with comment.",
]


def template(name):
    with open(os.path.join(TEMPLATES, name), encoding="utf-8") as f:
        return f.read()


def render(text, values):
    """Replace every {{key}}; a key without a value is an error, so a placeholder never ships."""
    missing = sorted({k for k in PLACEHOLDER.findall(text) if k not in values})
    if missing:
        raise ValueError(f"no value for: {', '.join(missing)}")
    return PLACEHOLDER.sub(lambda m: str(values[m.group(1)]), text)


def prompts(repo, owner, language="English", model="sonnet"):
    """The three scheduled-task prompts, filled in. `lead_deep` always runs on opus."""
    base = {"repo": repo, "owner": owner, "language": language, "model": model}
    lead = dict(base, role_name="the Lead (Technical Lead)", tier_flags="")
    deep = dict(base, model="opus", role_name="Lead Deep, the Opus Technical Lead", tier_flags=" --min-tier opus")
    return {"code": render(template("code-task.md"), base),
            "lead": render(template("lead-task.md"), lead),
            "lead_deep": render(template("lead-task.md"), deep)}


def settings_file(owner, owner_name, language):
    cfg = {"owner": owner, "owner_name": owner_name or owner, "language": language, "base": "main",
           "branch_prefix": "claude/", "owner_associations": ["OWNER"], "improve": True}
    return json.dumps(cfg, indent=2) + "\n"


def planned_files(a):
    """(relative path, text) for every generated file. Strings that reach YAML are written as JSON strings."""
    values = {"repo": json.dumps(a.repo), "stack": json.dumps(a.stack, ensure_ascii=False)}
    plain = {"project": a.project or a.repo.split("/")[1], "owner": a.owner, "stack": a.stack}
    files = [
        (".github/github-loop.json", settings_file(a.owner, a.owner_name, a.language)),
        (".github/ISSUE_TEMPLATE/autopilot.yml", render(template("autopilot-issue-form.yml"), values)),
        ("CLAUDE.md", render(template("project-claude.md"), plain)),
    ]
    if getattr(a, "install_events", False):
        files.append((".github/workflows/loop-fire.yml", template("loop-fire.yml")))
    return files


def write(root, rel, text, force, dry_run):
    path = os.path.join(root, rel)
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as f:
            if f.read() == text:
                return "unchanged"
        if not force:
            return "kept (exists; --force replaces it)"
        status = "replaced"
    else:
        status = "created"
    if not dry_run:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    return status if not dry_run else f"would be {status}"


def install_skill(root, force, dry_run):
    """Copy this skill (SKILL.md, references, scripts; no tests) to <root>/.claude/skills/github-loop/."""
    dest = os.path.join(root, ".claude", "skills", "github-loop")
    if os.path.realpath(dest) == os.path.realpath(SKILL):
        return [{"path": ".claude/skills/github-loop/", "status": "unchanged (this is the installed copy)"}]
    out = []
    for name in package.files():
        with open(os.path.join(SKILL, name), "rb") as f:
            data = f.read()
        target = os.path.join(dest, name)
        rel = os.path.relpath(target, root).replace(os.sep, "/")
        current = None
        if os.path.exists(target):
            with open(target, "rb") as f:
                current = f.read()
        if current == data:
            out.append({"path": rel, "status": "unchanged"})
        elif current is not None and not force:
            out.append({"path": rel, "status": "kept (exists; --force replaces it)"})
        else:
            status = "replaced" if os.path.exists(target) else "created"
            if not dry_run:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "wb") as f:
                    f.write(data)
            out.append({"path": rel, "status": status if not dry_run else f"would be {status}"})
    return out


def create_labels(a):
    proc = subprocess.run([sys.executable, "-B", os.path.join(HERE, "readiness.py"), "--repo", a.repo,
                           "--owner", a.owner, "--create-labels"], capture_output=True, text=True)
    return "ok" if proc.returncode == 0 else f"failed: {(proc.stderr or proc.stdout).strip()[:200]}"


def checkout_dir(given):
    if given:
        return os.path.abspath(given)
    proc = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return proc.stdout.strip() if proc.returncode == 0 else os.getcwd()


def check_args(a):
    if not REPO.match(a.repo):
        return f"--repo must look like owner/repo, not {a.repo!r}"
    if not LOGIN.match(a.owner):
        return f"--owner must be a GitHub login, not {a.owner!r}"
    return None


def parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, help="owner/repo")
    ap.add_argument("--owner", required=True, help="the Product Owner's GitHub login")
    ap.add_argument("--owner-name", default=None, help="how messages name the owner (default: the login)")
    ap.add_argument("--language", default="English", help="language of the agents' messages to the owner")
    ap.add_argument("--model", choices=MODELS, default="sonnet", help="model the two scheduled tasks run on")
    ap.add_argument("--stack", default=DEFAULT_STACK, help="the default of the form's Stack field")
    ap.add_argument("--project", default=None, help="project name for the starter CLAUDE.md (default: the repo name)")
    ap.add_argument("--dir", default=None, help="the checkout to write into (default: the current git checkout)")
    ap.add_argument("--install-skill", action="store_true", help="also copy this skill into the checkout")
    ap.add_argument("--install-events", action="store_true",
                    help="also write the loop-fire workflow that starts Lead and Code on GitHub events")
    ap.add_argument("--create-labels", action="store_true", help="create the loop labels on GitHub")
    ap.add_argument("--prompts", action="store_true", help="include the scheduled-task prompts in the report")
    ap.add_argument("--force", action="store_true", help="replace files that already exist and differ")
    ap.add_argument("--dry-run", action="store_true", help="write nothing and create no labels")
    return ap


def main():
    a = parser().parse_args()
    problem = check_args(a)
    root = checkout_dir(a.dir)
    if not problem and not os.path.isdir(root):
        problem = f"--dir {root} is not a folder"
    if problem:
        json.dump({"ok": False, "problem": problem}, sys.stdout, indent=2)
        print()
        sys.exit(2)
    files = [{"path": rel, "status": write(root, rel, text, a.force, a.dry_run)} for rel, text in planned_files(a)]
    if a.install_skill:
        files += install_skill(root, a.force, a.dry_run)
    report = {"ok": True, "dir": root, "repo": a.repo, "files": files, "next": NEXT_STEPS}
    if a.create_labels:
        report["labels"] = "skipped (dry run)" if a.dry_run else create_labels(a)
    if a.prompts:
        report["prompts"] = prompts(a.repo, a.owner, a.language, a.model)
    json.dump(report, sys.stdout, indent=2, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
