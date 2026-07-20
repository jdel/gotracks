package repo

import (
	"context"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

type recurringRepo struct{ db *bun.DB }

func (r *recurringRepo) Create(ctx context.Context, rec *domain.RecurringTodo) error {
	_, err := r.db.NewInsert().Model(rec).Exec(ctx)
	return err
}

func (r *recurringRepo) Update(ctx context.Context, rec *domain.RecurringTodo) error {
	res, err := r.db.NewUpdate().Model(rec).
		Column("context_id", "project_id", "description", "notes", "state", "period",
			"every_n", "weekdays", "day_of_month", "month_of_year", "show_from_days",
			"start_from", "end_date", "last_spawned_at", "completed_at", "updated_at").
		Where("id = ? AND user_id = ?", rec.ID, rec.UserID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *recurringRepo) Delete(ctx context.Context, userID, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.RecurringTodo)(nil)).
		Where("id = ? AND user_id = ?", id, userID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *recurringRepo) ByID(ctx context.Context, userID, id int64) (*domain.RecurringTodo, error) {
	rec := new(domain.RecurringTodo)
	err := r.db.NewSelect().Model(rec).Where("id = ? AND user_id = ?", id, userID).Scan(ctx)
	return rec, mapErr(err)
}

func (r *recurringRepo) List(ctx context.Context, userID int64, state string) ([]*domain.RecurringTodo, error) {
	recs := []*domain.RecurringTodo{}
	q := r.db.NewSelect().Model(&recs).Where("user_id = ?", userID)
	if state != "" {
		q = q.Where("state = ?", state)
	}
	err := q.Order("id ASC").Scan(ctx)
	return recs, err
}

func (r *recurringRepo) CountInContext(ctx context.Context, userID, contextID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.RecurringTodo)(nil)).
		Where("user_id = ? AND context_id = ?", userID, contextID).Count(ctx)
}

func (r *recurringRepo) DetachProject(ctx context.Context, userID, projectID int64) error {
	_, err := r.db.NewUpdate().Model((*domain.RecurringTodo)(nil)).
		Set("project_id = NULL").
		Where("user_id = ? AND project_id = ?", userID, projectID).Exec(ctx)
	return err
}

func (r *recurringRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.RecurringTodo)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

func (r *recurringRepo) DeleteForContext(ctx context.Context, userID, contextID int64) error {
	_, err := r.db.NewDelete().Model((*domain.RecurringTodo)(nil)).
		Where("user_id = ? AND context_id = ?", userID, contextID).Exec(ctx)
	return err
}

func (r *recurringRepo) HasOpenInstance(ctx context.Context, userID, recurringID int64) (bool, error) {
	n, err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		Where("user_id = ? AND recurring_todo_id = ? AND state != ?",
			userID, recurringID, domain.StateCompleted).
		Count(ctx)
	return n > 0, err
}

func (r *recurringRepo) CountForUser(ctx context.Context, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.RecurringTodo)(nil)).
		Where("user_id = ?", userID).Count(ctx)
}
