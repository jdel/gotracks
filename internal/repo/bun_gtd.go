package repo

import (
	"context"
	"database/sql"
	"time"

	"github.com/uptrace/bun"

	"github.com/jdel/gotracks/internal/domain"
)

type projectRepo struct{ db *bun.DB }

func (r *projectRepo) Create(ctx context.Context, p *domain.Project) error {
	_, err := r.db.NewInsert().Model(p).Exec(ctx)
	return err
}

func (r *projectRepo) Update(ctx context.Context, p *domain.Project) error {
	res, err := r.db.NewUpdate().Model(p).
		Column("name", "description", "state", "position", "default_context_id",
			"completed_at", "last_reviewed", "updated_at").
		Where("id = ? AND user_id = ?", p.ID, p.UserID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *projectRepo) Delete(ctx context.Context, userID, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.Project)(nil)).
		Where("id = ? AND user_id = ?", id, userID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *projectRepo) ByID(ctx context.Context, userID, id int64) (*domain.Project, error) {
	p := new(domain.Project)
	err := r.db.NewSelect().Model(p).Where("id = ? AND user_id = ?", id, userID).Scan(ctx)
	return p, mapErr(err)
}

// ByName matches on the name with any leading "#" trimmed on both sides.
func (r *projectRepo) ByName(ctx context.Context, userID int64, name string) (*domain.Project, error) {
	p := new(domain.Project)
	err := r.db.NewSelect().Model(p).
		Where("user_id = ?", userID).
		Where("LOWER(TRIM(name, '#')) = LOWER(TRIM(?, '#'))", name).
		Limit(1).Scan(ctx)
	return p, mapErr(err)
}

func (r *projectRepo) List(ctx context.Context, userID int64, state string) ([]*domain.Project, error) {
	ps := []*domain.Project{}
	q := r.db.NewSelect().Model(&ps).Where("user_id = ?", userID)
	if state != "" {
		q = q.Where("state = ?", state)
	}
	err := q.Order("position ASC", "id ASC").Scan(ctx)
	return ps, err
}

func (r *projectRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Project)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

func (r *projectRepo) MaxPosition(ctx context.Context, userID int64) (int, error) {
	var max sql.NullInt64
	err := r.db.NewSelect().Model((*domain.Project)(nil)).
		ColumnExpr("MAX(position)").Where("user_id = ?", userID).Scan(ctx, &max)
	if err != nil {
		return 0, err
	}
	return int(max.Int64), nil
}

type todoRepo struct{ db *bun.DB }

func (r *todoRepo) Create(ctx context.Context, t *domain.Todo) error {
	_, err := r.db.NewInsert().Model(t).Exec(ctx)
	return err
}

func (r *todoRepo) Update(ctx context.Context, t *domain.Todo) error {
	res, err := r.db.NewUpdate().Model(t).
		Column("context_id", "project_id", "description", "due", "show_from",
			"completed_at", "state", "starred", "position", "updated_at").
		Where("id = ? AND user_id = ?", t.ID, t.UserID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *todoRepo) Delete(ctx context.Context, userID, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.Todo)(nil)).
		Where("id = ? AND user_id = ?", id, userID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *todoRepo) ByID(ctx context.Context, userID, id int64) (*domain.Todo, error) {
	t := new(domain.Todo)
	err := r.db.NewSelect().Model(t).Where("t.id = ? AND t.user_id = ?", id, userID).Scan(ctx)
	return t, mapErr(err)
}

func (r *todoRepo) List(ctx context.Context, userID int64, f TodoFilter) ([]*domain.Todo, error) {
	ts := []*domain.Todo{}
	q := r.db.NewSelect().Model(&ts).Where("t.user_id = ?", userID)

	if f.State != "" {
		q = q.Where("t.state = ?", f.State)
	}
	if f.ContextID != nil {
		q = q.Where("t.context_id = ?", *f.ContextID)
	}
	if f.ProjectID != nil {
		q = q.Where("t.project_id = ?", *f.ProjectID)
	}
	if f.Starred {
		q = q.Where("t.starred = ?", true)
	}
	if f.DueBefore != nil {
		q = q.Where("t.due IS NOT NULL AND t.due < ?", *f.DueBefore)
	}
	if f.Tag != "" {
		// Portable across SQLite and Postgres: subquery instead of a dialect-specific join hint.
		q = q.Where(`t.id IN (SELECT tgg.todo_id FROM taggings AS tgg
			JOIN tags AS tg ON tg.id = tgg.tag_id
			WHERE tg.user_id = ? AND tg.name = ?)`, userID, f.Tag)
	}

	err := q.Order("t.position ASC", "t.id ASC").Scan(ctx)
	return ts, err
}

