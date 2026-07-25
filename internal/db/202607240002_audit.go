package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// Adds the append-only audit log.
//
// Indexed on the columns the admin screen filters by. The table is never
// pruned, so the indexes are what keep it usable as it grows.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			if _, err := db.NewCreateTable().
				Model((*domain.AuditEvent)(nil)).IfNotExists().Exec(ctx); err != nil {
				return fmt.Errorf("create audit events: %w", err)
			}
			for name, column := range map[string]string{
				"audit_events_occurred_idx": "occurred_at",
				"audit_events_actor_idx":    "actor_id",
				"audit_events_action_idx":   "action",
			} {
				if _, err := db.NewCreateIndex().
					Model((*domain.AuditEvent)(nil)).
					Index(name).Column(column).IfNotExists().Exec(ctx); err != nil {
					return fmt.Errorf("index audit events: %w", err)
				}
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			_, err := db.NewDropTable().
				Model((*domain.AuditEvent)(nil)).IfExists().Exec(ctx)
			return err
		},
	)
}
