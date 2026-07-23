package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			if _, err := db.NewCreateTable().
				Model((*domain.PendingEnrollment)(nil)).
				IfNotExists().
				Exec(ctx); err != nil {
				return fmt.Errorf("create pending enrollments: %w", err)
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			_, err := db.NewDropTable().
				Model((*domain.PendingEnrollment)(nil)).
				IfExists().
				Exec(ctx)
			return err
		},
	)
}
