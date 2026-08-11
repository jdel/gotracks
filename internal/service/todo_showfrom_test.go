package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// dayOf drops the clock from a timestamp, which is the granularity show-from
// and due are compared at.
func dayOf(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func sameDay(a *time.Time, b time.Time) bool {
	return a != nil && dayOf(*a).Equal(dayOf(b))
}

// withShowFromDays wires a preference service onto the todo service and stores
// the given lead. The plain helper leaves preferences nil, which reads as 0.
func withShowFromDays(t *testing.T, svc *service.TodoService, prefs *service.PreferenceService, days int) {
	t.Helper()
	if _, err := prefs.Update(context.Background(), 1, service.PreferenceInput{ShowFromDays: &days}); err != nil {
		t.Fatalf("set ShowFromDays: %v", err)
	}
	svc.SetPreferences(prefs)
}

// A due date with no show-from of its own gets one from the setting. At the
// default 0 that is the due date itself, so the action waits in the tickler
// until the day it is due.
func TestCreateDueFillsShowFromFromPreference(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)
	withShowFromDays(t, svc, prefs, 0)

	due := time.Now().AddDate(0, 0, 10)
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("file the thing"),
		Due:         &due,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !sameDay(todo.ShowFrom, due) {
		t.Fatalf("show-from: want %v, got %v", due, todo.ShowFrom)
	}
	if todo.State != domain.StateDeferred {
		t.Fatalf("want deferred, got %q", todo.State)
	}
}

// A non-zero setting surfaces the action that many days ahead of the due date.
func TestCreateDueAppliesLeadDays(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)
	withShowFromDays(t, svc, prefs, 3)

	due := time.Now().AddDate(0, 0, 10)
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("file the thing"),
		Due:         &due,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !sameDay(todo.ShowFrom, due.AddDate(0, 0, -3)) {
		t.Fatalf("show-from: want %v, got %v", due.AddDate(0, 0, -3), todo.ShowFrom)
	}
}

// An explicit show-from is the user's own choice and the default never
// overrides it.
func TestCreateExplicitShowFromWins(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)
	withShowFromDays(t, svc, prefs, 3)

	due := time.Now().AddDate(0, 0, 10)
	showFrom := time.Now().AddDate(0, 0, 1)
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("file the thing"),
		Due:         &due,
		ShowFrom:    &showFrom,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !sameDay(todo.ShowFrom, showFrom) {
		t.Fatalf("show-from: want %v, got %v", showFrom, todo.ShowFrom)
	}
}

// No due date, nothing to derive a show-from from — the action is plainly
// active, whatever the setting says.
func TestCreateWithoutDueGetsNoShowFrom(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)
	withShowFromDays(t, svc, prefs, 7)

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("someday"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if todo.ShowFrom != nil {
		t.Fatalf("want no show-from, got %v", todo.ShowFrom)
	}
	if todo.State != domain.StateActive {
		t.Fatalf("want active, got %q", todo.State)
	}
}

// An action may not hide past the day it is due, so a hand-picked show-from
// after the due date is pulled back to it.
func TestCreateClampsShowFromToDue(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()

	due := time.Now().AddDate(0, 0, 5)
	showFrom := time.Now().AddDate(0, 0, 12)
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("file the thing"),
		Due:         &due,
		ShowFrom:    &showFrom,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !sameDay(todo.ShowFrom, due) {
		t.Fatalf("show-from: want clamp to %v, got %v", due, todo.ShowFrom)
	}
}

// Dragging the due date backwards past an untouched show-from brings the
// show-from with it — and does not recompute it from the setting.
func TestUpdateDueClampsExistingShowFrom(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)
	withShowFromDays(t, svc, prefs, 3)

	due := time.Now().AddDate(0, 0, 20)
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("file the thing"),
		Due:         &due,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	earlier := time.Now().AddDate(0, 0, 4)
	updated, err := svc.Update(ctx, 1, todo.ID, service.TodoInput{Due: &earlier})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !sameDay(updated.ShowFrom, earlier) {
		t.Fatalf("show-from: want clamp to %v, got %v", earlier, updated.ShowFrom)
	}
}

// Adding a due date to an action that has none must not silently defer it:
// the default is a creation-time rule only.
func TestUpdateAddingDueDoesNotDefer(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)
	withShowFromDays(t, svc, prefs, 0)

	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("in flight"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	due := time.Now().AddDate(0, 0, 10)
	updated, err := svc.Update(ctx, 1, todo.ID, service.TodoInput{Due: &due})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.ShowFrom != nil {
		t.Fatalf("want no show-from, got %v", updated.ShowFrom)
	}
	if updated.State != domain.StateActive {
		t.Fatalf("want active, got %q", updated.State)
	}
}

// Removing the due date removes the show-from derived from it, and the action
// comes back to the active list.
func TestUpdateClearingDueClearsShowFrom(t *testing.T) {
	svc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)
	withShowFromDays(t, svc, prefs, 0)

	due := time.Now().AddDate(0, 0, 10)
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("file the thing"),
		Due:         &due,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if todo.State != domain.StateDeferred {
		t.Fatalf("setup: want deferred, got %q", todo.State)
	}

	updated, err := svc.Update(ctx, 1, todo.ID, service.TodoInput{ClearDue: true})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Due != nil || updated.ShowFrom != nil {
		t.Fatalf("want both dates cleared, got due=%v show-from=%v", updated.Due, updated.ShowFrom)
	}
	if updated.State != domain.StateActive {
		t.Fatalf("want active, got %q", updated.State)
	}
}

// Show-from is a date, so deferral is decided by calendar day: an action whose
// show-from is later today belongs in the active list, not the tickler,
// whatever the clock says when the request arrives.
func TestCreateShowFromLaterTodayIsActive(t *testing.T) {
	svc, _, ctxID := newTodoService(t)
	ctx := context.Background()

	// End of today, in the same location the service compares against.
	now := time.Now()
	laterToday := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 0, 0, now.Location())
	todo, err := svc.Create(ctx, 1, service.TodoInput{
		ContextID:   &ctxID,
		Description: strPtr("today's job"),
		ShowFrom:    &laterToday,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if todo.State != domain.StateActive {
		t.Fatalf("want active, got %q", todo.State)
	}
}

// A negative lead would put show-from after the due date, where the clamp
// would erase it — refused rather than stored.
func TestPreferenceRejectsNegativeShowFromDays(t *testing.T) {
	_, store, _ := newTodoService(t)
	prefs := service.NewPreferenceService(store.Preferences)

	days := -1
	if _, err := prefs.Update(context.Background(), 1, service.PreferenceInput{ShowFromDays: &days}); err == nil {
		t.Fatal("want validation error, got nil")
	}
}
