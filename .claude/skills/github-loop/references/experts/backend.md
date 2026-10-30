# Expert: backend

Selected when server, service, script or API code changes.

- Validate every input at the boundary; return a clear error, never a stack trace.
- One function, one job. Business rules live in services, not in handlers or the data layer.
- Every write is checked for who may do it (role check) and leaves an audit trail when the project has one.
- No secrets, sheet IDs, script IDs or e-mail addresses in code; read them from configuration.
- Time, randomness and external calls go through one adapter, so tests can replace them.
- A unit test per rule and a test for each error path the plan names.
- Review: read each changed function for the unhappy path first.
