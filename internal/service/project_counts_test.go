package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/service"
)

// The project card draws a progress meter, so the list has to report done and
// total alongside open — and total means every action filed under the project,
// not just the ones still to do.
func TestProjectListReportsOpenDoneAndTotal(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	projects := service.NewProjectService(
		store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts,
	)

	shed, err := projects.Create(ctx, 1, service.ProjectInput{Name: strPtr("Repaint the shed")})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	taxes, err := projects.Create(ctx, 1, service.ProjectInput{Name: strPtr("File the taxes")})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	// A project with nothing in it must not claim any progress.
	empty, err := projects.Create(ctx, 1, service.ProjectInput{Name: strPtr("Someday")})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	add := func(projectID int64, description string, in service.TodoInput) int64 {
		t.Helper()
		in.ContextID = &ctxID
		in.ProjectID = &projectID
		in.Description = &description
		todo, err := todoSvc.Create(ctx, 1, in)
		if err != nil {
			t.Fatalf("create todo %q: %v", description, err)
		}
		return todo.ID
	}

	// The shed: one active, one deferred, one completed.
	add(shed.ID, "buy paint", service.TodoInput{})
	later := time.Now().Add(48 * time.Hour)
	add(shed.ID, "sand the door", service.TodoInput{ShowFrom: &later})
	done := add(shed.ID, "measure the wall", service.TodoInput{})
	if _, err := todoSvc.Complete(ctx, 1, done); err != nil {
		t.Fatalf("complete todo: %v", err)
	}

	add(taxes.ID, "find receipts", service.TodoInput{})

	list, err := projects.List(ctx, 1, "")
	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	got := map[int64]*service.ProjectWithCount{}
	for _, p := range list {
		got[p.ID] = p
	}

	// Open stays "active" alone; the deferred action counts only in the total.
	assertCounts(t, "shed", got[shed.ID], 1, 1, 3)
	assertCounts(t, "taxes", got[taxes.ID], 1, 0, 1)
	assertCounts(t, "empty", got[empty.ID], 0, 0, 0)
}

// Counts belong to one account: another user's actions must never reach them.
func TestProjectListCountsAreScopedToTheOwner(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	projects := service.NewProjectService(
		store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts,
	)

	mine, err := projects.Create(ctx, 1, service.ProjectInput{Name: strPtr("Mine")})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	description := "buy paint"
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, ProjectID: &mine.ID, Description: &description,
	}); err != nil {
		t.Fatalf("create todo: %v", err)
	}

	// A second account's project of the same shape sees none of it.
	theirs, err := projects.Create(ctx, 2, service.ProjectInput{Name: strPtr("Theirs")})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	list, err := projects.List(ctx, 2, "")
	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	for _, p := range list {
		if p.ID == theirs.ID {
			assertCounts(t, "theirs", p, 0, 0, 0)
		}
	}
}

func assertCounts(t *testing.T, name string, p *service.ProjectWithCount, open, done, total int) {
	t.Helper()
	if p == nil {
		t.Fatalf("%s: missing from the list", name)
	}
	if p.OpenCount != open {
		t.Errorf("%s: OpenCount = %d, want %d", name, p.OpenCount, open)
	}
	if p.DoneCount != done {
		t.Errorf("%s: DoneCount = %d, want %d", name, p.DoneCount, done)
	}
	if p.TotalCount != total {
		t.Errorf("%s: TotalCount = %d, want %d", name, p.TotalCount, total)
	}
}
