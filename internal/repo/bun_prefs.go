package repo

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

type preferenceRepo struct{ db *bun.DB }

func (r *preferenceRepo) Get(ctx context.Context, userID int64) (*domain.Preference, error) {
	p := new(domain.Preference)
	err := r.db.NewSelect().Model(p).Where("user_id = ?", userID).Scan(ctx)
	return p, mapErr(err)
}

// Upsert writes preferences, inserting the row on first save.
// Done as select-then-insert/update rather than a dialect-specific ON CONFLICT,
// so the same code runs on SQLite and Postgres.
func (r *preferenceRepo) Upsert(ctx context.Context, p *domain.Preference) error {
	existing := new(domain.Preference)
	err := r.db.NewSelect().Model(existing).Where("user_id = ?", p.UserID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		_, err := r.db.NewInsert().Model(p).Exec(ctx)
		return err
	}
	if err != nil {
		return err
	}
	_, err = r.db.NewUpdate().Model(p).
		Column("date_format", "time_zone", "locale", "theme", "week_start",
			"review_period", "updated_at").
		Where("user_id = ?", p.UserID).Exec(ctx)
	return err
}

func (r *preferenceRepo) Delete(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Preference)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

type attachmentRepo struct{ db *bun.DB }

func (r *attachmentRepo) Create(ctx context.Context, a *domain.Attachment) error {
	_, err := r.db.NewInsert().Model(a).Exec(ctx)
	return err
}

func (r *attachmentRepo) ByID(ctx context.Context, userID, id int64) (*domain.Attachment, error) {
	a := new(domain.Attachment)
	err := r.db.NewSelect().Model(a).Where("id = ? AND user_id = ?", id, userID).Scan(ctx)
	return a, mapErr(err)
}

func (r *attachmentRepo) ListForTodo(ctx context.Context, userID, todoID int64) ([]*domain.Attachment, error) {
	as := []*domain.Attachment{}
	err := r.db.NewSelect().Model(&as).
		Where("user_id = ? AND todo_id = ?", userID, todoID).
		Order("id ASC").Scan(ctx)
	return as, err
}

// ListForUser joins in the owning todo's description and state, so the
// attachments-overview page can show what each file is attached to without a
// query per row.
func (r *attachmentRepo) ListForUser(ctx context.Context, userID int64) ([]*domain.AttachmentWithTodo, error) {
	rows := []*domain.AttachmentWithTodo{}
	err := r.db.NewSelect().
		TableExpr("attachments AS att").
		ColumnExpr("att.id AS id, att.todo_id AS todo_id, att.file_name AS file_name").
		ColumnExpr("att.content_type AS content_type, att.size AS size, att.created_at AS created_at").
		ColumnExpr("t.description AS todo_description, t.state AS todo_state").
		Join("JOIN todos AS t ON t.id = att.todo_id").
		Where("att.user_id = ?", userID).
		Order("att.size DESC").
		Scan(ctx, &rows)
	return rows, err
}

