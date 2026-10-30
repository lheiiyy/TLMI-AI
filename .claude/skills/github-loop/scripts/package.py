#!/usr/bin/env python3
"""Build github-loop.zip, the skill as one upload for any account or repository.

    python3 scripts/package.py [--out dist/github-loop.zip]

The zip holds one `github-loop/` folder with SKILL.md, references/ and scripts/. It leaves out
evals/ (tests run from the repo copy), caches and anything that is not part of the skill. Upload
it as a skill in claude.ai, or unzip it into another repository as `.claude/skills/github-loop/`;
the scripts read that repository's owner from `.github/github-loop.json` or from GitHub.
Prints the file list as JSON. Exit 0, or 2 when SKILL.md is missing.
"""
import argparse
import json
import os
import sys
import zipfile

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = ("SKILL.md", "references", "scripts")
SKIP_DIRS = {"__pycache__", "evals", "dist", ".pytest_cache"}
SKIP_EXT = (".pyc", ".pyo", ".zip")


def files(root=SKILL):
    out = []
    for top in KEEP:
        path = os.path.join(root, top)
        if os.path.isfile(path):
            out.append(top)
            continue
        for d, dirs, names in os.walk(path):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            for name in sorted(names):
                if not name.endswith(SKIP_EXT):
                    out.append(os.path.relpath(os.path.join(d, name), root))
    return out


def build(out_path, root=SKILL):
    if not os.path.isfile(os.path.join(root, "SKILL.md")):
        raise FileNotFoundError(f"no SKILL.md in {root}")
    names = files(root)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in names:
            z.write(os.path.join(root, name), os.path.join("github-loop", name))
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="github-loop.zip")
    a = ap.parse_args()
    try:
        names = build(a.out)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": str(e)}, sys.stdout)
        print()
        sys.exit(2)
    json.dump({"ok": True, "zip": os.path.abspath(a.out), "files": names}, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
