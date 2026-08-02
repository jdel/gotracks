package repo

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

type settingsRepo struct{ db *bun.DB }

// Get returns the instance settings, creating the row from defaults on first use.
func (r *settingsRepo) Get(ctx context.Context, defaultAllowRegister bool) (*domain.InstanceSettings, error) {
	s := new(domain.InstanceSettings)
	err := r.db.NewSelect().Model(s).Where("id = ?", domain.SettingsID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Seed from configuration the first time the server runs.
		s = &domain.InstanceSettings{
			ID:                  domain.SettingsID,
			AllowRegister:       defaultAllowRegister,
			UsageReportTimeZone: "UTC",
			UpdatedAt:           time.Now(),
		}
		if _, err := r.db.NewInsert().Model(s).Exec(ctx); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (r *settingsRepo) Update(ctx context.Context, s *domain.InstanceSettings) error {
	s.ID = domain.SettingsID
	s.UpdatedAt = time.Now()
	res, err := r.db.NewUpdate().Model(s).
		Column("allow_register", "usage_report_at_minute", "usage_report_time_zone", "usage_report_run_at", "updated_at").
		Where("id = ?", domain.SettingsID).Exec(ctx)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		_, err := r.db.NewInsert().Model(s).Exec(ctx)
		return err
	}
	return nil
}

type credentialRepo struct{ db *bun.DB }

func (r *credentialRepo) Create(ctx context.Context, c *domain.Credential) error {
	_, err := r.db.NewInsert().Model(c).Exec(ctx)
	return err
}

func (r *credentialRepo) ListForUser(ctx context.Context, userID int64) ([]*domain.Credential, error) {
	cs := []*domain.Credential{}
	err := r.db.NewSelect().Model(&cs).Where("user_id = ?", userID).Order("id ASC").Scan(ctx)
	return cs, err
}

// ByCredentialID finds a passkey by its WebAuthn credential id, across users:
// a passkey login identifies the user rather than the other way round.
func (r *credentialRepo) ByCredentialID(ctx context.Context, credentialID string) (*domain.Credential, error) {
	c := new(domain.Credential)
	err := r.db.NewSelect().Model(c).Where("credential_id = ?", credentialID).Scan(ctx)
	return c, mapErr(err)
}

func (r *credentialRepo) Update(ctx context.Context, c *domain.Credential) error {
	_, err := r.db.NewUpdate().Model(c).
		Column("sign_count", "last_used_at", "name", "backup_state").
		Where("id = ?", c.ID).Exec(ctx)
	return err
}

func (r *credentialRepo) Delete(ctx context.Context, userID, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.Credential)(nil)).
		Where("id = ? AND user_id = ?", id, userID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *credentialRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Credential)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

type twoFactorRepo struct{ db *bun.DB }

func (r *twoFactorRepo) Get(ctx context.Context, userID int64) (*domain.TwoFactor, error) {
	t := new(domain.TwoFactor)
	err := r.db.NewSelect().Model(t).Where("user_id = ?", userID).Scan(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	return t, nil
}

// Upsert writes the row, inserting it the first time a user enrols. The update
// lists its columns explicitly, matching settingsRepo.Update.
func (r *twoFactorRepo) Upsert(ctx context.Context, t *domain.TwoFactor) error {
	t.UpdatedAt = time.Now()
	res, err := r.db.NewUpdate().Model(t).
		Column("enabled", "secret", "last_step", "enabled_at", "updated_at").
		Where("user_id = ?", t.UserID).Exec(ctx)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		_, err := r.db.NewInsert().Model(t).Exec(ctx)
		return err
	}
	return nil
}

func (r *twoFactorRepo) ConsumeStep(ctx context.Context, userID, step int64) error {
	res, err := r.db.NewUpdate().Model((*domain.TwoFactor)(nil)).
		Set("last_step = ?", step).
		Set("updated_at = ?", time.Now()).
		Where("user_id = ? AND enabled = ? AND last_step < ?", userID, true, step).
		Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *twoFactorRepo) EnabledUserIDs(ctx context.Context) ([]int64, error) {
	var ids []int64
	err := r.db.NewSelect().Model((*domain.TwoFactor)(nil)).
		Column("user_id").Where("enabled = ?", true).Scan(ctx, &ids)
	return ids, err
}

func (r *twoFactorRepo) EnabledUserIDsIn(ctx context.Context, ids []int64) ([]int64, error) {
	out := []int64{}
	if len(ids) == 0 {
		return out, nil
	}
	err := r.db.NewSelect().Model((*domain.TwoFactor)(nil)).
		Column("user_id").
		Where("enabled = ? AND user_id IN (?)", true, bun.List(ids)).
		Scan(ctx, &out)
	return out, err
}

