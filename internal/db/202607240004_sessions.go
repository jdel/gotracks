package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// Adds session identity and metadata to refresh tokens, so a user can see and
// revoke their active sessions.
//
// A refresh token rotates on every use, so one sign-in is a chain of rows. The
// session_id ties that chain together; the rest is what a person needs to
// recognise a device. Existing rows are backfilled a session id and a start
// time so they appear in the list rather than as blanks.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			cols, err := existingColumns(ctx, db, "refresh_tokens")
			if err != nil {
				return err
			}
			adds := map[string]string{
				"session_id":   "session_id VARCHAR NOT NULL DEFAULT ''",
				"started_at":   "started_at TIMESTAMP",
				"last_used_at": "last_used_at TIMESTAMP",
				"ip":           "ip VARCHAR",
				"user_agent":   "user_agent VARCHAR",
			}
			for name, ddl := range adds {
				if cols[name] {
					continue
				}
				if _, err := db.ExecContext(ctx, "ALTER TABLE refresh_tokens ADD COLUMN "+ddl); err != nil {
					return fmt.Errorf("add %s: %w", name, err)
				}
			}

			// Backfill in Go rather than SQL: a unique session id per row is
			// awkward to generate portably, and existing tokens are few.
			rows := []*domain.RefreshToken{}
			if err := db.NewSelect().Model(&rows).
				Where("session_id = '' OR session_id IS NULL").Scan(ctx); err != nil {
				return err
			}
			for _, row := range rows {
				buf := make([]byte, 16)
				if _, err := rand.Read(buf); err != nil {
					return err
				}
				if _, err := db.NewUpdate().Model((*domain.RefreshToken)(nil)).
					Set("session_id = ?", hex.EncodeToString(buf)).
					Set("started_at = ?", row.CreatedAt).
					Set("last_used_at = ?", row.CreatedAt).
					Where("id = ?", row.ID).Exec(ctx); err != nil {
					return err
				}
			}
			if _, err := db.NewCreateIndex().
				Model((*domain.RefreshToken)(nil)).
				Index("refresh_tokens_session_idx").
				Column("user_id", "session_id").
				IfNotExists().Exec(ctx); err != nil {
				return fmt.Errorf("index sessions: %w", err)
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			for _, col := range []string{"session_id", "started_at", "last_used_at", "ip", "user_agent"} {
				if _, err := db.NewDropColumn().
					Model((*domain.RefreshToken)(nil)).Column(col).Exec(ctx); err != nil {
					return err
				}
			}
			return nil
		},
	)
}
