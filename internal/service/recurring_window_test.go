package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// A window that closes before it opens can never produce an occurrence, so it
// is refused rather than stored as a rule that does nothing. The form checks
// this too, so the dates never snap back after a round-trip — but a client is
// not a place to enforce anything.
func TestCreateRefusesEndBeforeStart(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()

	start := time.Now().AddDate(0, 1, 0)
	end := time.Now()
	_, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("water the plants"),
		Period:      strPtr(domain.PeriodDaily),
		StartFrom:   &start,
		EndDate:     &end,
	})
	if !errors.Is(err, service.ErrValidation) {
		t.Fatalf("want ErrValidation, got %v", err)
	}
}

// The same check on update has to run against the merged pattern: moving one
// end alone can invert a window whose other end was already stored.
func TestUpdateRefusesEndBeforeStoredStart(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()

	start := time.Now().AddDate(0, 1, 0)
	pattern, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("water the plants"),
		Period:      strPtr(domain.PeriodDaily),
		StartFrom:   &start,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Only the end date is sent; the start it must not precede is the stored one.
	end := time.Now()
	if _, err := rec.Update(ctx, 1, pattern.ID, service.RecurringInput{EndDate: &end}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("want ErrValidation, got %v", err)
	}

	later := start.AddDate(0, 1, 0)
	if _, err := rec.Update(ctx, 1, pattern.ID, service.RecurringInput{EndDate: &later}); err != nil {
		t.Fatalf("a window that closes after it opens should be accepted: %v", err)
	}
}

// Detaching a pattern from its project needs saying out loud: a nil ProjectID
// is also what "leave this alone" looks like, so without ClearProject a pattern
// could be moved between projects but never out of one.
func TestUpdateClearsProject(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()

	project := &domain.Project{UserID: 1, Name: "garden", Position: 1, State: domain.StateActive}
	if err := store.Projects.Create(ctx, project); err != nil {
		t.Fatal(err)
	}
	rec.SetProjects(store.Projects)

	pattern, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		ProjectID:   &project.ID,
		Description: strPtr("mow the lawn"),
		Period:      strPtr(domain.PeriodWeekly),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if pattern.ProjectID == nil {
		t.Fatal("pattern should have been created inside the project")
	}

	// Sending nothing leaves it where it is …
	updated, err := rec.Update(ctx, 1, pattern.ID, service.RecurringInput{Description: strPtr("mow the lawn again")})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.ProjectID == nil {
		t.Fatal("an update that says nothing about the project must not detach it")
	}

	// … and only ClearProject takes it out.
	updated, err = rec.Update(ctx, 1, pattern.ID, service.RecurringInput{ClearProject: true})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.ProjectID != nil {
		t.Fatalf("want the pattern detached, still in project %d", *updated.ProjectID)
	}
}
