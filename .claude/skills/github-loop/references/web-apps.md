# Web apps with the loop

Read this when the request is a web app, an internal tool or a portal. It shows how the loop, the planning skill and the design skill fit together, and what stays with the owner.

## The path

1. **Plan in chat (Lead).** For a new project, use web-app-project-planning: its Docs plan is the management document. The loop's repo plan (`references/lead.md`) is shorter and carries three extra lines. Do not ask for a second approval: `APPROVED` on the loop's plan is the build approval.
2. **File one slice.** One issue is one slice: 6 tasks or fewer that work on their own. Build the core data first, then the module people use most. The plan names the project's status document (for example `specs/plan.md`), and the Lead proposes the next slice from it. The owner files each slice with the issue form; agents never add `to-code`.
3. **The loop builds it:** plan, `APPROVED`, build, review, merge. A deploy happens only as the plan's release policy says.
4. **The owner does what the loop cannot:** Apps Script deploys, the Merge tap on high-risk work, and enabling hosting.

## What runs where

| Skill | In a chat | In a scheduled run |
|---|---|---|
| web-app-project-planning | Used by the Lead for a new project | Not loaded; the plan sections in `references/lead.md` stand in |
| superpowers (TDD, debugging, review) | Available | Not loaded; `references/experts/qa.md` and the review checklist stand in |
| frontend-design | Available | Not loaded; `references/experts/frontend.md` carries the short version |

Never claim a skill was used unless it was loaded.

## Make the plan loop-ready

- The planning doc's sections map onto the loop's five (business plan, architecture, task breakdown, test plan, merge plan). Add the lines `Risk:`, `CI required:` and `Files in scope:`; the merge gate reads them.
- State the front end: plain HTML for Apps Script, React for a full-stack build.
- Test plan: unit tests on the service layer with a fake repository; Playwright on localhost at 1280, 768 and 375 px against the mock transport; one "Blocked or unverified" line for what cloud runs cannot do (live Sheets, a deploy, a real device).
- Write `CI required: yes` once the project has a tests workflow (`references/setup.md`, step 7).
- `Files in scope:` includes the screenshots folder (`references/experts/frontend.md`) and the status document.

## Project layout and rules

- Folders: `app/`, `tests/unit/`, `tests/e2e/`, `tests/fixtures/`, `docs/`, `specs/`.
- The project's `CLAUDE.md` holds the stack, the test command and the design tokens. `scripts/init_repo.py` writes a starter.
- Fixtures hold invented rows. The repository may be public, so keep real staff or store data in a private repository and never commit IDs, tokens or e-mail addresses.

## Apps Script

- Cloud runs have no clasp and no live Sheets, so "done" means merged and tested on the mock transport. The summary lists the manual deploy steps from `references/experts/appsscript.md`.
- To test on a tablet, the owner opens the test deployment in Chrome and tries the main flow with dummy data.
