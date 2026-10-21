# Setup guide

What the owner does once to run TLMI-AI on the DEV and TEST Apps Script projects. LIVE is not part of Phase 1: it is deployed by hand by the owner, after a dated copy of the LIVE sheet.

No sheet ID, script ID, password, token or e-mail address is written in this file or in the repository. Wherever a value is needed, it goes into a Script Property or into a file that git ignores.

## What you need

- Node 22 and git on your computer, and this repository cloned.
- The Google account that owns the scripts and the sheets (TDMS decision D069).
- The spreadsheets in the Drive folder "TLMI-AI": the empty database sheets for DEV and TEST, the copy of the legacy sheet with its `SEED_OFFICERS` tab, and the review sheet.

## 1. Tools

1. Turn on the Apps Script API for your account: open the Apps Script settings page (script.google.com, Settings) and switch "Google Apps Script API" on.
2. Install clasp once: `npm install -g @google/clasp`.
3. Log in once: `clasp login`. This writes a login file on your computer. It is ignored by git. Never copy it into the repository.
4. In the repository folder run `npm ci`.

## 2. One script project for DEV and one for TEST

1. In the Drive folder, create a standalone Apps Script project named `TLMI DEV` and another named `TLMI TEST`.
2. For each project, open Project settings and copy the Script ID.
3. In the repository folder create two files. Git ignores them. Each holds only the Script ID:
   - `.clasp.dev.json` with `{ "scriptId": "<the DEV script ID>" }`
   - `.clasp.test.json` with `{ "scriptId": "<the TEST script ID>" }`

## 3. Script Properties (by name)

In each project open Project settings, then Script Properties, and add these. Use the DEV database sheet for DEV and the TEST database sheet for TEST. The IDs are the long part of each sheet's address.

| Property | Value |
| --- | --- |
| `ENV` | `DEV` or `TEST` |
| `TLMI_DB_ID` | ID of that environment's `TLMI_DB` sheet |
| `LEGACY_COPY_ID` | ID of the dated copy of the legacy sheet (never the original) |
| `REVIEW_SHEET_ID` | ID of the review sheet |

Add these only when you run the function that reads them. Each one is temporary and is removed by the function:

| Property | Used by | Value |
| --- | --- | --- |
| `FIRST_ADMIN_NAME` | `initFirstAdmin` (empty database) | your own name, typed exactly as it is written in the `SEED_OFFICERS` tab, so that the seed skips you as `EXISTS` and does not make a second user |
| `FIRST_ADMIN_EMPLOYEE_NO` | `initFirstAdmin` | your HR employee number, digits only; it is your sign-in ID |
| `FIRST_ADMIN_PASSWORD` | `initFirstAdmin` | a temporary password: at least 8 characters, with a letter and a digit. You must change it at your first sign-in |
| `ADMIN_EMPLOYEE_NO` | `initAdminPassword` (database that already has its Admin) | the HR employee number of the Admin, digits only |
| `ADMIN_TEMP_PASSWORD` | `initAdminPassword` | a temporary password, same rule |

`PEPPER` and `SESSION_EPOCH:<user id>` are written by the code. Do not type them. The Admin PIN properties of Phase 1 (`ADMIN_PIN_HASH`, `ADMIN_PIN_SALT`, `ADMIN_PIN_FAILS`, `ADMIN_PIN_NEW`) are removed by `initFirstAdmin` and `initAdminPassword`; the PIN no longer exists.

**A database made with the Phase 1 code.** `setup` never changes a tab that exists. The `users` tab of a Phase 1 database lacks four columns that password sign-in needs. Before the first deploy of part 2A, insert four columns in the `users` tab between `salt` and `created_at`, with these header names exactly: `must_change_password`, `failed_attempts`, `cooldown_until`, `last_login_at`. A database made after part 2A has them already.

## 4. First push

1. Commit everything (the deploy command refuses a dirty tree).
2. `npm run deploy:dev`. For TEST: `npm run deploy:test`. The command runs the unit tests, builds `dist/` and runs `clasp push` from `dist/`. It refuses `live`.

## 5. Setup functions, in the Apps Script editor

Run them in this order, from the editor's Run menu. Each one logs names only, never a value. Open the execution log to read the result. They refuse to run unless you run them yourself from the editor (limit L-3 in [docs/DECISIONS.md](DECISIONS.md)); if one says it can only be run in the script editor, you are not running it from the editor.

