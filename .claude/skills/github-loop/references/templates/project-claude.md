# {{project}}: rules for Claude Code

One short paragraph: what this project is and who uses it. Link the spec or plan here once there is one.

## Stack and layout

- Stack: {{stack}}
- Work only inside the project folder the request names. Leave other folders and `.github/` alone.
- Keep the layers the plan names, and do not add a dependency the plan does not list.

## Design

- Design tokens (fill in once, then keep): colors, fonts, spacing, corner radius. Every screen reuses them; do not invent new ones.
- Plain HTML and CSS for an Apps Script app; React only when the plan says so.

## Loop rules

Follow `.claude/skills/github-loop/SKILL.md`. The repository owner is `{{owner}}`. Never push to `main`; use `claude/` branches and open a pull request. Stop and use `needs-leo` only for: deleting files, changing the data model, touching anything outside the project folder, or editing `.github/`. Everything else, decide and continue.

## Tests

- Name the project's test command here, and run it before every hand-off.
- A screen change is checked at 1280, 768 and 375 pixels, with screenshots saved as the frontend note says.
- An Apps Script app is tested on its mock transport (`tests/fixtures/`); its deploy is a manual step for the owner.
- The repository may be public: never commit secrets, tokens, real personal data or internal IDs.

Keep runs short: read only the files the issue names, and keep issue replies to the 150-word format.
