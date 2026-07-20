package service

import (
	"context"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// ProjectService manages projects.
type ProjectService struct {
	quotas    *QuotaService
	projects  repo.ProjectRepo
	todos     repo.TodoRepo
	notes     repo.NoteRepo
	recurring repo.RecurringTodoRepo
}

// SetQuotas enables the per-account project limit. Nil leaves it unlimited.
func (s *ProjectService) SetQuotas(q *QuotaService) { s.quotas = q }

// NewProjectService builds a ProjectService.
func NewProjectService(
	projects repo.ProjectRepo,
	todos repo.TodoRepo,
	notes repo.NoteRepo,
	recurring repo.RecurringTodoRepo,
) *ProjectService {
	return &ProjectService{projects: projects, todos: todos, notes: notes, recurring: recurring}
}

// ProjectInput carries create/update fields; nil means "leave unchanged".
type ProjectInput struct {
	Name                *string
	Description         *string
	State               *string
	Position            *int
	DefaultContextID    *int64
	ClearDefaultContext bool
}

// ProjectWithCount is a project plus its open-action count.
type ProjectWithCount struct {
	*domain.Project
	OpenCount int `json:"openCount"`
}

// ProjectNotesInUseError is returned when deleting a project whose notes have
// not been told whether to be kept (detached) or removed with it.
type ProjectNotesInUseError struct {
	Notes int
}

func (e *ProjectNotesInUseError) Error() string { return "project has notes" }

// ResolveByName returns the id of the named project, creating it if it does
// not exist yet — the same on-the-fly creation "#project" gets when typed
// into a todo or a recurring pattern.
func (s *ProjectService) ResolveByName(ctx context.Context, userID int64, name string) (int64, error) {
	return nameResolver{projects: s.projects}.Project(ctx, userID, name)
}

// List returns projects (optionally filtered by state) with open-action counts.
func (s *ProjectService) List(ctx context.Context, userID int64, state string) ([]*ProjectWithCount, error) {
	ps, err := s.projects.List(ctx, userID, state)
	if err != nil {
		return nil, err
	}
	counts, err := s.todos.CountByProject(ctx, userID, domain.StateActive)
	if err != nil {
		return nil, err
	}
	out := make([]*ProjectWithCount, 0, len(ps))
	for _, p := range ps {
		out = append(out, &ProjectWithCount{Project: p, OpenCount: counts[p.ID]})
	}
	return out, nil
}

// Get returns one project.
func (s *ProjectService) Get(ctx context.Context, userID, id int64) (*domain.Project, error) {
	return s.projects.ByID(ctx, userID, id)
}

// Create adds a project, appended at the end.
func (s *ProjectService) Create(ctx context.Context, userID int64, in ProjectInput) (*domain.Project, error) {
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" {
		return nil, ErrValidation
	}
	if err := s.quotas.CheckProject(ctx, userID); err != nil {
		return nil, err
	}
	state := domain.StateActive
	if in.State != nil {
		if !validProjectState(*in.State) {
			return nil, ErrValidation
		}
		state = *in.State
	}
	max, err := s.projects.MaxPosition(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	p := &domain.Project{
		UserID:           userID,
		Name:             strings.TrimSpace(*in.Name),
		State:            state,
		Position:         max + 1,
		DefaultContextID: in.DefaultContextID,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if in.Description != nil {
		p.Description = *in.Description
	}
	if state == domain.StateCompleted {
		p.CompletedAt = &now
	}
	if err := s.projects.Create(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// Update applies a partial change to a project.
func (s *ProjectService) Update(ctx context.Context, userID, id int64, in ProjectInput) (*domain.Project, error) {
	p, err := s.projects.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if in.Name != nil {
		if strings.TrimSpace(*in.Name) == "" {
			return nil, ErrValidation
		}
		p.Name = strings.TrimSpace(*in.Name)
	}
	if in.Description != nil {
		p.Description = *in.Description
	}
	if in.State != nil {
		if !validProjectState(*in.State) {
			return nil, ErrValidation
		}
		now := time.Now()
		p.State = *in.State
		if *in.State == domain.StateCompleted {
			p.CompletedAt = &now
		} else {
			p.CompletedAt = nil
		}
	}
	if in.Position != nil {
		p.Position = *in.Position
	}
	if in.ClearDefaultContext {
		p.DefaultContextID = nil
	} else if in.DefaultContextID != nil {
		p.DefaultContextID = in.DefaultContextID
	}
	p.UpdatedAt = time.Now()
	if err := s.projects.Update(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// Review stamps the project as reviewed now.
func (s *ProjectService) Review(ctx context.Context, userID, id int64) (*domain.Project, error) {
	p, err := s.projects.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	p.LastReviewed = &now
	p.UpdatedAt = now
	if err := s.projects.Update(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// Delete removes a project. Its todos and recurrence patterns are always kept
// but detached first: nothing enforces referential integrity in the schema, so
// leaving the project id behind would point them at a row that is gone.
//
// Notes are different: they are GTD reference material, independent of any
// action list, so whether to keep or discard them when their project goes is
// a real decision rather than an obvious default. Without deleteNotes given,
// a project holding notes refuses with *ProjectNotesInUseError so the caller
// can ask; deleteNotes then says which of the two outcomes to apply. A
// project with no notes needs no answer and just deletes.
func (s *ProjectService) Delete(ctx context.Context, userID, id int64, deleteNotes *bool) error {
	if _, err := s.projects.ByID(ctx, userID, id); err != nil {
		return err
	}
	if err := s.todos.DetachProject(ctx, userID, id); err != nil {
		return err
	}
	if err := s.recurring.DetachProject(ctx, userID, id); err != nil {
		return err
	}

	notes, err := s.notes.List(ctx, userID, &id)
	if err != nil {
		return err
	}
	if len(notes) > 0 {
		switch {
		case deleteNotes == nil:
			return &ProjectNotesInUseError{Notes: len(notes)}
		case *deleteNotes:
			if err := s.notes.DeleteForProject(ctx, userID, id); err != nil {
				return err
			}
		default:
			if err := s.notes.DetachProject(ctx, userID, id); err != nil {
				return err
			}
		}
	}
	return s.projects.Delete(ctx, userID, id)
}

func validProjectState(state string) bool {
	switch state {
	case domain.StateActive, domain.StateHidden, domain.StateCompleted:
		return true
	}
	return false
}