1. `setup`: creates the missing tabs in `TLMI_DB`. Safe to run again.
2. `initSecrets`: makes the password pepper.
3. `measureHash`: logs how long one hash takes at 1,000 and at 10,000 iterations. Decide the iteration count:
   - If 10,000 iterations take 2 seconds or less, keep `Hasher.DEFAULT_ITERATIONS = 10000` in `src/server/Platform.gs`.
   - Otherwise use the largest count that takes 2 seconds or less, never below 1,000. Change the constant, commit, push again, and run `measureHash` again.
   - If even 1,000 takes more than 2 seconds, stop and report `BLOCKED — REASON — DECISION REQUIRED`.
   - Record the result here when it is done: iteration count ____, timing on TEST ____ ms, date ____.
4. `initFirstAdmin`: for an **empty database**. It reads `FIRST_ADMIN_NAME`, `FIRST_ADMIN_EMPLOYEE_NO` and `FIRST_ADMIN_PASSWORD`, makes the first Admin (who must change the password at the first sign-in) and removes the three properties. It refuses when an active Admin already exists, when any user (active or not) already has that name or that number, and when the password does not follow the rule; then nothing is changed and the properties stay so that you can correct them. This is what lets someone sign in and run the seed.
5. `initAdminPassword`: for a database that **already has its Admin** (made by Phase 1), and the way back for an Admin who is locked out or has forgotten the password. It reads `ADMIN_EMPLOYEE_NO` and `ADMIN_TEMP_PASSWORD`. It picks the active Admin who has that number; or, when no user has the number and exactly one active Admin exists, that Admin (the number is set on it). It refuses when the number belongs to a user who is not an active Admin, or when the number is free and there is not exactly one active Admin. It sets the temporary password (the Admin must change it), clears the pause, ends the Admin's sessions, and removes both properties.
6. `checkConfig`: lists any Script Property that is still missing, by name.

## 6. Deploy the web app

1. In the editor choose Deploy, then New deployment, type Web app.
2. Execute as: **Me**. Users never receive edit access to `TLMI_DB`.
3. Who has access: **Only myself** is the default and the safest. Phase 1 holds no Team Leader data, so on TEST you may change it to a wider setting when you share the link with named officers (spec section 6.1, "known limit": anyone who has the link can see the officers' display names and can sign in as a non-Admin role). Do not widen it on LIVE, and do not share the link with anyone who is not a named officer.
4. Open the web app URL.
5. After every `npm run deploy:test`, check "Who has access" when you create a new version of the TEST deployment. The push writes the manifest back with `Only myself`, so a widened setting is reset. It fails closed, so it is not a risk, only a surprise for the officers.

## 7. Seed and import review (in the app)

1. Sign in as Admin: your employee ID and the temporary password, then choose your own password. Code and the reviewer never type or store a password; you sign in yourself.
2. Seed screen: choose Check the seed, read the counts and the lists of skipped and rejected rows, then Run the seed. It can be run again; it skips what exists.
3. Check the master lists against the `SETTINGS` and `SEED_OFFICERS` tabs of the legacy copy (gate G1, item 2). Give each officer the role they hold: seeded officers start as Training Officer; Admin sets Supervisor, Manager and Senior Training Manager on the Users screen.
3a. A seeded officer has no password and cannot sign in yet. On the Users screen, Admin gives each officer an HR employee number (Edit) and then Reset password. The screen shows a temporary password once, in a box with a Copy button: **hand it to the officer in person**, never by message. The officer signs in with the employee number and the temporary password and chooses their own password at once. If an officer forgets the password, or is paused after too many wrong tries, Admin uses Reset password or Clear pause.
4. Import review screen: choose Run the import review. It writes six tabs to the review sheet and changes no Team Leader data.

### Note for officers who work in the review sheet

- The review sheet holds staff names. Share it only with named officers. Never copy it into the repository.
- An officer may edit only these columns: `decision`, `corrected_value`, `decided_by`, `decided_on` and `needs_review`.
- `needs_review` is set to `TRUE` when the source value of a decided row changed, and to `SOURCE_CHANGED` when the source row is gone. The officer re-checks the row and then clears the cell.
- A row confirmed with `decision` = `confirm` becomes an alias on the next run only if its `corrected_value` (or its single candidate) is an active store, station or officer of the master lists. Otherwise the row says `CONFIRM_NEEDS_VALUE` or `ALIAS_TARGET_UNKNOWN`.
- A re-run keeps every decision. Admin tells the officers before a re-run, and nobody edits the review sheet while it runs: an edit made during the few seconds of a run may be overwritten.

## 8. Smoke test on TEST

One smoke test on the deployed TEST app, with dummy data only, signed in by you: sign in, open the master lists, change nothing real. The browser tests (`npm run e2e`) cover the rest on localhost with fake data.

## Rolling back

Every deploy is a commit. To go back, check out the earlier commit and run the deploy command again. Before any risky change on LIVE, the owner makes a dated copy of the LIVE sheet.
