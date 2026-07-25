package repo

import (
	"context"
	"time"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

// AuditFilter narrows a search of the log. A zero value matches everything.
type AuditFilter struct {
	From    *time.Time
	To      *time.Time
	Actor   string // matched against actor and target address
	Action  string
	Outcome string
}

type auditRepo struct{ db *bun.DB }

func (r *auditRepo) Append(ctx context.Context, e *domain.AuditEvent) error {
	if e.OccurredAt.IsZero() {
		e.OccurredAt = time.Now()
	}
	_, err := r.db.NewInsert().Model(e).Exec(ctx)
	return err
}

// apply builds the WHERE clause shared by the count and the page, so the total
// can never describe a different set from the rows.
func (r *auditRepo) apply(q *bun.SelectQuery, f AuditFilter) *bun.SelectQuery {
	if f.From != nil {
		q = q.Where("occurred_at >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("occurred_at <= ?", *f.To)
	}
	if f.Action != "" {
		q = q.Where("action = ?", f.Action)
	}
	if f.Outcome != "" {
		q = q.Where("outcome = ?", f.Outcome)
	}
	if f.Actor != "" {
		// An address appears as the actor or as the target depending on who
		// did what to whom; searching for a person should find both.
		like := "%" + f.Actor + "%"
		q = q.Where("LOWER(actor_email) LIKE LOWER(?) OR LOWER(target_email) LIKE LOWER(?)", like, like)
	}
	return q
}

// PurgeBefore removes entries older than the cutoff.
//
// The only delete on this table, and it exists for one reason: personal data
// may be kept no longer than the purpose needs, whatever lawful basis it rests
// on. There is deliberately still no way to remove a single entry, and nothing
// removes an account's entries when the account goes — retention is a rule
// about age, not a way to edit history.
func (r *auditRepo) PurgeBefore(ctx context.Context, cutoff time.Time) (int, error) {
	res, err := r.db.NewDelete().Model((*domain.AuditEvent)(nil)).
		Where("occurred_at < ?", cutoff).Exec(ctx)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}

// Search returns one page of matching events, newest first, with the total
// number that matched.
func (r *auditRepo) Search(
	ctx context.Context, f AuditFilter, offset, limit int,
) ([]*domain.AuditEvent, int, error) {
	total, err := r.apply(
		r.db.NewSelect().Model((*domain.AuditEvent)(nil)), f,
	).Count(ctx)
	if err != nil {
		return nil, 0, err
	}
	events := []*domain.AuditEvent{}
	q := r.apply(r.db.NewSelect().Model(&events), f).
		Order("occurred_at DESC", "id DESC").
		Offset(offset)
	// A zero limit means everything that matched, which is what an export of
	// the current filter needs.
	if limit > 0 {
		q = q.Limit(limit)
	}
	if err := q.Scan(ctx); err != nil {
		return nil, 0, err
	}
	return events, total, nil
}
