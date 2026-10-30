# Expert: frontend

Selected when screens, styles or client code change.

- It must work on desktop, tablet and phone: check 1280, 768 and 375 px (Playwright is preinstalled in scheduled runs).
- Every input has a label, every action a visible result, every error a message the user can act on.
- No console errors and no failed requests on the changed screens.
- The UI calls only the service or API layer, never the data store.
- Loading, empty and error states exist for every list and form.
- Touch targets are large enough to tap (about 44 px); nothing important needs hover.

Design, for a screen with no approved design:
- Use the project's design tokens (colors, fonts, spacing) from its `CLAUDE.md` or `docs/design.md`. If there are none, write a short set in the plan first and reuse it, so every screen matches.
- Choose one clear direction and keep it: two fonts at most, a type scale, one accent color, text contrast of 4.5:1 or better. No stock-template look.
- Plain HTML and CSS for Apps Script; React only when the plan says so.

Proof:
- For each changed screen, save a PNG at 1280, 768 and 375 px as `docs/screens/<slug>/<screen>-<width>.png` inside the project folder. Use the same names every round so they are replaced, not piled up. List that folder under `Files in scope:`.
- Review: open the screenshots and cite one per screen in the verdict. Code alone is not enough.
