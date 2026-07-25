package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// ErrValidation indicates invalid user input.
var ErrValidation = errors.New("validation error")

// ErrContextInUse is returned when deleting a context that still holds actions.
var ErrContextInUse = errors.New("context still holds actions")

// ContextInUseError reports how much a non-empty context holds, so the caller
// can tell the user exactly what a forced delete would destroy.
//
// It satisfies errors.Is(err, ErrContextInUse), so handlers that only care
// about the kind of failure keep working unchanged.
type ContextInUseError struct {
	Todos     int
	Recurring int
}

func (e *ContextInUseError) Error() string { return ErrContextInUse.Error() }

func (e *ContextInUseError) Is(target error) bool { return target == ErrContextInUse }

// ContextService manages GTD contexts for a user.
type ContextService struct {
	contexts  repo.ContextRepo
	todos     repo.TodoRepo
	recurring repo.RecurringTodoRepo
	// todoSvc is set separately to avoid a construction cycle. It is only
	// needed to cascade a forced delete, which must go through the todo
	// service so tags and attachment files go with the action.
	todoSvc *TodoService
	quotas  *QuotaService
}

// SetQuotas enables the per-account context limit.
func (s *ContextService) SetQuotas(q *QuotaService) { s.quotas = q }

// NewContextService builds a ContextService.
func NewContextService(
	contexts repo.ContextRepo,
	todos repo.TodoRepo,
	recurring repo.RecurringTodoRepo,
) *ContextService {
	return &ContextService{contexts: contexts, todos: todos, recurring: recurring}
}

// SetTodos wires the todo service used to cascade a forced delete.
func (s *ContextService) SetTodos(t *TodoService) { s.todoSvc = t }

// List returns all contexts for the user, ordered by position.
func (s *ContextService) List(ctx context.Context, userID int64) ([]*domain.Context, error) {
	return s.contexts.List(ctx, userID)
}

// Get returns one context owned by the user.
func (s *ContextService) Get(ctx context.Context, userID, id int64) (*domain.Context, error) {
	return s.contexts.ByID(ctx, userID, id)
}

// Create adds a new context, appended at the end. The allowance check and the
// insert run under the account guard so concurrent creates cannot both pass it.
func (s *ContextService) Create(ctx context.Context, userID int64, name, state string) (*domain.Context, error) {
	name = strings.TrimSpace(name)
	if err := validateName(name); err != nil {
		return nil, ErrValidation
	}
	if state == "" {
		state = domain.StateActive
	}
	if !validContextState(state) {
		return nil, ErrValidation
	}
	c := &domain.Context{UserID: userID, Name: name, State: state}
	err := s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		if err := s.quotas.CheckContext(ctx, userID); err != nil {
			return err
		}
		max, err := s.contexts.MaxPosition(ctx, userID)
		if err != nil {
			return err
		}
		now := time.Now()
		c.Position = max + 1
		c.CreatedAt = now
		c.UpdatedAt = now
		return s.contexts.Create(ctx, c)
	})
	if err != nil {
		return nil, err
	}
	return c, nil
}

// Update changes a context's name/state/position.
func (s *ContextService) Update(ctx context.Context, userID, id int64, name, state string, position *int) (*domain.Context, error) {
	c, err := s.contexts.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if name != "" {
		name = strings.TrimSpace(name)
		if err := validateName(name); err != nil {
			return nil, err
		}
		c.Name = name
	}
	if state != "" {
		if !validContextState(state) {
			return nil, ErrValidation
		}
		c.State = state
	}
	if position != nil {
		c.Position = *position
	}
	c.UpdatedAt = time.Now()
	if err := s.contexts.Update(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

// Delete removes a context owned by the user.
//
// A todo's context is mandatory and every create/update checks that it exists,
// so deleting a context that still holds actions would manufacture exactly the
// state the rest of the service refuses: actions pointing at nothing, missing
// from every context-grouped view.
//
// Without force, a non-empty context is therefore refused, and the returned
// *ContextInUseError carries the counts so the caller can say what would be
// lost. With force, the actions and recurring patterns go too — the caller is
// expected to have confirmed that with the user first, because it is not
// recoverable.
func (s *ContextService) Delete(ctx context.Context, userID, id int64, force bool) error {
	if _, err := s.contexts.ByID(ctx, userID, id); err != nil {
		return err
	}
	todos, err := s.todos.CountInContext(ctx, userID, id)
	if err != nil {
		return err
	}
	recurring, err := s.recurring.CountInContext(ctx, userID, id)
	if err != nil {
		return err
	}
	if todos > 0 || recurring > 0 {
		if !force {
			return &ContextInUseError{Todos: todos, Recurring: recurring}
		}
		if err := s.purge(ctx, userID, id); err != nil {
			return err
		}
	}
	return s.contexts.Delete(ctx, userID, id)
}

// Usage reports what a context holds, for a caller about to offer a delete.
func (s *ContextService) Usage(ctx context.Context, userID, id int64) (todos, recurring int, err error) {
	if _, err := s.contexts.ByID(ctx, userID, id); err != nil {
		return 0, 0, err
	}
	if todos, err = s.todos.CountInContext(ctx, userID, id); err != nil {
		return 0, 0, err
	}
	if recurring, err = s.recurring.CountInContext(ctx, userID, id); err != nil {
		return 0, 0, err
	}
	return todos, recurring, nil
}

// purge deletes everything anchored to a context.
//
// Actions are removed one at a time through the todo service rather than with a
// bulk statement, so each one takes its tags and attachment files
// with it. A personal context holds few enough actions for that to be cheap,
// and it means this path cannot drift out of step with single-action delete.
func (s *ContextService) purge(ctx context.Context, userID, contextID int64) error {
	if s.todoSvc == nil {
		return ErrContextInUse
	}
	todos, err := s.todos.List(ctx, userID, repo.TodoFilter{ContextID: &contextID})
	if err != nil {
		return err
	}
	for _, t := range todos {
		if err := s.todoSvc.Delete(ctx, userID, t.ID); err != nil {
			return err
		}
	}
	return s.recurring.DeleteForContext(ctx, userID, contextID)
}

func validContextState(state string) bool {
	switch state {
	case domain.StateActive, domain.StateHidden:
		return true
	}
	return false
}
