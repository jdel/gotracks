package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// ErrNotDue is returned when a recurring occurrence is completed before its
// show-from date. Completing it early would spawn the following occurrence, and
// repeating that lets a user race arbitrarily far into the future — three
// "completed" months ahead plus an open one, which is not what recurrence means.
var ErrNotDue = errors.New("this occurrence is not due yet")

// TodoService manages actions and their GTD state machine.
type TodoService struct {
	todos       repo.TodoRepo
	tags        repo.TagRepo
	contexts    repo.ContextRepo
	recurring   *RecurringService
	attachments *AttachmentService
	projects    repo.ProjectRepo
	quotas      *QuotaService
	prefs       *PreferenceService
}

// SetQuotas enables per-account limits. Nil leaves them unenforced, which is
// what the tests that build a service directly rely on.
func (s *TodoService) SetQuotas(q *QuotaService) { s.quotas = q }

// SetAttachments wires the attachment service so deleting a todo also removes
// its files. Set separately to avoid a construction cycle between the two.
func (s *TodoService) SetAttachments(a *AttachmentService) { s.attachments = a }

// SetPreferences wires user preferences so completing a todo can honour the
// auto-delete-attachments setting. Set separately to avoid a construction
// cycle; nil leaves auto-delete off.
func (s *TodoService) SetPreferences(p *PreferenceService) { s.prefs = p }

// NewTodoService builds a TodoService. recurring may be nil in tests that do
// not exercise recurrence.
func NewTodoService(
	todos repo.TodoRepo,
	tags repo.TagRepo,
	contexts repo.ContextRepo,
	recurring *RecurringService,
) *TodoService {
	return &TodoService{todos: todos, tags: tags, contexts: contexts, recurring: recurring}
}

// SetProjects wires the project repo so "#project" names can be resolved and
// created. Set separately to keep the constructor signature stable.
func (s *TodoService) SetProjects(p repo.ProjectRepo) { s.projects = p }

// applyNames resolves any name-based context/project on the input into ids,
// creating what does not exist. Explicit ids always win over names.
func (s *TodoService) applyNames(ctx context.Context, userID int64, in *TodoInput) error {
	resolver := nameResolver{contexts: s.contexts, projects: s.projects, quotas: s.quotas}
	projectName := in.ProjectName
	if in.ClearProject {
		projectName = nil
	}
	return resolver.Apply(ctx, userID, &in.ContextID, in.ContextName, &in.ProjectID, projectName)
}

// TodoInput carries create/update fields. Nil pointers mean "leave unchanged".
type TodoInput struct {
	ContextID *int64
	ProjectID *int64
	// ContextName / ProjectName let a client name a context or project instead of
	// supplying an id. An unknown name is created on the fly, which is what makes
	// "@newcontext" and "#newproject" work in the quick-add composer.
	ContextName   *string
	ProjectName   *string
	ClearProject  bool
	Description   *string
	Notes         *string
	Due           *time.Time
	ClearDue      bool
	ShowFrom      *time.Time
	ClearShowFrom bool
	Starred       *bool
	Tags          []string
	HasTags       bool
}

// List returns todos matching the filter, with tags populated.
// Deferred todos whose show_from has passed are activated first (tickler).
func (s *TodoService) List(ctx context.Context, userID int64, f repo.TodoFilter) ([]*domain.Todo, error) {
	now := time.Now()
	// Materialize any recurrences that have come due before listing.
	if s.recurring != nil {
		if err := s.recurring.Sweep(ctx, userID, now); err != nil {
			return nil, err
		}
	}
	if err := s.todos.ActivateDue(ctx, userID, now); err != nil {
		return nil, err
	}
	todos, err := s.todos.List(ctx, userID, f)
	if err != nil {
		return nil, err
	}
	return todos, s.attachTags(ctx, userID, todos)
}

// Get returns one todo with its tags.
func (s *TodoService) Get(ctx context.Context, userID, id int64) (*domain.Todo, error) {
	t, err := s.todos.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return t, s.attachTags(ctx, userID, []*domain.Todo{t})
}

// Create adds a new action. A future show_from defers it (tickler).
//
// The quota-bounded work runs under the account guard: the action allowance,
// the tag allowance and any context or project created from a name are all
// check-then-insert, so concurrent creates would otherwise each pass and all
// insert.
func (s *TodoService) Create(ctx context.Context, userID int64, in TodoInput) (*domain.Todo, error) {
	if err := validateTodoInput(in, true); err != nil {
		return nil, ErrValidation
	}
	var t *domain.Todo
	err := s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		var err error
		t, err = s.create(ctx, userID, in)
		return err
	})
	if err != nil {
		return nil, err
	}
	return t, nil
}

