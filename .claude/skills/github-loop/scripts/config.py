#!/usr/bin/env python3
"""Per-repository settings, so the skill works for any owner, repository and language.

Read from --config, else the GITHUB_LOOP_CONFIG environment variable, else
`.github/github-loop.json` at the top of the git checkout the command runs in. The file and
every key in it are optional. Example:

    {
      "owner": "lheiiyy",
      "owner_name": "Leo",
      "language": "Taglish",
      "base": "main",
      "branch_prefix": "claude/",
      "owner_associations": ["OWNER"],
      "improve": true
    }

owner               the Product Owner's GitHub login. Without it, the repo's owner is used when
                    the repo belongs to a user; an organization repo must set it.
owner_name          how relayed approvals and messages name the owner (default: the login).
language            language of the agents' final messages to the owner (default: English).
base                the branch the loop merges into (default: main).
branch_prefix       the only PR branches the merge gate accepts (default: claude/).
owner_associations  author_association values that count as the owner. Keep ["OWNER"] for a
                    personal repo; an organization repo adds "MEMBER" (the login must still match).
improve             false switches off improve.py proposals.
"""
import json
import os
import subprocess

from ghapi import ApiError, from_fixture, get_json

DEFAULTS = {"owner": None, "owner_name": None, "language": "English", "base": "main", "branch_prefix": "claude/",
            "owner_associations": ["OWNER"], "improve": True}
FILE = os.path.join(".github", "github-loop.json")


def default_path():
    try:
        proc = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    except FileNotFoundError:
        return None
    return os.path.join(proc.stdout.strip(), FILE) if proc.returncode == 0 else None


def load(path=None):
    """Settings merged over DEFAULTS. A file that exists but is not valid JSON raises ValueError."""
    path = path or os.environ.get("GITHUB_LOOP_CONFIG") or default_path()
    cfg = dict(DEFAULTS)
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError(f"{path} must hold a JSON object")
        unknown = set(data) - set(DEFAULTS)
        if unknown:
            raise ValueError(f"{path} has unknown keys: {', '.join(sorted(unknown))}")
        cfg.update({k: v for k, v in data.items() if v is not None})
    return cfg


def resolve_owner(repo, given=None, cfg=None, fixtures=None):
    """The owner's login: --owner, else the config, else the user who owns the repo."""
    if given:
        return given
    if (cfg or {}).get("owner"):
        return cfg["owner"]
    info = from_fixture(fixtures, "repo.json") if fixtures else get_json(f"repos/{repo}")
    owner = info.get("owner") or {}
    if owner.get("login") and owner.get("type", "User") == "User":
        return owner["login"]
    raise ApiError(f"{repo} belongs to an organization: pass --owner or set \"owner\" in {FILE}")


def owner_name(cfg, owner):
    return (cfg or {}).get("owner_name") or owner
