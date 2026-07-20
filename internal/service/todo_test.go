package service_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// newTodoService spins up an in-memory database with one context ready to use.
func newTodoService(t *testing.T) (*service.TodoService, *repo.Store, int64) {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	sqldb.SetMaxOpenConns(1)
	bdb := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { bdb.Close() })

	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatal(err)
	}
	store := repo.NewStore(bdb)

	c := &domain.Context{UserID: 1, Name: "@home", Position: 1, State: domain.StateActive}
	if err := store.Contexts.Create(ctx, c); err != nil {
		t.Fatal(err)
	}
	recurring := service.NewRecurringService(store.Recurring, store.Todos, store.Contexts)
	svc := service.NewTodoService(store.Todos, store.Tags, store.Contexts, recurring)
	return svc, store, c.ID
}

// newRecurringService builds a RecurringService sharing the same store.
func newRecurringService(t *testing.T, store *repo.Store) *service.RecurringService {
	t.Helper()
	return service.NewRecurringService(store.Recurring, store.Todos, store.Contexts)
}

func strPtr(s string) *string { return &s }

func TestCreateWithFutureShowFromIsDeferred(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()
	future := time.Now().Add(48 * time.Hour)

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("renew passport"),
		ShowFrom:    &future,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if todo.State != domain.StateDeferred {
		t.Fatalf("want deferred, got %q", todo.State)
	}
}

func TestPastShowFromStaysActive(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()
	past := time.Now().Add(-48 * time.Hour)

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("already due"),
		ShowFrom:    &past,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if todo.State != domain.StateActive {
		t.Fatalf("want active, got %q", todo.State)
	}
}

// A deferred todo must surface automatically once show_from passes.
func TestTicklerActivatesWhenShowFromPasses(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	future := time.Now().Add(time.Hour)

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("ticklish"),
		ShowFrom:    &future,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if todo.State != domain.StateDeferred {
		t.Fatalf("setup: want deferred, got %q", todo.State)
	}

	// Move show_from into the past, simulating time passing.
	stored, err := store.Todos.ByID(ctx, 1, todo.ID)
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-time.Minute)
	stored.ShowFrom = &past
	if err := store.Todos.Update(ctx, stored); err != nil {
		t.Fatal(err)
	}

	// Listing runs the tickler sweep.
	active, err := svc.List(ctx, 1, repo.TodoFilter{State: domain.StateActive})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("want 1 activated todo, got %d", len(active))
	}
}

func TestCompleteThenReactivate(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("do a thing"),
	})
	if err != nil {
		t.Fatal(err)
	}

	done, err := svc.Complete(ctx, 1, todo.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if done.State != domain.StateCompleted || done.CompletedAt == nil {
		t.Fatalf("want completed with timestamp, got %q %v", done.State, done.CompletedAt)
	}

	again, err := svc.Reactivate(ctx, 1, todo.ID)
	if err != nil {
		t.Fatalf("reactivate: %v", err)
	}
	if again.State != domain.StateActive || again.CompletedAt != nil {
		t.Fatalf("want active with cleared timestamp, got %q %v", again.State, again.CompletedAt)
	}
}

// Reactivating a todo whose show_from is still in the future returns it to the tickler.
func TestReactivateRespectsFutureShowFrom(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()
	future := time.Now().Add(72 * time.Hour)

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("later thing"),
		ShowFrom:    &future,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Complete(ctx, 1, todo.ID); err != nil {
		t.Fatal(err)
	}
	again, err := svc.Reactivate(ctx, 1, todo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != domain.StateDeferred {
		t.Fatalf("want deferred, got %q", again.State)
	}
}

func TestTagsAreNormalizedAndReplaced(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("tagged"),
		Tags:        []string{" Errand ", "URGENT", "errand"},
		HasTags:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(todo.Tags) != 2 {
		t.Fatalf("want 2 deduped tags, got %v", todo.Tags)
	}

	updated, err := svc.Update(ctx, 1, todo.ID, service.TodoInput{
		Tags:    []string{"home"},
		HasTags: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Tags) != 1 || updated.Tags[0] != "home" {
		t.Fatalf("want tags replaced with [home], got %v", updated.Tags)
	}
}

func TestCreateRejectsForeignContext(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()

	// User 2 must not be able to attach a todo to user 1's context.
	if _, err := svc.Create(ctx, 2, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("sneaky"),
	}); err == nil {
		t.Fatal("expected validation error for another user's context")
	}
}