func (r *twoFactorRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.TwoFactor)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

type recoveryCodeRepo struct{ db *bun.DB }

// ReplaceAll drops any existing codes before inserting the new set, so
// regenerating invalidates every code handed out previously.
func (r *recoveryCodeRepo) ReplaceAll(ctx context.Context, userID int64, hashes []string) error {
	return r.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewDelete().Model((*domain.RecoveryCode)(nil)).
			Where("user_id = ?", userID).Exec(ctx); err != nil {
			return err
		}
		if len(hashes) == 0 {
			return nil
		}
		now := time.Now()
		codes := make([]*domain.RecoveryCode, 0, len(hashes))
		for _, h := range hashes {
			codes = append(codes, &domain.RecoveryCode{UserID: userID, CodeHash: h, CreatedAt: now})
		}
		_, err := tx.NewInsert().Model(&codes).Exec(ctx)
		return err
	})
}

func (r *recoveryCodeRepo) ByHash(ctx context.Context, userID int64, hash string) (*domain.RecoveryCode, error) {
	c := new(domain.RecoveryCode)
	err := r.db.NewSelect().Model(c).
		Where("user_id = ? AND code_hash = ? AND used_at IS NULL", userID, hash).Scan(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	return c, nil
}

// Consume marks a code used, and reports ErrNotFound when it already was. The
// "used_at IS NULL" guard is what makes this safe against two requests
// presenting the same code at once: only one of them updates a row.
func (r *recoveryCodeRepo) Consume(ctx context.Context, id int64) error {
	res, err := r.db.NewUpdate().Model((*domain.RecoveryCode)(nil)).
		Set("used_at = ?", time.Now()).
		Where("id = ? AND used_at IS NULL", id).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *recoveryCodeRepo) CountUnused(ctx context.Context, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.RecoveryCode)(nil)).
		Where("user_id = ? AND used_at IS NULL", userID).Count(ctx)
}

func (r *recoveryCodeRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.RecoveryCode)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

type loginAttemptRepo struct{ db *bun.DB }

func normaliseKey(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func (r *loginAttemptRepo) Get(ctx context.Context, email string) (*domain.LoginAttempt, error) {
	a := new(domain.LoginAttempt)
	err := r.db.NewSelect().Model(a).Where("email = ?", normaliseKey(email)).Scan(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	return a, nil
}

// RecordFailure increments the counter atomically, locking the login once it
// reaches the threshold.
func (r *loginAttemptRepo) RecordFailure(
	ctx context.Context, email string, lockFor time.Duration, threshold int,
) (*domain.LoginAttempt, error) {
	key := normaliseKey(email)
	now := time.Now()
	lockedUntil := now.Add(lockFor)

	increment := func() (bool, error) {
		res, err := r.db.NewUpdate().Model((*domain.LoginAttempt)(nil)).
			Set("failures = failures + 1").
			Set("locked_until = CASE WHEN failures + 1 >= ? THEN ? ELSE locked_until END",
				threshold, lockedUntil).
			Set("updated_at = ?", now).
			Where("email = ?", key).Exec(ctx)
		if err != nil {
			return false, err
		}
		n, err := res.RowsAffected()
		return n > 0, err
	}

	updated, err := increment()
	if err != nil {
		return nil, err
	}
	if !updated {
		a := &domain.LoginAttempt{Email: key, Failures: 1, UpdatedAt: now}
		if threshold <= 1 {
			a.LockedUntil = &lockedUntil
		}
		if _, err := r.db.NewInsert().Model(a).Exec(ctx); err != nil {
			// Another request may have inserted the same key after our update
			// matched nothing. Retrying the atomic increment preserves both
			// failures without relying on dialect-specific upsert syntax.
			updated, updateErr := increment()
			if updateErr != nil {
				return nil, updateErr
			}
			if !updated {
				return nil, err
			}
		}
	}
	return r.Get(ctx, key)
}

func (r *loginAttemptRepo) Clear(ctx context.Context, email string) error {
	_, err := r.db.NewDelete().Model((*domain.LoginAttempt)(nil)).
		Where("email = ?", normaliseKey(email)).Exec(ctx)
	return err
}

func (r *loginAttemptRepo) PurgeBefore(ctx context.Context, cutoff time.Time) error {
	_, err := r.db.NewDelete().Model((*domain.LoginAttempt)(nil)).
		Where("updated_at < ?", cutoff).Exec(ctx)
	return err
}
