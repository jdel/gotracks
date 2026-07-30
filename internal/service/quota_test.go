package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func quotaFixture(t *testing.T, q service.Quotas) (*service.TodoService, *service.QuotaService, *repo.Store, int64) {
	t.Helper()
	todoSvc, store, ctxID := newTodoService(t)
	quotas := service.NewQuotaService(q, store)
	todoSvc.SetQuotas(quotas)
	return todoSvc, quotas, store, ctxID
}

func TestTodoQuotaRefusesPastTheLimit(t *testing.T) {
	todoSvc, _, _, ctxID := quotaFixture(t, service.Quotas{Todos: 3})
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
			ContextID: &ctxID, Description: strPtr("within"),
		}); err != nil {
			t.Fatalf("action %d refused below the limit: %v", i+1, err)
		}
	}
	_, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("over"),
	})
	if !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("want ErrQuotaExceeded, got %v", err)
	}
	// The message has to name what was hit, or the user cannot act on it.
	if !strings.Contains(err.Error(), "action") {
		t.Errorf("error does not name the resource: %v", err)
	}
}

// The quota message is shown to whoever hit the limit, so it has to say which
// limit, what the ceiling is, and what they can do — not just that something
// failed. This is asserted because the UI surfaces the string verbatim.
func TestQuotaMessageNamesLimitAndRemedy(t *testing.T) {
	ctx := context.Background()
	todoSvc, quotas, _, ctxID := quotaFixture(t, service.Quotas{
		Todos: 1, StorageBytes: 1024, TagsPerTodo: 2,
	})

	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("first"),
	}); err != nil {
		t.Fatalf("first action refused: %v", err)
	}
	_, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("second"),
	})

	for _, want := range []string{"limit of 1 actions", "Delete some completed actions"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("action quota message missing %q: %v", want, err)
		}
	}

	// Storage reports a human-readable ceiling rather than a byte count.
	storageErr := quotas.CheckStorage(ctx, 1, 2048)
	for _, want := range []string{"0 MB storage", "Delete some attachments"} {
		if !strings.Contains(storageErr.Error(), want) {
			t.Errorf("storage quota message missing %q: %v", want, storageErr)
		}
	}

	// The per-request tag cap is a different shape — it bounds one action, not
	// the account — so it needs its own wording rather than the shared one.
	tagErr := quotas.CheckTags(ctx, 1, []string{"a", "b", "c"})
	for _, want := range []string{"2 tags on one action", "Use fewer tags"} {
		if !strings.Contains(tagErr.Error(), want) {
			t.Errorf("tags-per-action message missing %q: %v", want, tagErr)
		}
	}
}

// Zero means unlimited, which is what a single-user instance wants.
func TestZeroQuotaMeansUnlimited(t *testing.T) {
	todoSvc, _, _, ctxID := quotaFixture(t, service.Quotas{Todos: 0})
	ctx := context.Background()

	for i := 0; i < 25; i++ {
		if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
			ContextID: &ctxID, Description: strPtr("x"),
		}); err != nil {
			t.Fatalf("action %d refused with no limit set: %v", i+1, err)
		}
	}
}

// One account filling its allowance must not affect anybody else.
func TestQuotasArePerAccount(t *testing.T) {
	todoSvc, _, store, ctxID := quotaFixture(t, service.Quotas{Todos: 2})
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
			ContextID: &ctxID, Description: strPtr("x"),
		}); err != nil {
			t.Fatal(err)
		}
	}
	// A second account with its own context.
	other := mustContext(t, store, 2)
	if _, err := todoSvc.Create(ctx, 2, service.TodoInput{
		ContextID: &other, Description: strPtr("theirs"),
	}); err != nil {
		t.Fatalf("a second account was blocked by the first's usage: %v", err)
	}
}

// Deleting frees the allowance again.
func TestQuotaFreesUpAfterDeletion(t *testing.T) {
	todoSvc, _, _, ctxID := quotaFixture(t, service.Quotas{Todos: 1})
	ctx := context.Background()

	first, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("one"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("two"),
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("want ErrQuotaExceeded, got %v", err)
	}
	if err := todoSvc.Delete(ctx, 1, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("two"),
	}); err != nil {
		t.Fatalf("the allowance was not released by the delete: %v", err)
	}
}

