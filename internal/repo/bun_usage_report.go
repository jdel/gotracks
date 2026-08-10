package repo

import (
	"context"
	"time"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

type usageReportRepo struct{ db *bun.DB }

// countsByUser runs one grouped query and returns user id -> count.
func (r *usageReportRepo) countsByUser(ctx context.Context, model any) (map[int64]int, error) {
	var rows []struct {
		UserID int64 `bun:"user_id"`
		N      int   `bun:"n"`
	}
	err := r.db.NewSelect().Model(model).
		ColumnExpr("user_id").ColumnExpr("COUNT(*) AS n").
		GroupExpr("user_id").Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]int, len(rows))
	for _, row := range rows {
		out[row.UserID] = row.N
	}
	return out, nil
}

// Aggregate computes the whole instance's usage.
//
// Seven grouped queries plus one user listing, whatever the number of accounts
// — rather than seven per account, which is what the live endpoint does and
// why it is not used for this.
func (r *usageReportRepo) Aggregate(ctx context.Context) ([]*domain.UsageSnapshot, error) {
	users := []*domain.User{}
	if err := r.db.NewSelect().Model(&users).Column("id", "email", "is_admin").Order("id ASC").Scan(ctx); err != nil {
		return nil, err
	}

	todos, err := r.countsByUser(ctx, (*domain.Todo)(nil))
	if err != nil {
		return nil, err
	}
	projects, err := r.countsByUser(ctx, (*domain.Project)(nil))
	if err != nil {
		return nil, err
	}
	notes, err := r.countsByUser(ctx, (*domain.Note)(nil))
	if err != nil {
		return nil, err
	}
	contexts, err := r.countsByUser(ctx, (*domain.Context)(nil))
	if err != nil {
		return nil, err
	}
	tags, err := r.countsByUser(ctx, (*domain.Tag)(nil))
	if err != nil {
		return nil, err
	}
	recurring, err := r.countsByUser(ctx, (*domain.RecurringTodo)(nil))
	if err != nil {
		return nil, err
	}

	var sizeRows []struct {
		UserID int64 `bun:"user_id"`
		N      int64 `bun:"n"`
	}
	if err := r.db.NewSelect().Model((*domain.Attachment)(nil)).
		ColumnExpr("user_id").ColumnExpr("COALESCE(SUM(size), 0) AS n").
		GroupExpr("user_id").Scan(ctx, &sizeRows); err != nil {
		return nil, err
	}
	bytes := make(map[int64]int64, len(sizeRows))
	for _, row := range sizeRows {
		bytes[row.UserID] = row.N
	}

	// Which accounts have a second factor, so the report can be filtered the
	// same way the user list is.
	var twoFactorIDs []int64
	if err := r.db.NewSelect().Model((*domain.TwoFactor)(nil)).
		Column("user_id").Where("enabled = ?", true).Scan(ctx, &twoFactorIDs); err != nil {
		return nil, err
	}
	twoFactor := make(map[int64]bool, len(twoFactorIDs))
	for _, id := range twoFactorIDs {
		twoFactor[id] = true
	}

	now := time.Now()
	out := make([]*domain.UsageSnapshot, 0, len(users))
	for _, u := range users {
		out = append(out, &domain.UsageSnapshot{
			UserID:           u.ID,
			Email:            u.Email,
			IsAdmin:          u.IsAdmin,
			TwoFactorEnabled: twoFactor[u.ID],
			StorageBytes:     bytes[u.ID],
			Todos:            todos[u.ID],
			Projects:         projects[u.ID],
			Notes:            notes[u.ID],
			Contexts:         contexts[u.ID],
			Tags:             tags[u.ID],
			Recurring:        recurring[u.ID],
			GeneratedAt:      now,
		})
	}
	return out, nil
}

// Replace swaps the stored report atomically, so a reader never sees a
// half-rebuilt report.
func (r *usageReportRepo) Replace(ctx context.Context, snapshots []*domain.UsageSnapshot) error {
	return r.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewDelete().Model((*domain.UsageSnapshot)(nil)).
			Where("1 = 1").Exec(ctx); err != nil {
			return err
		}
		if len(snapshots) == 0 {
			return nil
		}
		// Chunked: SQLite caps the number of bound variables per statement,
		// and a thousand accounts times a dozen columns passes it.
		const chunk = 200
		for i := 0; i < len(snapshots); i += chunk {
			end := min(i+chunk, len(snapshots))
			batch := snapshots[i:end]
			if _, err := tx.NewInsert().Model(&batch).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

// ByUserIDs returns the stored snapshot for each of userIDs that has one.
// Accounts created since the last rebuild are simply absent.
func (r *usageReportRepo) ByUserIDs(ctx context.Context, userIDs []int64) (map[int64]*domain.UsageSnapshot, error) {
	out := map[int64]*domain.UsageSnapshot{}
	if len(userIDs) == 0 {
		return out, nil
	}
	rows := []*domain.UsageSnapshot{}
	err := r.db.NewSelect().Model(&rows).Where("user_id IN (?)", bun.List(userIDs)).Scan(ctx)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.UserID] = row
	}
	return out, nil
}

// List returns the stored report in a single query.
func (r *usageReportRepo) List(ctx context.Context, limit int) ([]*domain.UsageSnapshot, error) {
	out := []*domain.UsageSnapshot{}
	// Ordering, filtering and paging happen above this: they depend on the
	// currently configured limits, which the database does not know about.
	q := r.db.NewSelect().Model(&out).Order("user_id ASC")
	if limit > 0 {
		q = q.Limit(limit)
	}
	return out, q.Scan(ctx)
}

func (r *usageReportRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.UsageSnapshot)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}
