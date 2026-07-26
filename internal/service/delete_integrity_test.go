package service_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// Nothing in the schema enforces referential integrity, so deleting a project
// has to clear the references itself or its todos point at a row that is gone.
func TestProjectDeleteDetachesTodosAndNotes(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring)

	p, err := projects.Create(ctx, 1, service.ProjectInput{Name: strPtr("Repaint the shed")})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	todo, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, ProjectID: &p.ID, Description: strPtr("buy paint"),
	})
	if err != nil {
		t.Fatalf("create todo: %v", err)
	}
	note := &domain.Note{UserID: 1, ProjectID: &p.ID, Body: "colour: green"}
	if err := store.Notes.Create(ctx, note); err != nil {
		t.Fatalf("create note: %v", err)
	}

	// Nil first: the project has a note, so deletion must refuse until told
	// what to do with it, rather than silently picking a default.
	err = projects.Delete(ctx, 1, p.ID, nil)
	var inUse *service.ProjectNotesInUseError
	if !errors.As(err, &inUse) {
		t.Fatalf("delete project with an undecided note: got %v, want *ProjectNotesInUseError", err)
	}
	if inUse.Notes != 1 {
		t.Errorf("inUse.Notes = %d, want 1", inUse.Notes)
	}

	keep := false
	if err := projects.Delete(ctx, 1, p.ID, &keep); err != nil {
		t.Fatalf("delete project: %v", err)
	}

	gotTodo, err := todoSvc.Get(ctx, 1, todo.ID)
	if err != nil {
		t.Fatalf("todo disappeared with its project: %v", err)
	}
	if gotTodo.ProjectID != nil {
		t.Errorf("todo still references deleted project %d", *gotTodo.ProjectID)
	}
	gotNote, err := store.Notes.ByID(ctx, 1, note.ID)
	if err != nil {
		t.Fatalf("note disappeared with its project: %v", err)
	}
	if gotNote.ProjectID != nil {
		t.Errorf("note still references deleted project %d", *gotNote.ProjectID)
	}
}

// deleteNotes=true is the other branch of the same choice: the note goes with
// the project instead of surviving detached.
func TestProjectDeleteCanRemoveItsNotesInstead(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring)

	p, err := projects.Create(ctx, 1, service.ProjectInput{Name: strPtr("Repaint the shed")})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	note := &domain.Note{UserID: 1, ProjectID: &p.ID, Body: "colour: green"}
	if err := store.Notes.Create(ctx, note); err != nil {
		t.Fatalf("create note: %v", err)
	}

	remove := true
	if err := projects.Delete(ctx, 1, p.ID, &remove); err != nil {
		t.Fatalf("delete project: %v", err)
	}
	if _, err := store.Notes.ByID(ctx, 1, note.ID); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("note should have been deleted with its project, got err=%v", err)
	}
}

// A todo's context is mandatory, so a context holding actions cannot be
// removed without orphaning them.
func TestContextDeleteRefusedWhileInUse(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)

	todo, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("call the plumber"),
	})
	if err != nil {
		t.Fatalf("create todo: %v", err)
	}

	err = contexts.Delete(ctx, 1, ctxID, false)
	if err == nil {
		t.Fatal("deleted a context that still holds actions, orphaning them")
	}
	if !errors.Is(err, service.ErrContextInUse) {
		t.Fatalf("want ErrContextInUse, got %v", err)
	}

	// Once emptied, it goes.
	if err := todoSvc.Delete(ctx, 1, todo.ID); err != nil {
		t.Fatalf("delete todo: %v", err)
	}
	if err := contexts.Delete(ctx, 1, ctxID, false); err != nil {
		t.Fatalf("delete emptied context: %v", err)
	}
	if _, err := store.Contexts.ByID(ctx, 1, ctxID); !errors.Is(err, repo.ErrNotFound) {
		t.Fatalf("context should be gone, got %v", err)
	}
}

