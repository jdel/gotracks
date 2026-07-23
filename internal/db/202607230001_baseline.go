package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			for _, model := range models() {
				if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
					return fmt.Errorf("create table for %T: %w", model, err)
				}
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			models := models()
			for i := len(models) - 1; i >= 0; i-- {
				if _, err := db.NewDropTable().Model(models[i]).IfExists().Exec(ctx); err != nil {
					return fmt.Errorf("drop table for %T: %w", models[i], err)
				}
			}
			return nil
		},
	)
}
