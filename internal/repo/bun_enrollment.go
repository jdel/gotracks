package repo

import (
	"context"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"

	"github.com/jdel/gotracks/internal/domain"
)

type pendingEnrollmentRepo struct{ db *bun.DB }

// serializeEnrollment obtains one cross-instance transaction lock. SQLite's
// first write already serializes writers; Postgres needs an advisory lock.
func serializeEnrollment(ctx context.Context, tx bun.Tx) error {
	if tx.Dialect().Name() == dialect.PG {
		_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(?)", int64(0x676f747261636b73))
		return err
	}
	return nil
}

func (r *pendingEnrollmentRepo) Replace(
	ctx context.Context, pending *domain.PendingEnrollment, max int,
) error {
	return r.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := serializeEnrollment(ctx, tx); err != nil {
			return err
		}
		// This write also obtains SQLite's transaction-wide writer lock before
		// the capacity check.
		if _, err := tx.NewDelete().Model((*domain.PendingEnrollment)(nil)).
			Where("expires_at <= ?", time.Now()).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*domain.PendingEnrollment)(nil)).
			Where("email = ?", pending.Email).Exec(ctx); err != nil {
			return err
		}
		if max > 0 {
			count, err := tx.NewSelect().Model((*domain.PendingEnrollment)(nil)).Count(ctx)
			if err != nil {
				return err
			}
			if count >= max {
				return ErrCapacity
			}
		}
		_, err := tx.NewInsert().Model(pending).Exec(ctx)
		return err
	})
}

func (r *pendingEnrollmentRepo) ByTokenHash(
	ctx context.Context, tokenHash string,
) (*domain.PendingEnrollment, error) {
	pending := new(domain.PendingEnrollment)
	err := r.db.NewSelect().Model(pending).
		Where("token_hash = ? AND expires_at > ?", tokenHash, time.Now()).
		Scan(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	return pending, nil
}

func (r *pendingEnrollmentRepo) Activate(
	ctx context.Context, tokenHash, passwordHash string,
) (*domain.PendingEnrollment, *domain.User, error) {
	var (
		pending *domain.PendingEnrollment
		user    *domain.User
	)
	err := r.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := serializeEnrollment(ctx, tx); err != nil {
			return err
		}
		pending = new(domain.PendingEnrollment)
		if err := tx.NewSelect().Model(pending).
			Where("token_hash = ? AND expires_at > ?", tokenHash, time.Now()).
			Scan(ctx); err != nil {
			return mapErr(err)
		}
		// The first account to be activated becomes the administrator. The count
		// is read inside this serialized transaction, so exactly one account can
		// see an empty table and claim admin.
		count, err := tx.NewSelect().Model((*domain.User)(nil)).Count(ctx)
		if err != nil {
			return err
		}

		now := time.Now()
		user = &domain.User{
			Email:           pending.Email,
			Password:        passwordHash,
			EmailVerifiedAt: &now,
			IsAdmin:         count == 0,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if _, err := tx.NewInsert().Model(user).Exec(ctx); err != nil {
			return err
		}
		res, err := tx.NewDelete().Model((*domain.PendingEnrollment)(nil)).
			Where("email = ? AND token_hash = ?", pending.Email, tokenHash).Exec(ctx)
		if err != nil {
			return err
		}
		return affected(res)
	})
	if err != nil {
		return nil, nil, err
	}
	return pending, user, nil
}

func (r *pendingEnrollmentRepo) PurgeExpired(ctx context.Context, now time.Time) error {
	_, err := r.db.NewDelete().Model((*domain.PendingEnrollment)(nil)).
		Where("expires_at <= ?", now).Exec(ctx)
	return err
}
