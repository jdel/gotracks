package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// A recurring occurrence still in the tickler (deferred, future show-from) must
// not be completable: completing it would spawn the next one, and repeating
// that races the pattern months into the future.
func TestCompletingFutureRecurringOccurrenceIsRejected(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()

	// Starts tomorrow, so the first spawned occurrence is deferred.
	start := time.Now().AddDate(0, 0, 1)
	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("clean"),
		Period:      strPtr(domain.PeriodDaily),
		EveryN:      intPtr(1),
		StartFrom:   &start,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	todos, err := todoSvc.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(todos) != 1 {
		t.Fatalf("want 1 spawned occurrence, got %d", len(todos))
	}
	occ := todos[0]
	if occ.State != domain.StateDeferred {
		t.Fatalf("occurrence should be deferred, got %q", occ.State)
	}

	if _, err := todoSvc.Complete(ctx, 1, occ.ID); !errors.Is(err, service.ErrNotDue) {
		t.Fatalf("want ErrNotDue completing a future occurrence, got %v", err)
	}

	// It must not have raced ahead: still exactly one occurrence, still open.
	todos, err = todoSvc.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(todos) != 1 {
		t.Fatalf("completing a future occurrence spawned extras: now %d", len(todos))
	}
	if todos[0].State == domain.StateCompleted {
		t.Fatal("future occurrence was marked completed despite the guard")
	}
}
