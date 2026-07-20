# Migrations

`db.Migrate` runs at boot and does two things, both dialect-agnostic:

1. `CREATE TABLE IF NOT EXISTS` for every model — creates tables a database lacks.
2. **Additive column sync** — compares each model against the live table and issues
   `ALTER TABLE … ADD COLUMN` for anything missing.

Step 2 exists because step 1 alone is a trap: `IF NOT EXISTS` silently does nothing
for a table that already exists, so a database created by an older build kept its
old columns and every query naming a newer column failed at runtime
(`no such column: t.recurring_todo_id`). New installs looked fine, which is exactly
why it went unnoticed — only upgrades broke.

Added columns are nullable and without a default, the only form both SQLite and
Postgres accept unconditionally on a populated table. Pre-existing rows therefore
read NULL, which scans to the Go zero value (`starred` → `false`, pointers → `nil`).

## Limits

This handles *added* columns only. It does not handle renames, drops, type changes,
or backfills. Any of those needs a real versioned migration — which is when this
directory gains bun `migrate` files and `db.Migrate` starts applying them in order.
