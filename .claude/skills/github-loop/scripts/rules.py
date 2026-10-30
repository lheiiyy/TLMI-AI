#!/usr/bin/env python3
"""Shared risk rules: which files and goals count as sensitive.

pick_model.py (model tier), route.py (experts and gates) and `loop_gh.py merge` (who merges) all
read these rules, so they never disagree.

High risk (the owner's list): authentication and permissions, secrets and credentials, sensitive
data, database schema and migrations, payments, production config and deploys, `.github/`
(workflows), Apps Script deploy files, and the loop's own skill folder (its scripts, SKILL.md and
setup are the loop's safety controls). Sensitive data and destructive operations cannot be seen in
a file name, so the plan's `Risk:` line covers them; it can raise the tier, never lower it.
"""
import fnmatch
import re

DOCS = re.compile(r"\.(md|txt|rst)$", re.I)
RISK_PATH = re.compile(
    r"(auth(?!or)|permission|(^|[^a-z])roles?([^a-z]|$)|(^|[^a-z])acl([^a-z]|$)|secret|token|credential|passw|"
    r"(^|[^a-z])pin([^a-z]|$)|schema|migration|\.sql$|payment|billing|payroll|security|^\.github/|"
    r"(^|/)appsscript\.json$|\.clasp|deploy|(^|/)\.env)", re.I)
SKILL_PATH = re.compile(r"(^|/)\.claude/skills/")
RISK_TEXT = re.compile(
    r"(authenticat|authoriz|permission|access control|role-based|data integrity|schema|migration|payment|"
    r"billing|payroll|credential|destructive|delete (all|data))", re.I)
ARCHITECTURE = re.compile(
    r"(new system|new project|from scratch|architecture|rewrite|redesign|rebuild|platform|re-platform)", re.I)
RISK_LINE = re.compile(r"(?im)^[ \t>*-]*risk[ \t]*:[ \t]*\**[ \t]*(low|normal|high)\b")
# Bold markers are allowed around the label ("**Files in scope:**"), never eaten from the patterns themselves.
SCOPE_LINE = re.compile(r"(?im)^[ \t>*-]*(?:\*\*)?files in scope(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.*)$")
TOO_BROAD = {"*", "**", "/", ".", "./", "**/*", "*/**"}
TIERS = ("low", "normal", "high")


def norm(paths):
    return [re.sub(r"^\./", "", p.replace("\\", "/")) for p in paths if p]


def is_docs_only(paths):
    paths = norm(paths)
    return bool(paths) and all(DOCS.search(p) and not p.startswith(".github/") for p in paths)


def sensitive_paths(paths):
    """Files that make a change sensitive. Documentation alone is not, except under .github/ or the skill."""
    paths = norm(paths)
    skill = [p for p in paths if SKILL_PATH.search(p)]
    if is_docs_only(paths):
        return skill
    return skill + [p for p in paths if RISK_PATH.search(p) and p not in skill]


def declared_risk(text):
    """The tier a plan or plan reply declares on a `Risk: low|normal|high` line, or None."""
    m = RISK_LINE.search(text or "")
    return m.group(1).lower() if m else None


def risk_tier(paths=(), declared=None):
    """(tier, reasons). 'high' when a sensitive file or the skill changes, or the plan declares high;
    'low' for documentation only; otherwise 'normal'. A declared tier only ever raises the result."""
    paths = norm(paths)
    hits = sensitive_paths(paths)
    tier, reasons = ("low", ["documentation only"]) if is_docs_only(paths) else ("normal", ["ordinary change"])
    if hits:
        tier, reasons = "high", ["sensitive files: " + ", ".join(hits[:5]) + (" ..." if len(hits) > 5 else "")]
    if declared in TIERS and TIERS.index(declared) > TIERS.index(tier):
        tier, reasons = declared, reasons + [f"the plan declares Risk: {declared}"]
    return tier, reasons


def declared_scope(text):
    """The patterns on a `Files in scope: a/, b/**, docs/plan-x.md` line, or None when there is no such line.
    Patterns are separated by commas or spaces; backticks are ignored."""
    m = SCOPE_LINE.search(text or "")
    if not m:
        return None
    return [p for p in re.split(r"[,\s]+", m.group(1).replace("`", "")) if p]


def scope_problems(patterns):
    """Why a declared scope cannot be used: missing, empty, or so broad that it checks nothing."""
    if patterns is None:
        return ["declare the files the plan may change on one line: `Files in scope: <folder/>, <file>, ...`"]
    if not patterns:
        return ["`Files in scope:` lists no files or folders"]
    broad = [p for p in patterns if p in TOO_BROAD]
    if broad:
        return [f"`Files in scope:` must name real folders or files, not {', '.join(broad)}"]
    return []


def in_scope(path, patterns):
    """`dir/` and `dir/**` cover everything under dir; `*`, `?` and `[...]` are globs; anything else is one file."""
    path = norm([path])[0]
    for raw in patterns:
        p = norm([raw])[0]
        if p.endswith("/**"):
            p = p[:-2]
        if p.endswith("/"):
            if path.startswith(p):
                return True
        elif any(ch in p for ch in "*?["):
            if fnmatch.fnmatchcase(path, p):
                return True
        elif path == p:
            return True
    return False


def outside_scope(paths, patterns):
    return [p for p in norm(paths) if not in_scope(p, patterns)]
