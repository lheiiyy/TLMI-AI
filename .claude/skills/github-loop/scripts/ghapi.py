#!/usr/bin/env python3
"""Shared GitHub REST helper for the loop scripts: one place for retries, paging and call counting.

    from ghapi import ApiError, get_json, get_all, call

- call(args, retry=True): runs `gh api <args>`. A rate limit (429) or a server error (500-504) is
  retried up to 3 times with a growing pause. Writes that are not safe to repeat (posting a
  comment, the merge itself) pass retry=False, so a failure never sends them twice.
- get_json(path): one GET, parsed.
- get_all(path): every page of a list (per_page=100), up to 10 pages. A longer list raises
  ApiError instead of deciding from part of it.
- A missing `gh` raises ApiError, so a broken session is reported as a failure, never as an idle queue.
- CALLS counts the calls of this process (the metrics read it).

Set GITHUB_LOOP_RETRY_SLEEP=0 to retry without pausing (tests).
"""
import json
import os
import re
import subprocess
import time

MAX_PAGES = 10
PER_PAGE = 100
TRIES = 3
RETRYABLE = re.compile(r"HTTP (429|50[0-4])|rate limit|timed out|timeout|connection reset", re.I)
CALLS = []


class ApiError(Exception):
    pass


def _pause(attempt):
    base = float(os.environ.get("GITHUB_LOOP_RETRY_SLEEP", "2"))
    time.sleep(base * (2 ** attempt))


def call(args, retry=True):
    """Run `gh api ARGS` and return stdout. Raises ApiError on failure."""
    last = ""
    for attempt in range(TRIES if retry else 1):
        CALLS.append(" ".join(args))
        try:
            proc = subprocess.run(["gh", "api"] + list(args), capture_output=True, text=True)
        except FileNotFoundError:
            raise ApiError("the GitHub CLI (gh) is not installed or not on PATH")
        if proc.returncode == 0:
            return proc.stdout
        last = (proc.stderr or proc.stdout).strip()
        if not (retry and RETRYABLE.search(last)) or attempt == TRIES - 1:
            break
        _pause(attempt)
    raise ApiError(f"gh api {' '.join(args)} failed: {last[:300]}")


def parse(text, path):
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ApiError(f"gh api {path} returned non-JSON: {e}")


def get_json(path):
    return parse(call([path]), path)


def with_page(path, page):
    base, _, query = path.partition("?")
    params = [p for p in query.split("&") if p and not p.startswith(("per_page=", "page="))]
    return base + "?" + "&".join(params + [f"per_page={PER_PAGE}", f"page={page}"])


def get_all(path, key=None):
    """Every item of a REST list, oldest first as GitHub returns them. `key` names the list inside an
    object reply (for example "check_runs")."""
    items = []
    for page in range(1, MAX_PAGES + 1):
        data = get_json(with_page(path, page))
        batch = data.get(key, []) if key else data
        if not isinstance(batch, list):
            raise ApiError(f"gh api {path} did not return a list")
        items += batch
        if len(batch) < PER_PAGE:
            return items
    raise ApiError(f"{path} has more than {MAX_PAGES * PER_PAGE} items; refusing to decide from part of the list")


def from_fixture(fixtures, name, default=None):
    """Read a fixture file. A missing file returns `default`, or raises when default is None."""
    full = os.path.join(fixtures, name)
    if not os.path.exists(full):
        if default is not None:
            return default
        raise ApiError(f"missing fixture {name}")
    with open(full, encoding="utf-8") as f:
        return json.load(f)
