package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// Adds the export fingerprint column to the audit log.
//
// An export writes an entry carrying a SHA-256 of the exact bytes it produced,
// so a copy of the file can be verified as the untampered original without the
// log storing the file itself — which would freeze personal data past its
// retention.
//
// Guarded by an existence check rather than a bare ALTER: SQLite has no
// ADD COLUMN IF NOT EXISTS, and this runs against a table created moments ago
// in the same release.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			cols, err := existingColumns(ctx, db, "audit_events")
			if err != nil {
				return err
			}
			if cols["hash"] {
				return nil
			}
			if _, err := db.NewAddColumn().
				Model((*domain.AuditEvent)(nil)).
				ColumnExpr("hash VARCHAR").
				Exec(ctx); err != nil {
				return fmt.Errorf("add audit hash column: %w", err)
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			_, err := db.NewDropColumn().
				Model((*domain.AuditEvent)(nil)).Column("hash").Exec(ctx)
			return err
		},
	)
}
