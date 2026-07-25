package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func auditFixture(t *testing.T) (*service.AuditService, *repo.Store) {
	t.Helper()
	_, store, _ := newTodoService(t)
	return service.NewAuditService(store.Audit), store
}

func record(t *testing.T, svc *service.AuditService, e service.Entry) {
	t.Helper()
	svc.Record(context.Background(), e)
}

// The log is evidence, so the account an entry is about must not be able to
// remove it by leaving. Deleting an account clears every other table it owns
// and deliberately not this one.
func TestAuditSurvivesTheAccountItDescribes(t *testing.T) {
	svc, store := auditFixture(t)
	ctx := context.Background()

	now := time.Now()
	u := &domain.User{Email: "leaver@example.com", Password: "x", CreatedAt: now, UpdatedAt: now}
	if err := store.Users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}
	record(t, svc, service.Entry{
		Action: domain.AuditLoginSucceeded, ActorID: &u.ID, ActorEmail: u.Email,
	})

	admin := service.NewAdminService(store, nil)
	// A second administrator, so the last-admin guard does not block this.
	other := &domain.User{Email: "admin@example.com", Password: "x", IsAdmin: true, CreatedAt: now, UpdatedAt: now}
	if err := store.Users.Create(ctx, other); err != nil {
		t.Fatal(err)
	}
	if err := admin.DeleteUser(ctx, other.ID, u.ID); err != nil {
		t.Fatal(err)
	}

	page, err := svc.Search(ctx, repo.AuditFilter{}, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("the log holds %d entries after the account went, want 1", page.Total)
	}
	// The address is kept as it stood, because "user 41" means nothing once
	// user 41 is gone.
	if page.Items[0].ActorEmail != "leaver@example.com" {
		t.Errorf("the entry lost the address: %q", page.Items[0].ActorEmail)
	}
}

// The filters are what make the log usable; each has to actually narrow.
func TestAuditFilters(t *testing.T) {
	svc, _ := auditFixture(t)
	ctx := context.Background()

	old := time.Now().Add(-48 * time.Hour)
	record(t, svc, service.Entry{
		Action: domain.AuditLoginFailed, Outcome: domain.AuditFailure,
		TargetEmail: "alice@example.com",
	})
	record(t, svc, service.Entry{
		Action: domain.AuditLoginSucceeded, TargetEmail: "bob@example.com",
	})
	record(t, svc, service.Entry{
		Action: domain.AuditAdminUserDeleted, ActorEmail: "admin@example.com",
		TargetEmail: "alice@example.com",
	})

	cases := map[string]struct {
		filter repo.AuditFilter
		want   int
	}{
		"everything":       {repo.AuditFilter{}, 3},
		"by action":        {repo.AuditFilter{Action: domain.AuditLoginFailed}, 1},
		"by outcome":       {repo.AuditFilter{Outcome: domain.AuditFailure}, 1},
		"by person":        {repo.AuditFilter{Actor: "alice@example.com"}, 2},
		"person as actor":  {repo.AuditFilter{Actor: "admin@example.com"}, 1},
		"case insensitive": {repo.AuditFilter{Actor: "ALICE@EXAMPLE.COM"}, 2},
		"since before":     {repo.AuditFilter{From: &old}, 3},
	}
	for name, tc := range cases {
		page, err := svc.Search(ctx, tc.filter, 1, 50)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if page.Total != tc.want {
			t.Errorf("%s: matched %d, want %d", name, page.Total, tc.want)
		}
	}

	// A window that excludes everything must say so rather than ignoring it.
	future := time.Now().Add(time.Hour)
	page, err := svc.Search(ctx, repo.AuditFilter{From: &future}, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Errorf("a future window matched %d entries", page.Total)
	}
}

// A filter naming something the log cannot contain is refused rather than
// answered with nothing — silence would read as "it never happened".
func TestAuditRejectsAnImpossibleFilter(t *testing.T) {
	svc, _ := auditFixture(t)
	ctx := context.Background()

	if _, err := svc.Search(ctx, repo.AuditFilter{Action: "admin.user.teleported"}, 1, 50); err == nil {
		t.Error("an unknown action was accepted")
	}
	if _, err := svc.Search(ctx, repo.AuditFilter{Outcome: "maybe"}, 1, 50); err == nil {
		t.Error("an unknown outcome was accepted")
	}
	from, to := time.Now(), time.Now().Add(-time.Hour)
	if _, err := svc.Search(ctx, repo.AuditFilter{From: &from, To: &to}, 1, 50); err == nil {
		t.Error("a window ending before it starts was accepted")
	}
}

