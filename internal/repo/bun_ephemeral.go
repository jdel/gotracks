package repo

import (
	"context"
	"encoding/binary"
	"hash/fnv"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"

	"github.com/jdel/gotracks/internal/domain"
)

type ephemeralRepo struct{ db *bun.DB }

func (r *ephemeralRepo) Put(ctx context.Context, e *domain.Ephemeral) error {
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}
	_, err := r.db.NewInsert().Model(e).Exec(ctx)
	return err
}

func ephemeralLockKey(kind string, userID int64) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(kind))
	var id [8]byte
	binary.BigEndian.PutUint64(id[:], uint64(userID))
	_, _ = h.Write(id[:])
	return int64(h.Sum64() & (1<<63 - 1))
}

func (r *ephemeralRepo) ReplaceForUser(ctx context.Context, e *domain.Ephemeral) error {
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}
	return r.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if tx.Dialect().Name() == dialect.PG {
			if _, err := tx.ExecContext(
				ctx, "SELECT pg_advisory_xact_lock(?)", ephemeralLockKey(e.Kind, e.UserID),
			); err != nil {
				return err
			}
		}
		// The delete obtains SQLite's writer lock and invalidates any older
		// ceremony for this flow/account before the replacement is inserted.
		if _, err := tx.NewDelete().Model((*domain.Ephemeral)(nil)).
			Where("kind = ? AND user_id = ?", e.Kind, e.UserID).Exec(ctx); err != nil {
			return err
		}
		_, err := tx.NewInsert().Model(e).Exec(ctx)
		return err
	})
}

// Peek returns a live entry. An expired row is treated as absent rather than
// returned, so callers never have to check the clock themselves.
func (r *ephemeralRepo) Peek(ctx context.Context, kind, id string) (*domain.Ephemeral, error) {
	e := new(domain.Ephemeral)
	err := r.db.NewSelect().Model(e).
		Where("id = ? AND kind = ? AND expires_at > ?", id, kind, time.Now()).Scan(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	return e, nil
}

// Take consumes a single-use entry.
//
// The row is read, then deleted, and the result is only returned when the
// delete actually removed a row. That is what makes it single-use across
// instances: several may read the same token, but only one delete reports a
// row affected, and the losers see ErrNotFound.
func (r *ephemeralRepo) Take(ctx context.Context, kind, id string) (*domain.Ephemeral, error) {
	e, err := r.Peek(ctx, kind, id)
	if err != nil {
		return nil, err
	}
	res, err := r.db.NewDelete().Model((*domain.Ephemeral)(nil)).
		Where("id = ? AND kind = ?", id, kind).Exec(ctx)
	if err != nil {
		return nil, err
	}
	if err := affected(res); err != nil {
		// Another instance consumed it between the read and the delete.
		return nil, ErrNotFound
	}
	return e, nil
}

// Attempt records a failed use.
//
// The counter is incremented in the statement itself rather than read and
// written back, so concurrent guesses cannot share one increment. Once the
// allowance is spent the row goes, and the caller has to start the flow again.
func (r *ephemeralRepo) Attempt(ctx context.Context, kind, id string, maxAttempts int) (*domain.Ephemeral, error) {
	res, err := r.db.NewUpdate().Model((*domain.Ephemeral)(nil)).
		Set("attempts = attempts + 1").
		Where("id = ? AND kind = ? AND expires_at > ?", id, kind, time.Now()).Exec(ctx)
	if err != nil {
		return nil, err
	}
	if err := affected(res); err != nil {
		return nil, ErrNotFound
	}

	e, err := r.Peek(ctx, kind, id)
	if err != nil {
		return nil, err
	}
	if e.Attempts >= maxAttempts {
		if _, err := r.db.NewDelete().Model((*domain.Ephemeral)(nil)).
			Where("id = ? AND kind = ?", id, kind).Exec(ctx); err != nil {
			return nil, err
		}
	}
	return e, nil
}

func (r *ephemeralRepo) CountForUser(ctx context.Context, kind string, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.Ephemeral)(nil)).
		Where("kind = ? AND user_id = ? AND expires_at > ?", kind, userID, time.Now()).Count(ctx)
}

func (r *ephemeralRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Ephemeral)(nil)).
		Where("user_id = ? AND user_id <> 0", userID).Exec(ctx)
	return err
}

func (r *ephemeralRepo) PurgeExpired(ctx context.Context, now time.Time) error {
	_, err := r.db.NewDelete().Model((*domain.Ephemeral)(nil)).
		Where("expires_at <= ?", now).Exec(ctx)
	return err
}