func TestProjectAndNoteQuotas(t *testing.T) {
	_, quotas, store, _ := quotaFixture(t, service.Quotas{Projects: 1, Notes: 1})
	ctx := context.Background()

	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
	projects.SetQuotas(quotas)
	name := "first"
	if _, err := projects.Create(ctx, 1, service.ProjectInput{Name: &name}); err != nil {
		t.Fatal(err)
	}
	second := "second"
	if _, err := projects.Create(ctx, 1, service.ProjectInput{Name: &second}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("project limit not enforced: %v", err)
	}

	// Notes are checked through the service used by the handler.
	if err := quotas.CheckNote(ctx, 1); err != nil {
		t.Fatalf("note check failed with none stored: %v", err)
	}
}

func TestStorageQuota(t *testing.T) {
	_, quotas, _, _ := quotaFixture(t, service.Quotas{StorageBytes: 1000})
	ctx := context.Background()

	if err := quotas.CheckStorage(ctx, 1, 900); err != nil {
		t.Fatalf("a file inside the allowance was refused: %v", err)
	}
	if err := quotas.CheckStorage(ctx, 1, 1001); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("a file over the allowance was accepted: %v", err)
	}
	if err := quotas.CheckStorage(ctx, 1, 1001); err != nil &&
		!strings.Contains(err.Error(), "storage") {
		t.Errorf("error does not name the resource: %v", err)
	}
}

func TestUsageReportsConsumption(t *testing.T) {
	todoSvc, quotas, _, ctxID := quotaFixture(t, service.Quotas{Todos: 10, StorageBytes: 1000})
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
			ContextID: &ctxID, Description: strPtr("x"),
		}); err != nil {
			t.Fatal(err)
		}
	}

	u, err := quotas.Usage(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if u.Todos != 3 || u.TodoLimit != 10 {
		t.Errorf("todos = %d/%d, want 3/10", u.Todos, u.TodoLimit)
	}
	// Summing no attachments must be zero, not an error from a NULL SUM.
	if u.StorageBytes != 0 {
		t.Errorf("storage = %d, want 0", u.StorageBytes)
	}
}

// mustContext gives a second account a context of its own, so per-account
// isolation can be tested.
func mustContext(t *testing.T, store *repo.Store, userID int64) int64 {
	t.Helper()
	c := &domain.Context{UserID: userID, Name: "@theirs", Position: 1, State: domain.StateActive}
	if err := store.Contexts.Create(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	return c.ID
}

// The three that were previously unbounded.
func TestContextTagAndRecurringQuotas(t *testing.T) {
	todoSvc, quotas, store, ctxID := quotaFixture(t, service.Quotas{
		Contexts: 2, Tags: 3, Recurring: 1, TagsPerTodo: 2,
	})
	ctx := context.Background()

	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)
	contexts.SetQuotas(quotas)
	// The fixture already created one context, so one more fits.
	if _, err := contexts.Create(ctx, 1, "@second", ""); err != nil {
		t.Fatalf("second context refused: %v", err)
	}
	if _, err := contexts.Create(ctx, 1, "@third", ""); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("context limit not enforced: %v", err)
	}

	rec := newRecurringService(t, store)
	rec.SetQuotas(quotas)
	period := "daily"
	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, Description: strPtr("first"), Period: &period,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := rec.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, Description: strPtr("second"), Period: &period,
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("recurrence limit not enforced: %v", err)
	}

	// The amplifier: one request must not be able to mint tags without bound.
	_, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("many tags"),
		Tags: []string{"a", "b", "c"}, HasTags: true,
	})
	if !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("per-request tag cap not enforced: %v", err)
	}
	if err != nil && !strings.Contains(err.Error(), "tags on one action") {
		t.Errorf("error does not name the per-request cap: %v", err)
	}
}

// The account-wide tag total is enforced too, not just the per-request cap.
func TestAccountTagTotalIsEnforced(t *testing.T) {
	todoSvc, _, _, ctxID := quotaFixture(t, service.Quotas{Tags: 2, TagsPerTodo: 10})
	ctx := context.Background()

	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("first"),
		Tags: []string{"a", "b"}, HasTags: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("second"),
		Tags: []string{"c"}, HasTags: true,
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("account tag total not enforced: %v", err)
	}
}