func (r *attachmentRepo) Delete(ctx context.Context, userID, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.Attachment)(nil)).
		Where("id = ? AND user_id = ?", id, userID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

// DeleteForTodo removes all attachment rows for a todo and returns them so the
// caller can clean up the files on disk.
func (r *attachmentRepo) DeleteForTodo(ctx context.Context, userID, todoID int64) ([]*domain.Attachment, error) {
	as, err := r.ListForTodo(ctx, userID, todoID)
	if err != nil {
		return nil, err
	}
	if len(as) == 0 {
		return nil, nil
	}
	_, err = r.db.NewDelete().Model((*domain.Attachment)(nil)).
		Where("user_id = ? AND todo_id = ?", userID, todoID).Exec(ctx)
	return as, err
}

// DeleteForUser removes all of a user's attachment rows and returns them so the
// caller can clean up the files on disk.
func (r *attachmentRepo) DeleteForUser(ctx context.Context, userID int64) ([]*domain.Attachment, error) {
	as := []*domain.Attachment{}
	if err := r.db.NewSelect().Model(&as).
		Where("user_id = ?", userID).Scan(ctx); err != nil {
		return nil, err
	}
	if len(as) == 0 {
		return nil, nil
	}
	_, err := r.db.NewDelete().Model((*domain.Attachment)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return as, err
}

type statsRepo struct{ db *bun.DB }

func (r *statsRepo) CountByState(ctx context.Context, userID int64) (map[string]int, error) {
	var rows []struct {
		State string `bun:"state"`
		N     int    `bun:"n"`
	}
	err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		ColumnExpr("state").ColumnExpr("COUNT(*) AS n").
		Where("user_id = ?", userID).GroupExpr("state").Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	for _, row := range rows {
		out[row.State] = row.N
	}
	return out, nil
}

// AvgCompletionDays is computed in Go rather than SQL: date arithmetic differs
// between SQLite and Postgres, and the row count here is small.
func (r *statsRepo) AvgCompletionDays(ctx context.Context, userID int64) (float64, error) {
	var rows []struct {
		CreatedAt   time.Time `bun:"created_at"`
		CompletedAt time.Time `bun:"completed_at"`
	}
	err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		Column("created_at", "completed_at").
		Where("user_id = ? AND completed_at IS NOT NULL", userID).Scan(ctx, &rows)
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	var total float64
	for _, row := range rows {
		total += row.CompletedAt.Sub(row.CreatedAt).Hours() / 24
	}
	return total / float64(len(rows)), nil
}

func (r *statsRepo) CompletedSince(ctx context.Context, userID int64, since time.Time) ([]time.Time, error) {
	var times []time.Time
	err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		Column("completed_at").
		Where("user_id = ? AND completed_at IS NOT NULL AND completed_at >= ?", userID, since).
		Order("completed_at ASC").Scan(ctx, &times)
	return times, err
}

func (r *statsRepo) CountPerContext(ctx context.Context, userID int64) (map[int64]int, error) {
	var rows []struct {
		ContextID int64 `bun:"context_id"`
		N         int   `bun:"n"`
	}
	err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		ColumnExpr("context_id").ColumnExpr("COUNT(*) AS n").
		Where("user_id = ? AND state != ?", userID, domain.StateCompleted).
		GroupExpr("context_id").Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	out := map[int64]int{}
	for _, row := range rows {
		out[row.ContextID] = row.N
	}
	return out, nil
}

func (r *statsRepo) OldestOpen(ctx context.Context, userID int64) (time.Time, error) {
	var t []time.Time
	err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		Column("created_at").
		Where("user_id = ? AND state != ?", userID, domain.StateCompleted).
		Order("created_at ASC").Limit(1).Scan(ctx, &t)
	if err != nil || len(t) == 0 {
		return time.Time{}, err
	}
	return t[0], nil
}

func (r *statsRepo) CountProjectsByState(ctx context.Context, userID int64) (map[string]int, error) {
	var rows []struct {
		State string `bun:"state"`
		N     int    `bun:"n"`
	}
	err := r.db.NewSelect().Model((*domain.Project)(nil)).
		ColumnExpr("state").ColumnExpr("COUNT(*) AS n").
		Where("user_id = ?", userID).GroupExpr("state").Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	for _, row := range rows {
		out[row.State] = row.N
	}
	return out, nil
}

// TotalBytesForUser sums the stored size of an account's attachments.
//
// Summed on demand rather than kept as a running total on the user row: a
// counter has to be corrected on every delete and every failed upload, and
// drifts silently when one is missed. An account holds few enough files that
// the sum is cheap.
func (r *attachmentRepo) TotalBytesForUser(ctx context.Context, userID int64) (int64, error) {
	var total sql.NullInt64
	err := r.db.NewSelect().Model((*domain.Attachment)(nil)).
		ColumnExpr("SUM(size)").Where("user_id = ?", userID).Scan(ctx, &total)
	if err != nil {
		return 0, err
	}
	// SUM over no rows is NULL, not zero.
	return total.Int64, nil
}
