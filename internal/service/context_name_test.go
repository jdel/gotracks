package service_test

import (
	"context"
	"testing"

	"github.com/jdel/gotracks/internal/service"
)

// A context created through the composer's "@name" syntax must be stored bare,
// exactly as the manual "add context" form stores it — the sigil is not part of
// the name.
func TestComposerCreatedContextIsStoredBare(t *testing.T) {
	svc, store, _ := newTodoService(t)
	ctx := context.Background()

	name := "@errands"
	if _, err := svc.Create(ctx, 1, service.TodoInput{
		ContextName: &name, Description: strPtr("buy milk"),
	}); err != nil {
		t.Fatalf("create with new context: %v", err)
	}

	cs, err := store.Contexts.List(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, c := range cs {
		if c.Name == "@errands" {
			t.Fatalf("context stored with leading sigil: %q", c.Name)
		}
		if c.Name == "errands" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a bare 'errands' context, got %v", cs)
	}
}
