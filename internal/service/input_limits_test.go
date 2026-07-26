package service_test

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

func overLimit(n int) string { return strings.Repeat("界", n+1) }

func TestTextLimitsAreEnforcedByServices(t *testing.T) {
	ctx := context.Background()
	todoSvc, store, contextID := newTodoService(t)
	todoSvc.SetProjects(store.Projects)

	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)
	if _, err := contexts.Create(ctx, 1, overLimit(service.MaxNameCharacters), ""); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized context name: %v", err)
	}
	context, err := contexts.Create(ctx, 1, "valid context", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := contexts.Update(
		ctx, 1, context.ID, overLimit(service.MaxNameCharacters), "", nil,
	); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized context update: %v", err)
	}

	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring)
	name := "project"
	description := overLimit(service.MaxDescriptionCharacters)
	if _, err := projects.Create(ctx, 1, service.ProjectInput{
		Name: &name, Description: &description,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized project description: %v", err)
	}
	project, err := projects.Create(ctx, 1, service.ProjectInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := projects.Update(ctx, 1, project.ID, service.ProjectInput{
		Description: &description,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized project update: %v", err)
	}

	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &contextID,
		Description: func() *string {
			value := overLimit(service.MaxDescriptionCharacters)
			return &value
		}(),
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized action description: %v", err)
	}
	todo, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &contextID, Description: strPtr("valid action"),
	})
	if err != nil {
		t.Fatal(err)
	}
	notes := overLimit(service.MaxNotesCharacters)
	if _, err := todoSvc.Update(ctx, 1, todo.ID, service.TodoInput{
		Notes: &notes,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized action update: %v", err)
	}
	oversizedTag := overLimit(service.MaxNameCharacters)
	if _, err := todoSvc.Update(ctx, 1, todo.ID, service.TodoInput{
		Tags: []string{oversizedTag}, HasTags: true,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized tag: %v", err)
	}

	recurring := newRecurringService(t, store)
	period := domain.PeriodDaily
	if _, err := recurring.Create(ctx, 1, service.RecurringInput{
		ContextID: &contextID, Description: strPtr("recurring"), Notes: &notes, Period: &period,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized recurrence notes: %v", err)
	}
	weekdays := strings.Repeat("0,", 1000)
	if _, err := recurring.Create(ctx, 1, service.RecurringInput{
		ContextID: &contextID, Description: strPtr("recurring"), Weekdays: &weekdays, Period: &period,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("invalid recurrence weekdays: %v", err)
	}
	recurrence, err := recurring.Create(ctx, 1, service.RecurringInput{
		ContextID: &contextID, Description: strPtr("valid recurrence"), Period: &period,
	})
	if err != nil {
		t.Fatal(err)
	}
	longDescription := overLimit(service.MaxDescriptionCharacters)
	if _, err := recurring.Update(ctx, 1, recurrence.ID, service.RecurringInput{
		Description: &longDescription,
	}); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized recurrence update: %v", err)
	}

	attachments := service.NewAttachmentService(store.Attachments, store.Todos, testStore(t), 1024)
	attachmentOwner, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &contextID, Description: strPtr("attachment owner"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := attachments.Save(
		ctx, 1, attachmentOwner.ID, overLimit(service.MaxFileNameCharacters), "text/plain", bytes.NewReader(nil),
	); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized attachment filename: %v", err)
	}
	if _, err := attachments.Save(
		ctx, 1, attachmentOwner.ID, "valid.txt",
		overLimit(service.MaxContentTypeCharacters), bytes.NewReader(nil),
	); !errors.Is(err, service.ErrValidation) {
		t.Fatalf("oversized attachment content type: %v", err)
	}
}

func TestTextLimitsCountUnicodeCharacters(t *testing.T) {
	ctx := context.Background()
	_, store, _ := newTodoService(t)
	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)
	name := strings.Repeat("界", service.MaxNameCharacters)
	if _, err := contexts.Create(ctx, 1, name, ""); err != nil {
		t.Fatalf("name at the character limit was refused: %v", err)
	}
}
