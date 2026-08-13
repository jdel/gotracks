package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// The point of tagging a pattern: the actions it spawns carry the tags. A tag
// that stayed on the rule would never reach a list anybody reads.
func TestSpawnedActionInheritsPatternTags(t *testing.T) {
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
		Tags:        []string{"Garden", " indoor "},
		HasTags:     true,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	todos, err := todoSvc.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(todos) != 1 {
		t.Fatalf("want one spawned action, got %d", len(todos))
	}
	// Normalised the same way an action's own tags are: trimmed, lowercased.
	if got := todos[0].Tags; len(got) != 2 || got[0] != "garden" || got[1] != "indoor" {
		t.Fatalf("spawned action tags = %v, want [garden indoor]", got)
	}
}

// Tags round-trip through the pattern itself, and follow the same "absent means
// leave alone, empty means clear" rule an action's do.
func TestPatternTagsRoundTripAndClear(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()

	pattern, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("water the plants"),
		Period:      strPtr(domain.PeriodWeekly),
		Tags:        []string{"garden"},
		HasTags:     true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	listed, err := rec.List(ctx, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || len(listed[0].Tags) != 1 || listed[0].Tags[0] != "garden" {
		t.Fatalf("listed tags = %v, want [garden]", listed[0].Tags)
	}

	// An update that says nothing about tags keeps them …
	updated, err := rec.Update(ctx, 1, pattern.ID, service.RecurringInput{Description: strPtr("water them well")})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if len(updated.Tags) != 1 {
		t.Fatalf("an update silent about tags must keep them, got %v", updated.Tags)
	}

	// … and an empty set clears them.
	updated, err = rec.Update(ctx, 1, pattern.ID, service.RecurringInput{Tags: []string{}, HasTags: true})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if len(updated.Tags) != 0 {
		t.Fatalf("want the tags cleared, got %v", updated.Tags)
	}
}

// A deleted pattern takes its links with it, or the next pattern handed this id
// inherits somebody else's tags.
func TestDeletingPatternDropsItsTaggings(t *testing.T) {
	_, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()

	pattern, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("water the plants"),
		Period:      strPtr(domain.PeriodWeekly),
		Tags:        []string{"garden"},
		HasTags:     true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := rec.Delete(ctx, 1, pattern.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	left, err := store.Tags.ForRecurring(ctx, 1, []int64{pattern.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(left[pattern.ID]) != 0 {
		t.Fatalf("taggings outlived their pattern: %v", left[pattern.ID])
	}
}

// An export that dropped a pattern's tags would lose the tags of every action
// it has not spawned yet.
func TestExportCarriesPatternTags(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	rec := newRecurringService(t, store)
	ctx := context.Background()

	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID:   &ctxID,
		Description: strPtr("water the plants"),
		Period:      strPtr(domain.PeriodWeekly),
		Tags:        []string{"garden"},
		HasTags:     true,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	export, err := service.NewTransferService(store, todoSvc).Gather(ctx, 1)
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	if len(export.Recurring) != 1 {
		t.Fatalf("want one pattern in the export, got %d", len(export.Recurring))
	}
	if got := export.Recurring[0].Tags; len(got) != 1 || got[0] != "garden" {
		t.Fatalf("exported tags = %v, want [garden]", got)
	}
}