func (s *TodoService) create(ctx context.Context, userID int64, in TodoInput) (*domain.Todo, error) {
	// Names are resolved (and created) before the id is required.
	if err := s.applyNames(ctx, userID, &in); err != nil {
		return nil, err
	}
	if in.ContextID == nil {
		return nil, ErrValidation
	}
	// Context must exist and belong to the user.
	if _, err := s.contexts.ByID(ctx, userID, *in.ContextID); err != nil {
		return nil, ErrValidation
	}
	if err := checkProject(ctx, s.projects, userID, in.ProjectID); err != nil {
		return nil, err
	}
	if err := s.quotas.CheckTodo(ctx, userID); err != nil {
		return nil, err
	}
	if in.HasTags {
		if err := s.quotas.CheckTags(ctx, userID, normalizeTags(in.Tags)); err != nil {
			return nil, err
		}
	}

	max, err := s.todos.MaxPosition(ctx, userID, *in.ContextID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	t := &domain.Todo{
		UserID:      userID,
		ContextID:   *in.ContextID,
		ProjectID:   in.ProjectID,
		Description: strings.TrimSpace(*in.Description),
		State:       domain.StateActive,
		Position:    max + 1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if in.Notes != nil {
		t.Notes = *in.Notes
	}
	if in.Due != nil {
		t.Due = in.Due
	}
	if in.ShowFrom != nil {
		t.ShowFrom = in.ShowFrom
		if in.ShowFrom.After(now) {
			t.State = domain.StateDeferred
		}
	}
	if in.Starred != nil {
		t.Starred = *in.Starred
	}

	if err := s.todos.Create(ctx, t); err != nil {
		return nil, err
	}
	if in.HasTags {
		if err := s.tags.SetForTodo(ctx, userID, t.ID, normalizeTags(in.Tags)); err != nil {
			return nil, err
		}
		t.Tags = normalizeTags(in.Tags)
	}
	return t, nil
}

// Update applies a partial change to a todo. It runs under the account guard
// for the same reason Create does: it can create tags, contexts and projects.
func (s *TodoService) Update(ctx context.Context, userID, id int64, in TodoInput) (*domain.Todo, error) {
	if err := validateTodoInput(in, false); err != nil {
		return nil, err
	}
	var t *domain.Todo
	err := s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		var err error
		t, err = s.update(ctx, userID, id, in)
		return err
	})
	if err != nil {
		return nil, err
	}
	return t, nil
}

func (s *TodoService) update(ctx context.Context, userID, id int64, in TodoInput) (*domain.Todo, error) {
	t, err := s.todos.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if err := s.applyNames(ctx, userID, &in); err != nil {
		return nil, err
	}

	if in.ContextID != nil {
		if _, err := s.contexts.ByID(ctx, userID, *in.ContextID); err != nil {
			return nil, ErrValidation
		}
		t.ContextID = *in.ContextID
	}
	if in.ClearProject {
		t.ProjectID = nil
	} else if in.ProjectID != nil {
		if err := checkProject(ctx, s.projects, userID, in.ProjectID); err != nil {
			return nil, err
		}
		t.ProjectID = in.ProjectID
	}
	if in.HasTags {
		if err := s.quotas.CheckTags(ctx, userID, normalizeTags(in.Tags)); err != nil {
			return nil, err
		}
	}
	if in.Description != nil {
		if strings.TrimSpace(*in.Description) == "" {
			return nil, ErrValidation
		}
		t.Description = strings.TrimSpace(*in.Description)
	}
	if in.Notes != nil {
		t.Notes = *in.Notes
	}
	if in.ClearDue {
		t.Due = nil
	} else if in.Due != nil {
		t.Due = in.Due
	}
	if in.ClearShowFrom {
		t.ShowFrom = nil
		if t.State == domain.StateDeferred {
			t.State = domain.StateActive
		}
	} else if in.ShowFrom != nil {
		t.ShowFrom = in.ShowFrom
		// Only a not-yet-completed todo can be deferred.
		if t.State != domain.StateCompleted {
			if in.ShowFrom.After(time.Now()) {
				t.State = domain.StateDeferred
			} else {
				t.State = domain.StateActive
			}
		}
	}
	if in.Starred != nil {
		t.Starred = *in.Starred
	}
	t.UpdatedAt = time.Now()

	if err := s.todos.Update(ctx, t); err != nil {
		return nil, err
	}
	if in.HasTags {
		names := normalizeTags(in.Tags)
		if err := s.tags.SetForTodo(ctx, userID, t.ID, names); err != nil {
			return nil, err
		}
		t.Tags = names
		return t, nil
	}
	return t, s.attachTags(ctx, userID, []*domain.Todo{t})
}

