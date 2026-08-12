package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Drops the notes column from actions and from recurrence patterns.
//
// Neither was ever reachable from the interface: an action's notes could only
// be set through the API, and a pattern's existed solely to be copied onto the
// actions it spawned. Project notes are a separate feature and are untouched.
//
// This destroys whatever those columns held. There is no down migration that
// could bring the text back, so the reverse only restores the shape.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			for _, table := range []string{"todos", "recurring_todos"} {
				cols, err := existingColumns(ctx, db, table)
				if err != nil {
					return err
				}
				if !cols["notes"] {
					continue
				}
				if _, err := db.ExecContext(ctx, "ALTER TABLE "+table+" DROP COLUMN notes"); err != nil {
					return fmt.Errorf("drop %s.notes: %w", table, err)
				}
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			// The column comes back empty: the text it held is gone.
			for _, table := range []string{"todos", "recurring_todos"} {
				if _, err := db.ExecContext(ctx,
					"ALTER TABLE "+table+" ADD COLUMN notes VARCHAR NOT NULL DEFAULT ''",
				); err != nil {
					return fmt.Errorf("restore %s.notes: %w", table, err)
				}
			}
			return nil
		},
	)
}