// Paging must describe the same set it counts, or the pager lies about how
// much there is.
func TestAuditPagingMatchesItsTotal(t *testing.T) {
	svc, _ := auditFixture(t)
	ctx := context.Background()
	for i := 0; i < 7; i++ {
		record(t, svc, service.Entry{Action: domain.AuditLoginSucceeded})
	}
	record(t, svc, service.Entry{Action: domain.AuditLoginFailed, Outcome: domain.AuditFailure})

	page, err := svc.Search(ctx, repo.AuditFilter{Action: domain.AuditLoginSucceeded}, 2, 5)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 7 {
		t.Errorf("total = %d, want the 7 that match the filter", page.Total)
	}
	if len(page.Items) != 2 {
		t.Errorf("second page holds %d rows, want the remaining 2", len(page.Items))
	}
	for _, item := range page.Items {
		if item.Action != domain.AuditLoginSucceeded {
			t.Errorf("page leaked a %q entry past the filter", item.Action)
		}
	}

	// Export takes the whole match rather than a page.
	all, err := svc.All(ctx, repo.AuditFilter{Action: domain.AuditLoginSucceeded})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 7 {
		t.Errorf("export returned %d rows, want every match", len(all))
	}
}

// A caller-supplied user agent is unbounded and the table is never pruned.
func TestAuditBoundsTheUserAgent(t *testing.T) {
	svc, _ := auditFixture(t)
	ctx := context.Background()
	record(t, svc, service.Entry{
		Action: domain.AuditLoginFailed, Outcome: domain.AuditFailure,
		UserAgent: strings.Repeat("A", 5000),
	})
	page, err := svc.Search(ctx, repo.AuditFilter{}, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(page.Items[0].UserAgent); got > 500 {
		t.Errorf("stored a %d character user agent unchecked", got)
	}
}

// Retention is the one thing that removes entries, and it removes them by age
// alone — never a chosen row, and never because an account left.
func TestAuditRetentionDropsOldEntriesOnly(t *testing.T) {
	svc, store := auditFixture(t)
	ctx := context.Background()

	old := &domain.AuditEvent{
		OccurredAt: time.Now().Add(-100 * 24 * time.Hour),
		Action:     domain.AuditLoginFailed, Outcome: domain.AuditFailure,
	}
	recent := &domain.AuditEvent{
		OccurredAt: time.Now().Add(-10 * 24 * time.Hour),
		Action:     domain.AuditLoginSucceeded, Outcome: domain.AuditSuccess,
	}
	for _, e := range []*domain.AuditEvent{old, recent} {
		if err := store.Audit.Append(ctx, e); err != nil {
			t.Fatal(err)
		}
	}

	removed, err := svc.Purge(ctx, 90*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("purged %d entries, want the one past 90 days", removed)
	}
	page, err := svc.Search(ctx, repo.AuditFilter{}, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].Action != domain.AuditLoginSucceeded {
		t.Fatalf("retention kept the wrong entry: %+v", page.Items)
	}
}

// A window of zero is the deliberate escape hatch: keep everything.
func TestAuditRetentionZeroKeepsEverything(t *testing.T) {
	svc, store := auditFixture(t)
	ctx := context.Background()
	if err := store.Audit.Append(ctx, &domain.AuditEvent{
		OccurredAt: time.Now().Add(-10 * 365 * 24 * time.Hour),
		Action:     domain.AuditLoginFailed, Outcome: domain.AuditFailure,
	}); err != nil {
		t.Fatal(err)
	}
	removed, err := svc.Purge(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Errorf("a zero window removed %d entries", removed)
	}
	page, _ := svc.Search(ctx, repo.AuditFilter{}, 1, 50)
	if page.Total != 1 {
		t.Errorf("a decade-old entry was dropped under an unlimited window")
	}
}