// Complete marks a todo done.
func (s *TodoService) Complete(ctx context.Context, userID, id int64) (*domain.Todo, error) {
	t, err := s.todos.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	// A recurring occurrence still sitting in the tickler (deferred, show-from in
	// the future) must not be completed: doing so spawns the next one, and
	// repeating it races the pattern months ahead. It becomes completable once
	// its show-from arrives and ActivateDue promotes it to active.
	if t.RecurringTodoID != nil && t.State == domain.StateDeferred &&
		t.ShowFrom != nil && t.ShowFrom.After(now) {
		return nil, ErrNotDue
	}
	t.State = domain.StateCompleted
	t.CompletedAt = &now
	t.UpdatedAt = now
	if err := s.todos.Update(ctx, t); err != nil {
		return nil, err
	}

	// Auto-delete is opt-in: without it, a client is expected to prompt the
	// user instead, which is why this only acts and never reports what it
	// found — a client that wants to prompt reads the attachments itself.
	if s.attachments != nil && s.prefs != nil {
		if pref, err := s.prefs.Get(ctx, userID); err == nil && pref.AutoDelete() {
			if err := s.attachments.DeleteForTodo(ctx, userID, t.ID); err != nil {
				return nil, err
			}
		}
	}

	// Completing a recurring instance schedules the next one.
	if t.RecurringTodoID != nil && s.recurring != nil {
		if err := s.recurring.SpawnNext(ctx, userID, *t.RecurringTodoID, now); err != nil {
			return nil, err
		}
	}
	return t, s.attachTags(ctx, userID, []*domain.Todo{t})
}

// Reactivate reopens a completed todo.
func (s *TodoService) Reactivate(ctx context.Context, userID, id int64) (*domain.Todo, error) {
	t, err := s.todos.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	t.CompletedAt = nil
	t.UpdatedAt = now
	// A future show_from sends it back to the tickler rather than the active list.
	if t.ShowFrom != nil && t.ShowFrom.After(now) {
		t.State = domain.StateDeferred
	} else {
		t.State = domain.StateActive
	}
	if err := s.todos.Update(ctx, t); err != nil {
		return nil, err
	}
	return t, s.attachTags(ctx, userID, []*domain.Todo{t})
}

// Delete removes a todo along with its taggings and dependency links.
func (s *TodoService) Delete(ctx context.Context, userID, id int64) error {
	if err := s.tags.DeleteForTodo(ctx, userID, id); err != nil {
		return err
	}
	if s.attachments != nil {
		if err := s.attachments.DeleteForTodo(ctx, userID, id); err != nil {
			return err
		}
	}
	return s.todos.Delete(ctx, userID, id)
}

// Reorder moves a todo to a new position within its context.
func (s *TodoService) Reorder(ctx context.Context, userID, id int64, position int) (*domain.Todo, error) {
	t, err := s.todos.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if position < 0 {
		return nil, ErrValidation
	}
	t.Position = position
	t.UpdatedAt = time.Now()
	if err := s.todos.Update(ctx, t); err != nil {
		return nil, err
	}
	return t, s.attachTags(ctx, userID, []*domain.Todo{t})
}

// attachTags fills the Tags field of the given todos.
func (s *TodoService) attachTags(ctx context.Context, userID int64, todos []*domain.Todo) error {
	ids := make([]int64, 0, len(todos))
	for _, t := range todos {
		ids = append(ids, t.ID)
	}
	byTodo, err := s.tags.ForTodos(ctx, userID, ids)
	if err != nil {
		return err
	}
	for _, t := range todos {
		if names, ok := byTodo[t.ID]; ok {
			t.Tags = names
		} else {
			t.Tags = []string{}
		}
	}
	return nil
}

// normalizeTags trims, lowercases and de-duplicates tag names.
func normalizeTags(names []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(names))
	for _, n := range names {
		n = strings.ToLower(strings.TrimSpace(n))
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

func validateTodoInput(in TodoInput, creating bool) error {
	if creating && in.Description == nil {
		return ErrValidation
	}
	if in.Description != nil {
		if err := validateRequired(*in.Description, MaxDescriptionCharacters); err != nil {
			return err
		}
	}
	if err := validateOptional(in.Notes, MaxNotesCharacters); err != nil {
		return err
	}
	for _, name := range normalizeTags(in.Tags) {
		if err := validateName(name); err != nil {
			return err
		}
	}
	return nil
}
