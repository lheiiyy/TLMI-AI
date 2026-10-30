#!/usr/bin/env python3
"""Check that this copy of the skill is complete, before any run relies on it.

    python3 scripts/selfcheck.py [--dir <skill folder>]

Reads SKILL.md and the notes in references/ and checks that every script (`scripts/x.py`), every
reference file (`references/x.md`, `.json` or `.yml`) and every `loop_gh.py` command they name exists
in this copy. A copy saved from SKILL.md alone, or one that mixes an old scripts/ folder with a new
SKILL.md, fails here instead of in the middle of a run.

Static by design: it reads files and never imports or runs the other scripts.

Prints a JSON report: ok, missing (what is named but absent), problems and the next step.
Exit 0 complete, 1 incomplete, 2 not a skill folder.
"""
import argparse
import ast
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
SCRIPT_RX = re.compile(r"scripts/([a-z_]+\.py)")
REF_RX = re.compile(r"references/([A-Za-z0-9_./-]+\.(?:md|json|yml))")
CMD_RX = re.compile(r"loop_gh\.py ([a-z][a-z-]+)")
NEXT = ("This copy is out of date. Reinstall the skill from the repository's copy: build the zip with "
        "scripts/package.py and upload it, or clone the repository and use its copy (references/setup.md, step 1).")


def doc_files(skill):
    """SKILL.md and every top-level note in references/, the files the docs-consistency test reads."""
    names = ["SKILL.md"]
    refs = os.path.join(skill, "references")
    if os.path.isdir(refs):
        names += [os.path.join("references", n) for n in sorted(os.listdir(refs)) if n.endswith(".md")]
    return names


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def commands_of(path):
    """The keys of the COMMANDS table in loop_gh.py, read without running it; None when it cannot be read."""
    try:
        tree = ast.parse(read(path))
    except (OSError, SyntaxError, UnicodeDecodeError):
        return None
    for node in ast.walk(tree):
        if (isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict)
                and any(isinstance(t, ast.Name) and t.id == "COMMANDS" for t in node.targets)):
            return {k.value for k in node.value.keys if isinstance(k, ast.Constant)}
    return None


def check(skill):
    named_scripts, named_refs, named_cmds = set(), set(), set()
    for name in doc_files(skill):
        text = read(os.path.join(skill, name))
        named_scripts |= set(SCRIPT_RX.findall(text))
        named_refs |= set(REF_RX.findall(text))
        named_cmds |= set(CMD_RX.findall(text))

    missing = [f"scripts/{s}" for s in sorted(named_scripts) if not os.path.isfile(os.path.join(skill, "scripts", s))]
    missing += [f"references/{r}" for r in sorted(named_refs) if not os.path.isfile(os.path.join(skill, "references", r))]
    problems = []
    loop_gh = os.path.join(skill, "scripts", "loop_gh.py")
    if os.path.isfile(loop_gh):
        known = commands_of(loop_gh)
        if known is None:
            problems.append("scripts/loop_gh.py has no COMMANDS table: it is an older version")
        else:
            missing += [f"loop_gh.py {c}" for c in sorted(named_cmds - known)]
    ok = not missing and not problems
    report = {"ok": ok, "skill": skill, "missing": missing, "problems": problems,
              "checked": {"scripts": len(named_scripts), "references": len(named_refs), "commands": len(named_cmds)}}
    if not ok:
        report["next"] = NEXT
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=SKILL, help="the skill folder to check (default: this one)")
    a = ap.parse_args()
    skill = os.path.abspath(a.dir)
    if not os.path.isfile(os.path.join(skill, "SKILL.md")):
        json.dump({"ok": False, "problem": f"{skill} has no SKILL.md, so it is not a skill folder"}, sys.stdout, indent=2)
        print()
        sys.exit(2)
    report = check(skill)
    json.dump(report, sys.stdout, indent=2)
    print()
    sys.exit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
