package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// A project may reference a default context only within its own account. A
// foreign or nonexistent id is refused, so one account cannot store a reference
// to another's data.
func TestProjectRejectsForeignDefaultContext(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)

	// A context owned by user 2.
	theirs := &domain.Context{UserID: 2, Name: "@theirs", Position: 1, State: domain.StateActive}
	if err := store.Contexts.Create(ctx, theirs); err != nil {
		t.Fatal(err)
	}

	// User 1 cannot create a project defaulting to it.
	if _, err := projects.Create(ctx, 1, service.ProjectInput{
		Name: strPtr("mine"), DefaultContextID: &theirs.ID,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("create with a foreign default context = %v, want ErrValidation", err)
	}

	// Nor a nonexistent one.
	bogus := int64(999999)
	if _, err := projects.Create(ctx, 1, service.ProjectInput{
		Name: strPtr("mine"), DefaultContextID: &bogus,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("create with an unknown default context = %v, want ErrValidation", err)
	}

	// Its own context is fine.
	mine := &domain.Context{UserID: 1, Name: "@mine", Position: 1, State: domain.StateActive}
	if err := store.Contexts.Create(ctx, mine); err != nil {
		t.Fatal(err)
	}
	p, err := projects.Create(ctx, 1, service.ProjectInput{
		Name: strPtr("mine"), DefaultContextID: &mine.ID,
	})
	if err != nil {
		t.Fatalf("create with own default context: %v", err)
	}

	// Update is guarded too: it cannot be pointed at the foreign context.
	if _, err := projects.Update(ctx, 1, p.ID, service.ProjectInput{
		DefaultContextID: &theirs.ID,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("update to a foreign default context = %v, want ErrValidation", err)
	}
}

// A deletion refused for want of a notes decision must not have already mutated
// the project — the check happens before any detach.
func TestProjectDeleteRefusalHasNoSideEffects(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)

	p, err := projects.Create(ctx, 1, service.ProjectInput{Name: strPtr("has notes")})
	if err != nil {
		t.Fatal(err)
	}
	todo, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, ProjectID: &p.ID, Description: strPtr("attached action"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Notes.Create(ctx, &domain.Note{UserID: 1, ProjectID: &p.ID, Body: "keep me?"}); err != nil {
		t.Fatal(err)
	}

	// nil deleteNotes: the project holds a note, so deletion refuses.
	var inUse *service.ProjectNotesInUseError
	if err := projects.Delete(ctx, 1, p.ID, nil); !errors.As(err, &inUse) {
		t.Fatalf("delete = %v, want *ProjectNotesInUseError", err)
	}

	// The refusal must have detached nothing: the action still points at the
	// project, and the project still exists.
	got, err := todoSvc.Get(ctx, 1, todo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ProjectID == nil || *got.ProjectID != p.ID {
		t.Fatalf("a refused deletion detached the action: ProjectID=%v", got.ProjectID)
	}
	if _, err := store.Projects.ByID(ctx, 1, p.ID); err != nil {
		t.Fatalf("a refused deletion removed the project: %v", err)
	}
}

func TestCreateRejectsUnknownProject(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	svc.SetProjects(store.Projects)
	ctx := context.Background()

	bogus := int64(4242)
	if _, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, ProjectID: &bogus, Description: strPtr("x"),
	}); err == nil {
		t.Fatal("todo created referencing a nonexistent project")
	}
}

func TestUpdateRejectsUnknownProject(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	svc.SetProjects(store.Projects)
	ctx := context.Background()

	todo, err := svc.Create(ctx, 1, service.TodoInput{ContextID: &ctxID, Description: strPtr("x")})
	if err != nil {
		t.Fatal(err)
	}
	bogus := int64(4242)
	if _, err := svc.Update(ctx, 1, todo.ID, service.TodoInput{ProjectID: &bogus}); err == nil {
		t.Fatal("todo updated to reference a nonexistent project")
	}
}

func TestCreateRejectsAnotherUsersProject(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	svc.SetProjects(store.Projects)
	ctx := context.Background()

	// Project owned by user 2.
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
	name := "theirs"
	p, err := projects.Create(ctx, 2, service.ProjectInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, ProjectID: &p.ID, Description: strPtr("x"),
	}); err == nil {
		t.Fatal("todo created referencing another user's project")
	}
}

func TestCreateAcceptsOwnProject(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	svc.SetProjects(store.Projects)
	ctx := context.Background()

	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
	name := "mine"
	p, err := projects.Create(ctx, 1, service.ProjectInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, ProjectID: &p.ID, Description: strPtr("x"),
	})
	if err != nil {
		t.Fatalf("create with a valid project: %v", err)
	}
	if todo.ProjectID == nil || *todo.ProjectID != p.ID {
		t.Fatalf("project not attached: %v", todo.ProjectID)
	}
}

func TestRecurringCreateRejectsUnknownProject(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	rec.SetProjects(store.Projects)
	ctx := context.Background()

	bogus := int64(4242)
	period := "daily"
	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, ProjectID: &bogus, Description: strPtr("x"), Period: &period,
	}); err == nil {
		t.Fatal("recurring pattern created referencing a nonexistent project")
	}
}