func (r *todoRepo) MaxPosition(ctx context.Context, userID, contextID int64) (int, error) {
	var max sql.NullInt64
	err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		ColumnExpr("MAX(position)").
		Where("user_id = ? AND context_id = ?", userID, contextID).Scan(ctx, &max)
	if err != nil {
		return 0, err
	}
	return int(max.Int64), nil
}

func (r *todoRepo) CountInContext(ctx context.Context, userID, contextID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.Todo)(nil)).
		Where("user_id = ? AND context_id = ?", userID, contextID).Count(ctx)
}

func (r *todoRepo) DetachProject(ctx context.Context, userID, projectID int64) error {
	_, err := r.db.NewUpdate().Model((*domain.Todo)(nil)).
		Set("project_id = NULL").
		Where("user_id = ? AND project_id = ?", userID, projectID).Exec(ctx)
	return err
}

func (r *todoRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Todo)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

func (r *todoRepo) ActivateDue(ctx context.Context, userID int64, now time.Time) error {
	// A deferred action with no show_from at all is also activated. Deferred
	// means "waiting for a date"; with no date there is nothing to wait for,
	// and such a row would otherwise be stuck in the tickler forever, listed
	// under "No date" with nothing able to promote it.
	_, err := r.db.NewUpdate().Model((*domain.Todo)(nil)).
		Set("state = ?", domain.StateActive).
		Set("updated_at = ?", now).
		Where("user_id = ? AND state = ? AND (show_from IS NULL OR show_from <= ?)",
			userID, domain.StateDeferred, now).
		Exec(ctx)
	return err
}

func (r *todoRepo) CountByProjectState(ctx context.Context, userID int64) (map[int64]map[string]int, error) {
	var rows []struct {
		ProjectID int64  `bun:"project_id"`
		State     string `bun:"state"`
		N         int    `bun:"n"`
	}
	err := r.db.NewSelect().Model((*domain.Todo)(nil)).
		ColumnExpr("project_id").ColumnExpr("state").ColumnExpr("COUNT(*) AS n").
		Where("user_id = ? AND project_id IS NOT NULL", userID).
		GroupExpr("project_id, state").
		Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]map[string]int, len(rows))
	for _, row := range rows {
		byState := out[row.ProjectID]
		if byState == nil {
			byState = map[string]int{}
			out[row.ProjectID] = byState
		}
		byState[row.State] = row.N
	}
	return out, nil
}

type tagRepo struct{ db *bun.DB }

func (r *tagRepo) List(ctx context.Context, userID int64) ([]*domain.Tag, error) {
	ts := []*domain.Tag{}
	err := r.db.NewSelect().Model(&ts).Where("user_id = ?", userID).Order("name ASC").Scan(ctx)
	return ts, err
}

// EnsureAll returns the tags for names, creating any that do not exist yet.
func (r *tagRepo) EnsureAll(ctx context.Context, userID int64, names []string) ([]*domain.Tag, error) {
	out := make([]*domain.Tag, 0, len(names))
	for _, name := range names {
		if name == "" {
			continue
		}
		tag := new(domain.Tag)
		err := r.db.NewSelect().Model(tag).
			Where("user_id = ? AND name = ?", userID, name).Scan(ctx)
		if err != nil {
			tag = &domain.Tag{UserID: userID, Name: name}
			if _, err := r.db.NewInsert().Model(tag).Exec(ctx); err != nil {
				return nil, err
			}
		}
		out = append(out, tag)
	}
	return out, nil
}

// SetForTodo replaces the tag set of a todo.
func (r *tagRepo) SetForTodo(ctx context.Context, userID, todoID int64, names []string) error {
	if err := r.DeleteForTodo(ctx, userID, todoID); err != nil {
		return err
	}
	tags, err := r.EnsureAll(ctx, userID, names)
	if err != nil {
		return err
	}
	if len(tags) == 0 {
		return nil
	}
	taggings := make([]domain.Tagging, 0, len(tags))
	for _, t := range tags {
		taggings = append(taggings, domain.Tagging{TagID: t.ID, TodoID: todoID, UserID: userID})
	}
	_, err = r.db.NewInsert().Model(&taggings).Exec(ctx)
	return err
}