// A recurrence pattern spawns into its context, so it pins the context too.
func TestContextDeleteRefusedWhileRecurringUsesIt(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	ctx := context.Background()
	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)
	rec := newRecurringService(t, store)

	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("water the plants"),
		Period:      strPtr(domain.PeriodDaily),
		EveryN:      intPtr(1),
	}); err != nil {
		t.Fatalf("create pattern: %v", err)
	}

	if err := contexts.Delete(ctx, 1, ctxID, false); !errors.Is(err, service.ErrContextInUse) {
		t.Fatalf("want ErrContextInUse while a pattern targets the context, got %v", err)
	}
}

// A forced delete takes the actions with it — including everything hanging off
// them, so no tag links or attachment files are left behind.
func TestContextForceDeleteCascades(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()

	blobs, uploads := testStoreDir(t)
	attachments := service.NewAttachmentService(store.Attachments, store.Todos, blobs, 1<<20)
	todoSvc.SetAttachments(attachments)

	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)
	contexts.SetTodos(todoSvc)

	first, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("call the plumber"),
		Tags: []string{"home"}, HasTags: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("pay the plumber"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := attachments.Save(ctx, 1, first.ID, "quote.txt", "text/plain",
		strings.NewReader("120 euros")); err != nil {
		t.Fatal(err)
	}
	rec := newRecurringService(t, store)
	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, Description: strPtr("water the plants"),
		Period: strPtr(domain.PeriodDaily), EveryN: intPtr(1),
	}); err != nil {
		t.Fatal(err)
	}

	if files, err := os.ReadDir(uploads); err != nil || len(files) != 1 {
		t.Fatalf("setup: want 1 uploaded file, got %d (err %v)", len(files), err)
	}

	if err := contexts.Delete(ctx, 1, ctxID, true); err != nil {
		t.Fatalf("forced delete: %v", err)
	}

	if _, err := store.Contexts.ByID(ctx, 1, ctxID); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("context survived a forced delete: %v", err)
	}
	if todos, err := store.Todos.List(ctx, 1, repo.TodoFilter{}); err != nil {
		t.Error(err)
	} else if len(todos) != 0 {
		t.Errorf("%d actions survived the forced delete", len(todos))
	}
	if n, err := store.Recurring.CountInContext(ctx, 1, ctxID); err != nil {
		t.Error(err)
	} else if n != 0 {
		t.Errorf("%d recurring patterns survived the forced delete", n)
	}
	if tags, err := store.Tags.ForTodos(ctx, 1, []int64{first.ID, second.ID}); err != nil {
		t.Error(err)
	} else if len(tags) != 0 {
		t.Errorf("tag links survived the forced delete: %v", tags)
	}
	// The file on disk is the one thing a bulk SQL delete would have missed.
	if files, err := os.ReadDir(uploads); err != nil {
		t.Error(err)
	} else if len(files) != 0 {
		t.Errorf("%d attachment files left on disk after the forced delete", len(files))
	}
}

// The refusal has to say how much is at stake, or the UI cannot warn anyone.
func TestContextInUseErrorCarriesCounts(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)
	rec := newRecurringService(t, store)

	for _, desc := range []string{"one", "two", "three"} {
		if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
			ContextID: &ctxID, Description: strPtr(desc),
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, Description: strPtr("weekly"),
		Period: strPtr(domain.PeriodDaily), EveryN: intPtr(1),
	}); err != nil {
		t.Fatal(err)
	}

	err := contexts.Delete(ctx, 1, ctxID, false)
	var inUse *service.ContextInUseError
	if !errors.As(err, &inUse) {
		t.Fatalf("want a *ContextInUseError, got %T: %v", err, err)
	}
	// Three created by hand, plus the instance the daily pattern spawns as
	// soon as it is created.
	if inUse.Todos != 4 {
		t.Errorf("todos = %d, want 4", inUse.Todos)
	}
	if inUse.Recurring != 1 {
		t.Errorf("recurring = %d, want 1", inUse.Recurring)
	}
	// Existing handlers match on the sentinel, so that must keep working.
	if !errors.Is(err, service.ErrContextInUse) {
		t.Error("the typed error no longer satisfies errors.Is(ErrContextInUse)")
	}
}
