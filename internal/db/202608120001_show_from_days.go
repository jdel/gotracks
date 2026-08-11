package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// Adds the show-from-days preference, and settles auto_delete_attachments.
//
// show_from_days is created NOT NULL DEFAULT 0, which backfills every existing
// user in the same statement — 0 means "show the action on its due date", the
// behaviour a user gets by doing nothing.
//
// auto_delete_attachments predates this and was added nullable, so the domain
// field had to be a *bool whose nil meant off. The NULLs are filled in here so
// it can be a plain bool like every other preference. The column keeps its
// nullable definition: SQLite cannot add NOT NULL to an existing column without
// rebuilding the table, and with nothing able to write NULL any more the
// constraint would only be decoration.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			cols, err := existingColumns(ctx, db, "preferences")
			if err != nil {
				return err
			}
			if !cols["show_from_days"] {
				if _, err := db.ExecContext(ctx,
					"ALTER TABLE preferences ADD COLUMN show_from_days INTEGER NOT NULL DEFAULT 0",
				); err != nil {
					return fmt.Errorf("add show_from_days: %w", err)
				}
			}
			if cols["auto_delete_attachments"] {
				if _, err := db.ExecContext(ctx,
					"UPDATE preferences SET auto_delete_attachments = FALSE WHERE auto_delete_attachments IS NULL",
				); err != nil {
					return fmt.Errorf("backfill auto_delete_attachments: %w", err)
				}
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			// Only the added column comes back out; the backfilled values stay,
			// since NULL carried no meaning the old code could not read as off.
			_, err := db.NewDropColumn().
				Model((*domain.Preference)(nil)).Column("show_from_days").Exec(ctx)
			return err
		},
	)
}