func TestTagQuotaCountsOnlyNewNames(t *testing.T) {
	todoSvc, _, _, ctxID := quotaFixture(t, service.Quotas{Tags: 3, TagsPerTodo: 10})
	ctx := context.Background()

	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("fills the tag quota"),
		Tags: []string{"a", "b", "c"}, HasTags: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("reuses existing tags"),
		Tags: []string{"a", "b"}, HasTags: true,
	}); err != nil {
		t.Fatalf("existing tags were charged against the total again: %v", err)
	}
}

func TestTagQuotaIncludesEveryNewNameInRequest(t *testing.T) {
	todoSvc, _, _, ctxID := quotaFixture(t, service.Quotas{Tags: 3, TagsPerTodo: 10})
	ctx := context.Background()

	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("existing tags"),
		Tags: []string{"a", "b"}, HasTags: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("too many new tags"),
		Tags: []string{"b", "c", "d"}, HasTags: true,
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("incoming new tags bypassed the account total: %v", err)
	}
}

func TestImplicitNamesRespectContextAndProjectQuotas(t *testing.T) {
	todoSvc, quotas, store, ctxID := quotaFixture(t, service.Quotas{Contexts: 1, Projects: 1})
	todoSvc.SetProjects(store.Projects)
	ctx := context.Background()

	contextName := "over context limit"
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextName: &contextName, Description: strPtr("implicit context"),
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("implicit context bypassed its quota: %v", err)
	}

	projectName := "existing"
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
	projects.SetQuotas(quotas)
	if _, err := projects.Create(ctx, 1, service.ProjectInput{Name: &projectName}); err != nil {
		t.Fatal(err)
	}
	anotherProject := "over project limit"
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, ProjectName: &anotherProject, Description: strPtr("implicit project"),
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("implicit project bypassed its quota: %v", err)
	}
	if _, err := projects.ResolveByName(ctx, 1, "note project"); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("note project resolution bypassed its quota: %v", err)
	}

	recurring := newRecurringService(t, store)
	recurring.SetProjects(store.Projects)
	recurring.SetQuotas(quotas)
	period := domain.PeriodDaily
	if _, err := recurring.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, ProjectName: strPtr("recurring project"),
		Description: strPtr("recurring"), Period: &period,
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("recurring project resolution bypassed its quota: %v", err)
	}
}

func TestRecurringSpawnRespectsTodoQuota(t *testing.T) {
	todoSvc, quotas, store, ctxID := quotaFixture(t, service.Quotas{Todos: 1})
	ctx := context.Background()
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("fills action quota"),
	}); err != nil {
		t.Fatal(err)
	}

	recurring := newRecurringService(t, store)
	recurring.SetQuotas(quotas)
	period := domain.PeriodDaily
	if _, err := recurring.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, Description: strPtr("cannot spawn"), Period: &period,
	}); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("recurrence bypassed the action quota: %v", err)
	}
	count, err := store.Recurring.CountForUser(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed recurrence left %d stored pattern(s)", count)
	}
}

func TestLaterRecurringSpawnRespectsTodoQuota(t *testing.T) {
	todoSvc, quotas, store, ctxID := quotaFixture(t, service.Quotas{Todos: 2})
	ctx := context.Background()
	if _, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("ordinary action"),
	}); err != nil {
		t.Fatal(err)
	}

	recurring := newRecurringService(t, store)
	recurring.SetQuotas(quotas)
	period := domain.PeriodDaily
	pattern, err := recurring.Create(ctx, 1, service.RecurringInput{
		ContextID: &ctxID, Description: strPtr("recurring"), Period: &period,
	})
	if err != nil {
		t.Fatal(err)
	}
	todos, err := store.Todos.List(ctx, 1, repo.TodoFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, todo := range todos {
		if todo.RecurringTodoID != nil {
			todo.State = domain.StateCompleted
			if err := store.Todos.Update(ctx, todo); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := recurring.SpawnNext(ctx, 1, pattern.ID, time.Now()); !errors.Is(err, service.ErrQuotaExceeded) {
		t.Fatalf("later occurrence bypassed the action quota: %v", err)
	}
}
