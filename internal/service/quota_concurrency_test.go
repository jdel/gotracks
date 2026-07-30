package service_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// Every quota is check-then-insert. Without per-account serialization each of
// these requests reads the same usage, all of them find room, and the account
// ends up over its limit by however many were in flight — which is the whole
// point of a limit on a public instance. Each test starts its requests together
// so they overlap, and asserts the stored count, not the number of errors.

// racers is the number of simultaneous requests each test fires. Enough to
// overlap reliably, small enough to stay fast.
const racers = 8

// startTogether runs fn racers times, released at the same moment, and returns
// their errors.
func startTogether(fn func(i int) error) []error {
	var (
		wg    sync.WaitGroup
		start = make(chan struct{})
		errs  = make([]error, racers)
	)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			errs[i] = fn(i)
		}(i)
	}
	close(start)
	wg.Wait()
	return errs
}

// quotaErrorsOnly fails the test on any error that is not a refused quota.
func quotaErrorsOnly(t *testing.T, errs []error) {
	t.Helper()
	for _, err := range errs {
		if err != nil && !errors.Is(err, service.ErrQuotaExceeded) {
			t.Fatalf("unexpected failure: %v", err)
		}
	}
}

func TestConcurrentTodoCreatesRespectTheQuota(t *testing.T) {
	const limit = 3
	todoSvc, _, store, ctxID := quotaFixture(t, service.Quotas{Todos: limit})
	ctx := context.Background()

	errs := startTogether(func(i int) error {
		_, err := todoSvc.Create(ctx, 1, service.TodoInput{
			ContextID:   &ctxID,
			Description: strPtr(fmt.Sprintf("racer %d", i)),
		})
		return err
	})
	quotaErrorsOnly(t, errs)

	count, err := store.Todos.CountForUser(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if count != limit {
		t.Fatalf("stored %d actions for a limit of %d", count, limit)
	}
}

// Contexts and projects are also created implicitly from "@name" and "#name" on
// an action, which is the path that bypasses a handler-level check entirely.
func TestConcurrentImplicitContextCreatesRespectTheQuota(t *testing.T) {
	const limit = 2
	todoSvc, _, store, _ := quotaFixture(t, service.Quotas{Contexts: limit})
	ctx := context.Background()

	// The fixture already owns one context, so only one more fits.
	errs := startTogether(func(i int) error {
		name := fmt.Sprintf("@ctx-%d", i)
		_, err := todoSvc.Create(ctx, 1, service.TodoInput{
			ContextName: &name,
			Description: strPtr("implicit context"),
		})
		return err
	})
	quotaErrorsOnly(t, errs)

	count, err := store.Contexts.CountForUser(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if count != limit {
		t.Fatalf("stored %d contexts for a limit of %d", count, limit)
	}
}

func TestConcurrentProjectCreatesRespectTheQuota(t *testing.T) {
	const limit = 3
	_, quotas, store, _ := quotaFixture(t, service.Quotas{Projects: limit})
	ctx := context.Background()

	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
	projects.SetQuotas(quotas)

	errs := startTogether(func(i int) error {
		name := fmt.Sprintf("project %d", i)
		_, err := projects.Create(ctx, 1, service.ProjectInput{Name: &name})
		return err
	})
	quotaErrorsOnly(t, errs)

	count, err := store.Projects.CountForUser(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if count != limit {
		t.Fatalf("stored %d projects for a limit of %d", count, limit)
	}
}

// The storage quota counts bytes rather than rows, so concurrent uploads
// overshoot it by the sum of the files in flight rather than by one row each.
func TestConcurrentUploadsRespectTheStorageQuota(t *testing.T) {
	const (
		fileBytes = 100
		limit     = 250 // room for two files, not three
	)
	todoSvc, quotas, store, ctxID := quotaFixture(t, service.Quotas{StorageBytes: limit})
	ctx := context.Background()

	attachments := service.NewAttachmentService(store.Attachments, store.Todos, testStore(t), 1<<20)
	attachments.SetQuotas(quotas)

	todo, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("holds the files"),
	})
	if err != nil {
		t.Fatal(err)
	}

	errs := startTogether(func(i int) error {
		body := strings.NewReader(strings.Repeat("x", fileBytes))
		_, err := attachments.Save(ctx, 1, todo.ID, fmt.Sprintf("f%d.txt", i), "text/plain", body)
		return err
	})
	quotaErrorsOnly(t, errs)

	stored, err := store.Attachments.TotalBytesForUser(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if stored > limit {
		t.Fatalf("stored %d bytes for a limit of %d", stored, limit)
	}
	if stored != 2*fileBytes {
		t.Fatalf("stored %d bytes, want the %d that fit", stored, 2*fileBytes)
	}
}

// Listing todos sweeps recurrences, so ordinary concurrent list requests are
// enough to spawn the same occurrence several times.
func TestConcurrentSweepsSpawnOneOccurrence(t *testing.T) {
	todoSvc, quotas, store, ctxID := quotaFixture(t, service.Quotas{})
	ctx := context.Background()

	recurring := newRecurringService(t, store)
	recurring.SetQuotas(quotas)
	period := domain.PeriodDaily
	if _, err := recurring.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, Description: strPtr("daily"), Period: &period,
	}); err != nil {
		t.Fatal(err)
	}
	// Creating the pattern spawns its first occurrence, and a sweep does
	// nothing while one is open. Closing it directly, rather than through
	// Complete, leaves the pattern owing exactly one occurrence — the state the
	// racing sweeps compete over.
	closeOpenOccurrences(t, ctx, store)

	errs := startTogether(func(int) error {
		return recurring.Sweep(ctx, 1, time.Now())
	})
	quotaErrorsOnly(t, errs)

	// The list path is the real caller, so exercise it too.
	if _, err := todoSvc.List(ctx, 1, repo.TodoFilter{}); err != nil {
		t.Fatal(err)
	}
	if open := countOpenOccurrences(t, ctx, store); open != 1 {
		t.Fatalf("sweeping left %d open occurrences, want 1", open)
	}
}

func closeOpenOccurrences(t *testing.T, ctx context.Context, store *repo.Store) {
	t.Helper()
	todos, err := store.Todos.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, todo := range todos {
		if todo.RecurringTodoID == nil || todo.State == domain.StateCompleted {
			continue
		}
		todo.State = domain.StateCompleted
		todo.CompletedAt = &now
		if err := store.Todos.Update(ctx, todo); err != nil {
			t.Fatal(err)
		}
	}
}

func countOpenOccurrences(t *testing.T, ctx context.Context, store *repo.Store) int {
	t.Helper()
	todos, err := store.Todos.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	open := 0
	for _, todo := range todos {
		if todo.RecurringTodoID != nil && todo.State != domain.StateCompleted {
			open++
		}
	}
	return open
}
