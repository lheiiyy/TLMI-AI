# Expert: Apps Script and Sheets

Selected for `.gs` files, `appsscript.json`, or a request about Apps Script or Google Sheets.

- Four layers: UI, then an `api.js` client, then services, then the repository. Only the repository touches `SpreadsheetApp`; business rules live in services.
- `api.js` has a transport setting (`mock`, `appsscript`, later `rest`). The mock reads `tests/fixtures/`, so the app and its Playwright tests run on localhost with no Google sign-in.
- Cloud runs have no live Sheets and no clasp. Test on the mock transport and name that gap under "Blocked or unverified".
- Data tabs: one table per tab, snake_case headers, an `id` column with a prefixed ID, links by ID and never by name, one value per cell, no formulas, merged cells or colours.
- Every write takes a `LockService` lock and one batch write. Reads are paged and lookups are cached.
- The server checks the caller's role on every call; a hidden button is not security.
- Secrets, sheet IDs and script IDs live in Script Properties, never in code or fixtures. Fixtures hold invented rows.
- The deploy stays manual. The summary's `Deployed:` line says "manual" and lists the owner's steps: a dated backup of the data sheet, the code push, a new deployment version, one smoke test with dummy data (the owner signs in), and the way back (the previous version).
