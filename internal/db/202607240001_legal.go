package db

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// Adds the legal documents and the record of who agreed to them at
// registration.
//
// legal_documents holds only the operator's replacements: an absent row means
// the text shipped in the binary is what readers see. legal_acceptances holds
// one row per account, written once when the account is created.
func init() {
	migrations.MustRegister(
		func(ctx context.Context, db *bun.DB) error {
			for _, model := range []any{
				(*domain.LegalDocument)(nil),
				(*domain.LegalAcceptance)(nil),
			} {
				if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
					return fmt.Errorf("create legal table for %T: %w", model, err)
				}
			}
			return nil
		},
		func(ctx context.Context, db *bun.DB) error {
			for _, model := range []any{
				(*domain.LegalAcceptance)(nil),
				(*domain.LegalDocument)(nil),
			} {
				if _, err := db.NewDropTable().Model(model).IfExists().Exec(ctx); err != nil {
					return err
				}
			}
			return nil
		},
	)
}