// ForTodos returns tag names keyed by todo id.
func (r *tagRepo) ForTodos(ctx context.Context, userID int64, todoIDs []int64) (map[int64][]string, error) {
	out := map[int64][]string{}
	if len(todoIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		TodoID int64  `bun:"todo_id"`
		Name   string `bun:"name"`
	}
	err := r.db.NewSelect().
		TableExpr("taggings AS tgg").
		ColumnExpr("tgg.todo_id AS todo_id").ColumnExpr("tg.name AS name").
		Join("JOIN tags AS tg ON tg.id = tgg.tag_id").
		Where("tgg.user_id = ? AND tgg.todo_id IN (?)", userID, bun.List(todoIDs)).
		Order("tg.name ASC").
		Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.TodoID] = append(out[row.TodoID], row.Name)
	}
	return out, nil
}

func (r *tagRepo) DeleteForTodo(ctx context.Context, userID, todoID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Tagging)(nil)).
		Where("user_id = ? AND todo_id = ?", userID, todoID).Exec(ctx)
	return err
}

// DeleteForUser drops the taggings first, so no row is ever left pointing at a
// tag that no longer exists.
func (r *tagRepo) DeleteForUser(ctx context.Context, userID int64) error {
	if _, err := r.db.NewDelete().Model((*domain.Tagging)(nil)).
		Where("user_id = ?", userID).Exec(ctx); err != nil {
		return err
	}
	_, err := r.db.NewDelete().Model((*domain.Tag)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

type noteRepo struct{ db *bun.DB }

func (r *noteRepo) Create(ctx context.Context, n *domain.Note) error {
	_, err := r.db.NewInsert().Model(n).Exec(ctx)
	return err
}

func (r *noteRepo) Update(ctx context.Context, n *domain.Note) error {
	res, err := r.db.NewUpdate().Model(n).
		Column("body", "project_id", "updated_at").
		Where("id = ? AND user_id = ?", n.ID, n.UserID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *noteRepo) Delete(ctx context.Context, userID, id int64) error {
	res, err := r.db.NewDelete().Model((*domain.Note)(nil)).
		Where("id = ? AND user_id = ?", id, userID).Exec(ctx)
	if err != nil {
		return err
	}
	return affected(res)
}

func (r *noteRepo) ByID(ctx context.Context, userID, id int64) (*domain.Note, error) {
	n := new(domain.Note)
	err := r.db.NewSelect().Model(n).Where("id = ? AND user_id = ?", id, userID).Scan(ctx)
	return n, mapErr(err)
}

func (r *noteRepo) DetachProject(ctx context.Context, userID, projectID int64) error {
	_, err := r.db.NewUpdate().Model((*domain.Note)(nil)).
		Set("project_id = NULL").
		Where("user_id = ? AND project_id = ?", userID, projectID).Exec(ctx)
	return err
}

func (r *noteRepo) DeleteForProject(ctx context.Context, userID, projectID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Note)(nil)).
		Where("user_id = ? AND project_id = ?", userID, projectID).Exec(ctx)
	return err
}

func (r *noteRepo) DeleteForUser(ctx context.Context, userID int64) error {
	_, err := r.db.NewDelete().Model((*domain.Note)(nil)).
		Where("user_id = ?", userID).Exec(ctx)
	return err
}

func (r *noteRepo) List(ctx context.Context, userID int64, projectID *int64) ([]*domain.Note, error) {
	ns := []*domain.Note{}
	q := r.db.NewSelect().Model(&ns).Where("user_id = ?", userID)
	if projectID != nil {
		q = q.Where("project_id = ?", *projectID)
	}
	err := q.Order("created_at DESC", "id DESC").Scan(ctx)
	return ns, err
}

func (r *todoRepo) CountForUser(ctx context.Context, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.Todo)(nil)).
		Where("user_id = ?", userID).Count(ctx)
}

func (r *projectRepo) CountForUser(ctx context.Context, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.Project)(nil)).
		Where("user_id = ?", userID).Count(ctx)
}

func (r *noteRepo) CountForUser(ctx context.Context, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.Note)(nil)).
		Where("user_id = ?", userID).Count(ctx)
}

func (r *contextRepo) CountForUser(ctx context.Context, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.Context)(nil)).
		Where("user_id = ?", userID).Count(ctx)
}

func (r *tagRepo) CountForUser(ctx context.Context, userID int64) (int, error) {
	return r.db.NewSelect().Model((*domain.Tag)(nil)).
		Where("user_id = ?", userID).Count(ctx)
}
