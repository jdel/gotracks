package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func intPtr(n int) *int { return &n }

// A daily pattern spawns exactly one open todo, not one per sweep.
func TestSweepSpawnsOneInstanceOnly(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()
	now := time.Now()

	start := now.AddDate(0, 0, -1)
	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("water the plants"),
		Period:      strPtr(domain.PeriodDaily),
		EveryN:      intPtr(1),
		StartFrom:   &start,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Repeated sweeps must not pile up duplicates.
	for i := 0; i < 3; i++ {
		if err := rec.Sweep(ctx, 1, now); err != nil {
			t.Fatalf("sweep: %v", err)
		}
	}
	todos, err := todoSvc.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(todos) != 1 {
		t.Fatalf("want exactly 1 spawned todo, got %d", len(todos))
	}
	if todos[0].RecurringTodoID == nil {
		t.Fatal("spawned todo should link back to its pattern")
	}
}

// Completing a recurring instance schedules the following one.
func TestCompletingRecurringSpawnsNext(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()
	now := time.Now()
	start := now.AddDate(0, 0, -1)

	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("daily standup"),
		Period:      strPtr(domain.PeriodDaily),
		EveryN:      intPtr(1),
		StartFrom:   &start,
	}); err != nil {
		t.Fatal(err)
	}

	todos, err := todoSvc.List(ctx, 1, repo.TodoFilter{})
	if err != nil || len(todos) != 1 {
		t.Fatalf("setup: err=%v len=%d", err, len(todos))
	}
	first := todos[0]

	if _, err := todoSvc.Complete(ctx, 1, first.ID); err != nil {
		t.Fatalf("complete: %v", err)
	}

	all, err := todoSvc.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("want the completed todo plus a freshly spawned one, got %d", len(all))
	}
	var open int
	for _, td := range all {
		if td.State != domain.StateCompleted {
			open++
		}
	}
	if open != 1 {
		t.Fatalf("want 1 open instance after completing, got %d", open)
	}
}

// A pattern past its end date stops spawning and marks itself completed.
func TestExhaustedPatternCompletes(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()
	now := time.Now()

	start := now.AddDate(0, 0, -10)
	end := now.AddDate(0, 0, -5)
	created, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("expired chore"),
		Period:      strPtr(domain.PeriodDaily),
		EveryN:      intPtr(1),
		StartFrom:   &start,
		EndDate:     &end,
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := rec.Sweep(ctx, 1, now); err != nil {
		t.Fatal(err)
	}
	after, err := rec.Get(ctx, 1, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.State != domain.StateCompleted {
		t.Fatalf("want exhausted pattern completed, got %q", after.State)
	}
}
