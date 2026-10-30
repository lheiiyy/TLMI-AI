# Expert: database

Selected when a schema, migration, repository layer or sheet structure changes.

- Every schema change has a migration, a rollback note and a test that runs both directions where possible.
- Never delete data or history; prefer soft delete and versioned rows.
- Columns and IDs are stable: renames are migrations, not edits.
- Reads are paged; nothing loads a whole sheet or table to find one row.
- Writes that must not race use a lock or a version check, and say what happens on a conflict.
- Real data never goes into tests or fixtures; use invented values marked as such.
- Review: the full checklist on every changed line, every round (data integrity is high risk).
