package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// The kind the account-deletion mail issues its token under. Duplicated here
// rather than exported: the constant is the service's own business, and a test
// that hard-codes it fails loudly if the flow ever changes kind.
const deletionKind = "account-deletion"

func newAdminWithQuotas(store *repo.Store, q service.Quotas) *service.AdminService {
	admin := service.NewAdminService(store, nil)
	admin.SetQuotas(q)
	return admin
}

func createUser(t *testing.T, store *repo.Store, email string) *domain.User {
	t.Helper()
	u := &domain.User{Email: email, Password: "x"}
	if err := store.Users.Create(context.Background(), u); err != nil {
		t.Fatalf("create %s: %v", email, err)
	}
	return u
}

// A pending deletion is a live mailed token, not a column — so the chip has to
// appear while the token lives and go by itself once it expires.
func TestStatesForReportsALiveDeletionRequest(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	admin := newAdminWithQuotas(store, service.Quotas{})

	asked := createUser(t, store, "asked@example.com")
	quiet := createUser(t, store, "quiet@example.com")
	expired := createUser(t, store, "expired@example.com")

	put := func(u *domain.User, id string, expires time.Time) {
		e := &domain.Ephemeral{
			ID: id, Kind: deletionKind, UserID: u.ID,
			ExpiresAt: expires, CreatedAt: time.Now(),
		}
		if err := store.Ephemeral.Put(ctx, e); err != nil {
			t.Fatalf("put ephemeral: %v", err)
		}
	}
	put(asked, "live-token", time.Now().Add(time.Hour))
	put(expired, "dead-token", time.Now().Add(-time.Hour))

	states, err := admin.StatesFor(ctx, []int64{asked.ID, quiet.ID, expired.ID})
	if err != nil {
		t.Fatalf("states: %v", err)
	}
	if !states[asked.ID].DeletionRequested {
		t.Error("account with a live deletion link is not flagged")
	}
	if states[quiet.ID].DeletionRequested {
		t.Error("account with no deletion link is flagged")
	}
	if states[expired.ID].DeletionRequested {
		t.Error("expired deletion link still flags the account")
	}
}

// A token of another kind must not be mistaken for a deletion request.
func TestStatesForIgnoresOtherTokenKinds(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	admin := newAdminWithQuotas(store, service.Quotas{})

	u := createUser(t, store, "resetting@example.com")
	e := &domain.Ephemeral{
		ID: "reset-token", Kind: "password-reset", UserID: u.ID,
		ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now(),
	}
	if err := store.Ephemeral.Put(ctx, e); err != nil {
		t.Fatalf("put ephemeral: %v", err)
	}

	states, err := admin.StatesFor(ctx, []int64{u.ID})
	if err != nil {
		t.Fatalf("states: %v", err)
	}
	if states[u.ID].DeletionRequested {
		t.Error("a password-reset token was read as a deletion request")
	}
}

// Over quota is read from the stored usage report against the limits in force
// now, so lowering a limit puts existing accounts over it without a rebuild.
func TestStatesForReportsOverQuota(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()

	full := createUser(t, store, "full@example.com")
	roomy := createUser(t, store, "roomy@example.com")
	unreported := createUser(t, store, "unreported@example.com")

	snapshots := []*domain.UsageSnapshot{
		{UserID: full.ID, Email: full.Email, Todos: 10, GeneratedAt: time.Now()},
		{UserID: roomy.ID, Email: roomy.Email, Todos: 2, GeneratedAt: time.Now()},
	}
	if err := store.UsageReports.Replace(ctx, snapshots); err != nil {
		t.Fatalf("replace report: %v", err)
	}

	admin := newAdminWithQuotas(store, service.Quotas{Todos: 10})
	states, err := admin.StatesFor(ctx, []int64{full.ID, roomy.ID, unreported.ID})
	if err != nil {
		t.Fatalf("states: %v", err)
	}
	// At the limit counts: nothing more can be created.
	if !states[full.ID].OverQuota {
		t.Error("account at its action limit is not flagged")
	}
	if states[roomy.ID].OverQuota {
		t.Error("account well inside its limits is flagged")
	}
	// An account created since the last report simply has no snapshot.
	if states[unreported.ID].OverQuota {
		t.Error("account with no snapshot is flagged")
	}
}

// A limit of zero means unlimited, and nothing can exceed it.
func TestStatesForTreatsZeroLimitAsUnlimited(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()

	u := createUser(t, store, "unbounded@example.com")
	err := store.UsageReports.Replace(ctx, []*domain.UsageSnapshot{
		{UserID: u.ID, Email: u.Email, Todos: 9999, GeneratedAt: time.Now()},
	})
	if err != nil {
		t.Fatalf("replace report: %v", err)
	}

	admin := newAdminWithQuotas(store, service.Quotas{Todos: 0})
	states, err := admin.StatesFor(ctx, []int64{u.ID})
	if err != nil {
		t.Fatalf("states: %v", err)
	}
	if states[u.ID].OverQuota {
		t.Error("an unlimited allowance was reported as exceeded")
	}
}

// The page's annotations must not cost a query per row.
func TestStatesForHandlesAnEmptyPage(t *testing.T) {
	_, store, _ := newTodoService(t)
	admin := newAdminWithQuotas(store, service.Quotas{})

	states, err := admin.StatesFor(context.Background(), nil)
	if err != nil {
		t.Fatalf("states: %v", err)
	}
	if len(states) != 0 {
		t.Fatalf("states = %v, want empty", states)
	}
}
