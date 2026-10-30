# Expert: deployment

Selected when workflows, deploy scripts, hosting or release settings change, or the request mentions a release.

- The plan's release policy decides: `no deploy`, `staging automatic`, or production only after the owner's `CONTINUE: release`.
- Deploy only through the authorized workflow; never with personal credentials, and never commit them.
- A deploy is not done until it is verified separately (URL, health or smoke check) and the evidence is in the summary.
- Apps Script deploys stay manual (no clasp in cloud runs): report them as a step for the owner.
- A change under `.github/` is high risk: the owner merges it, and pushing workflow files may be refused (then the owner uploads it).
- Every release has a way back (previous version, revert PR) written in the PR body.
