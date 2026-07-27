package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Drops the pending_enrollments.bootstrap column. First-admin selection is now
// simply "the first account to activate", decided by a user count inside the
// activation transaction, so the per-token flag and its guard are gone.
//
// Guarded on the column's presence: a database created after the model changed
// never had it, so this is a no-op there.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			cols, err := existingColumns(ctx, db, "pending_enrollments")
			if err != nil {
				return err
			}
			if !cols["bootstrap"] {
				return nil
			}
			if _, err := db.ExecContext(ctx, "ALTER TABLE pending_enrollments DROP COLUMN bootstrap"); err != nil {
				return fmt.Errorf("drop pending_enrollments.bootstrap: %w", err)
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			cols, err := existingColumns(ctx, db, "pending_enrollments")
			if err != nil {
				return err
			}
			if cols["bootstrap"] {
				return nil
			}
			if _, err := db.ExecContext(ctx,
				"ALTER TABLE pending_enrollments ADD COLUMN bootstrap BOOLEAN NOT NULL DEFAULT FALSE"); err != nil {
				return fmt.Errorf("re-add pending_enrollments.bootstrap: %w", err)
			}
			return nil
		},
	)
}
