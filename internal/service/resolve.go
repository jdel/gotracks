package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// nameResolver turns a context or project *name* into an id, creating the record
// when it does not exist. Shared by todos and recurring patterns so "@context"
// and "#project" behave identically wherever they are typed.
type nameResolver struct {
	contexts repo.ContextRepo
	projects repo.ProjectRepo
}

// checkProject verifies that an explicitly supplied project id exists and
// belongs to the user, mirroring the check every caller already does for
// contexts. A nil id (or an unwired repo, as in tests) is accepted.
func checkProject(ctx context.Context, projects repo.ProjectRepo, userID int64, id *int64) error {
	if id == nil || projects == nil {
		return nil
	}
	if _, err := projects.ByID(ctx, userID, *id); err != nil {
		return ErrValidation
	}
	return nil
}

// Context returns the id of the named context, creating it if needed.
func (r nameResolver) Context(ctx context.Context, userID int64, name string) (int64, error) {
	// The composer sigil is not part of the name: store it bare, exactly as the
	// manual "add context" form does (and mirroring how Project strips "#").
	name = strings.TrimPrefix(strings.TrimSpace(name), "@")
	if name == "" || r.contexts == nil {
		return 0, ErrValidation
	}
	if existing, err := r.contexts.ByName(ctx, userID, name); err == nil {
		return existing.ID, nil
	} else if !errors.Is(err, repo.ErrNotFound) {
		return 0, err
	}

	max, err := r.contexts.MaxPosition(ctx, userID)
	if err != nil {
		return 0, err
	}
	now := time.Now()
	c := &domain.Context{
		UserID:    userID,
		Name:      name,
		Position:  max + 1,
		State:     domain.StateActive,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := r.contexts.Create(ctx, c); err != nil {
		return 0, err
	}
	return c.ID, nil
}

// Project returns the id of the named project, creating it if needed.
func (r nameResolver) Project(ctx context.Context, userID int64, name string) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" || r.projects == nil {
		return 0, ErrValidation
	}
	if existing, err := r.projects.ByName(ctx, userID, name); err == nil {
		return existing.ID, nil
	} else if !errors.Is(err, repo.ErrNotFound) {
		return 0, err
	}

	max, err := r.projects.MaxPosition(ctx, userID)
	if err != nil {
		return 0, err
	}
	now := time.Now()
	// Projects keep the name as typed; "#" is only composer syntax.
	p := &domain.Project{
		UserID:    userID,
		Name:      strings.TrimPrefix(name, "#"),
		State:     domain.StateActive,
		Position:  max + 1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := r.projects.Create(ctx, p); err != nil {
		return 0, err
	}
	return p.ID, nil
}

// Apply fills in ids from names, leaving an explicitly supplied id untouched.
func (r nameResolver) Apply(
	ctx context.Context,
	userID int64,
	contextID **int64, contextName *string,
	projectID **int64, projectName *string,
) error {
	if *contextID == nil && contextName != nil {
		id, err := r.Context(ctx, userID, *contextName)
		if err != nil {
			return err
		}
		*contextID = &id
	}
	if *projectID == nil && projectName != nil {
		id, err := r.Project(ctx, userID, *projectName)
		if err != nil {
			return err
		}
		*projectID = &id
	}
	return nil
}
