package service_test

import (
	"context"
	"testing"

	"github.com/jdel/gotracks/internal/service"
)

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
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring)
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

	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring)
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
