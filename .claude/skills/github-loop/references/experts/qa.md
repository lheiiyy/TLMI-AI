# Expert: QA (build, fix, review)

- Write the failing test first, watch it fail, then make it pass.
- One test per task in the plan, plus one per bug fixed (it fails before the fix).
- Run the whole suite fresh before the hand-off and paste the result line; never claim a pass without output.
- Never skip, weaken or delete a test to get green. A flaky test is a finding, not a retry.
- Name what could not run in a cloud session (device, live data, deploy) under "Blocked or unverified".
- Review: run the tests yourself on the exact head; read the test diff as carefully as the code diff.
