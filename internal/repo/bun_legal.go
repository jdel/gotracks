package repo

import (
	"context"
	"time"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

type legalRepo struct{ db *bun.DB }

func (r *legalRepo) Documents(ctx context.Context) ([]*domain.LegalDocument, error) {
	docs := []*domain.LegalDocument{}
	err := r.db.NewSelect().Model(&docs).Order("locale ASC", "kind ASC").Scan(ctx)
	return docs, err
}

func (r *legalRepo) Put(ctx context.Context, doc *domain.LegalDocument) error {
	if doc.UpdatedAt.IsZero() {
		doc.UpdatedAt = time.Now()
	}
	_, err := r.db.NewInsert().Model(doc).
		On("CONFLICT (locale, kind) DO UPDATE").
		Set("body = EXCLUDED.body, updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

// Delete drops a replacement, which is what restores the shipped text.
func (r *legalRepo) Delete(ctx context.Context, locale, kind string) error {
	_, err := r.db.NewDelete().Model((*domain.LegalDocument)(nil)).
		Where("locale = ? AND kind = ?", locale, kind).Exec(ctx)
	return err
}

// Accept records agreement, ignoring an account already on file so a retried
// registration does not fail on the second attempt.
func (r *legalRepo) Accept(ctx context.Context, userID int64) error {
	_, err := r.db.NewInsert().
		Model(&domain.LegalAcceptance{UserID: userID, AcceptedAt: time.Now()}).
		Ignore().Exec(ctx)
	return err
}

// AcceptanceForUser returns when the account agreed, ErrNotFound if it never
// did — an account created before the documents were switched on.
func (r *legalRepo) AcceptanceForUser(ctx context.Context, userID int64) (*domain.LegalAcceptance, error) {
	row := new(domain.LegalAcceptance)
	err := r.db.NewSelect().Model(row).Where("user_id = ?", userID).Scan(ctx)
	return row, mapErr(err)
}

func (r *legalRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.LegalAcceptance)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}
