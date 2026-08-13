package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// Adds tags to recurrence patterns.
//
// A second link table rather than a nullable todo_id on taggings: that column
// is NOT NULL and every query over it assumes a todo is on the other end, so
// widening it would mean revisiting all of them to gain nothing but one fewer
// table. The cost is a near-identical pair of repo methods, which is the
// cheaper half of the trade and stays contained in one file.
//
// Nothing is backfilled: patterns had no tags to carry over. New rows appear
// only when somebody tags a pattern.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			if _, err := db.NewCreateTable().
				Model((*domain.RecurringTagging)(nil)).IfNotExists().Exec(ctx); err != nil {
				return fmt.Errorf("create recurring_taggings: %w", err)
			}
			// Every read is "the tags of these patterns", so that is the index.
			if _, err := db.NewCreateIndex().
				Model((*domain.RecurringTagging)(nil)).
				Index("idx_recurring_taggings_user_pattern").
				Column("user_id", "recurring_todo_id").
				IfNotExists().Exec(ctx); err != nil {
				return fmt.Errorf("index recurring_taggings: %w", err)
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			_, err := db.NewDropTable().
				Model((*domain.RecurringTagging)(nil)).IfExists().Exec(ctx)
			return err
		},
	)
}
