package repo

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// NewStore builds a Store backed by the given bun.DB.
func NewStore(db *bun.DB) *Store {
	return &Store{
		Users:         &userRepo{db},
		Enrollments:   &pendingEnrollmentRepo{db},
		RefreshTokens: &refreshTokenRepo{db},
		Contexts:      &contextRepo{db},
		Projects:      &projectRepo{db},
		Todos:         &todoRepo{db},
		Tags:          &tagRepo{db},
		Notes:         &noteRepo{db},
		Recurring:     &recurringRepo{db},
		Preferences:   &preferenceRepo{db},
		Attachments:   &attachmentRepo{db},
		Stats:         &statsRepo{db},
		Settings:      &settingsRepo{db},
		Credentials:   &credentialRepo{db},
		TwoFactor:     &twoFactorRepo{db},
		LoginAttempts: &loginAttemptRepo{db},
		Ephemeral:     &ephemeralRepo{db},
		UsageReports:  &usageReportRepo{db},
		RecoveryCodes: &recoveryCodeRepo{db},
	}
}

func mapErr(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

type userRepo struct{ db *bun.DB }

func (r *userRepo) Create(ctx context.Context, u *domain.User) error {
	_, err := r.db.NewInsert().Model(u).Exec(ctx)
	return err
}

// ByEmail looks up by the canonical (lower-cased) address, so a sign-in typed
// with different casing still finds the account.
func (r *userRepo) ByEmail(ctx context.Context, email string) (*domain.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	u := new(domain.User)
	err := r.db.NewSelect().Model(u).Where("email = ?", email).Scan(ctx)
	return u, mapErr(err)
}

func (r *userRepo) ByID(ctx context.Context, id int64) (*domain.User, error) {
	u := new(domain.User)
	err := r.db.NewSelect().Model(u).Where("id = ?", id).Scan(ctx)
	return u, mapErr(err)
}

func (r *userRepo) Count(ctx context.Context) (int, error) {
	return r.db.NewSelect().Model((*domain.User)(nil)).Count(ctx)
}

func (r *userRepo) CountAdmins(ctx context.Context) (int, error) {
	return r.db.NewSelect().Model((*domain.User)(nil)).Where("is_admin = ?", true).Count(ctx)
}

func (r *userRepo) Update(ctx context.Context, u *domain.User) error {
	res, err := r.db.NewUpdate().Model(u).
		Column("email", "password", "is_admin", "email_verified_at", "updated_at").
		Where("id = ?", u.ID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *userRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.User)(nil)).Where("id = ?", id).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *userRepo) List(ctx context.Context) ([]*domain.User, error) {
	us := []*domain.User{}
	err := r.db.NewSelect().Model(&us).Order("id ASC").Scan(ctx)
	return us, err
}

type refreshTokenRepo struct{ db *bun.DB }

func (r *refreshTokenRepo) Create(ctx context.Context, t *domain.RefreshToken) error {
	_, err := r.db.NewInsert().Model(t).Exec(ctx)
	return err
}

func (r *refreshTokenRepo) ByHash(ctx context.Context, hash string) (*domain.RefreshToken, error) {
	t := new(domain.RefreshToken)
	err := r.db.NewSelect().Model(t).Where("token_hash = ?", hash).Scan(ctx)
	return t, mapErr(err)
}

func (r *refreshTokenRepo) Consume(ctx context.Context, hash string) error {
	res, err := r.db.NewDelete().
		Model((*domain.RefreshToken)(nil)).
		Where("token_hash = ?", hash).
		Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *refreshTokenRepo) DeleteByHash(ctx context.Context, hash string) error {
	_, err := r.db.NewDelete().Model((*domain.RefreshToken)(nil)).Where("token_hash = ?", hash).Exec(ctx)
	return err
}

func (r *refreshTokenRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.RefreshToken)(nil)).Where("user_id = ?", userID).Exec(ctx)
	return err
}

type contextRepo struct{ db *bun.DB }

func (r *contextRepo) Create(ctx context.Context, c *domain.Context) error {
	_, err := r.db.NewInsert().Model(c).Exec(ctx)
	return err
}

func (r *contextRepo) Update(ctx context.Context, c *domain.Context) error {
	res, err := r.db.NewUpdate().Model(c).
		Column("name", "position", "state", "updated_at").
		Where("id = ? AND user_id = ?", c.ID, c.UserID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *contextRepo) Delete(ctx context.Context, userID, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.Context)(nil)).
		Where("id = ? AND user_id = ?", id, userID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *contextRepo) ByID(ctx context.Context, userID, id int64) (*domain.Context, error) {
	c := new(domain.Context)
	err := r.db.NewSelect().Model(c).Where("id = ? AND user_id = ?", id, userID).Scan(ctx)
	return c, mapErr(err)
}

// ByName matches on the name with any leading "@" trimmed on both sides, so
// "@home", "home" and "Home" all find the same context.
func (r *contextRepo) ByName(ctx context.Context, userID int64, name string) (*domain.Context, error) {
	c := new(domain.Context)
	err := r.db.NewSelect().Model(c).
		Where("user_id = ?", userID).
		Where("LOWER(TRIM(name, '@')) = LOWER(TRIM(?, '@'))", name).
		Limit(1).Scan(ctx)
	return c, mapErr(err)
}

func (r *contextRepo) List(ctx context.Context, userID int64) ([]*domain.Context, error) {
	// Started empty rather than nil: a nil slice marshals to JSON null, and
	// every other List here returns an empty array for no rows.
	cs := []*domain.Context{}
	err := r.db.NewSelect().Model(&cs).Where("user_id = ?", userID).
		Order("position ASC", "id ASC").Scan(ctx)
	return cs, err
}

func (r *contextRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Context)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

func (r *contextRepo) MaxPosition(ctx context.Context, userID int64) (int, error) {
	var max sql.NullInt64
	err := r.db.NewSelect().Model((*domain.Context)(nil)).
		ColumnExpr("MAX(position)").Where("user_id = ?", userID).Scan(ctx, &max)
	if err != nil {
		return 0, err
	}
	return int(max.Int64), nil
}

// affected converts a zero-rows-affected result into ErrNotFound.
func affected(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
