package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func lockoutFixture(t *testing.T) (*service.AuthService, *repo.Store) {
	t.Helper()
	_, store, _ := newTodoService(t)
	svc := newAuthService(t, store)
	svc.SetLoginAttempts(store.LoginAttempts)
	return svc, store
}

const goodPassword = "Str0ng!Passw0rd"

// The per-IP limiter does nothing against guesses spread across many addresses;
// this is what bounds them.
func TestLockoutAfterRepeatedFailures(t *testing.T) {
	svc, _ := lockoutFixture(t)
	ctx := context.Background()
	if _, _, err := svc.Register(ctx, "a@example.com", goodPassword, ""); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < service.MaxLoginFailures; i++ {
		if _, err := svc.AuthenticatePassword(ctx, "a@example.com", "wrong"); !errors.Is(err, service.ErrInvalidCredentials) {
			t.Fatalf("attempt %d: want ErrInvalidCredentials, got %v", i+1, err)
		}
	}

	// Locked — and notably the *correct* password is refused too, or the lock
	// would be trivially bypassed by the attacker who just guessed it.
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", goodPassword); !errors.Is(err, service.ErrAccountLocked) {
		t.Fatalf("want ErrAccountLocked after %d failures, got %v", service.MaxLoginFailures, err)
	}
}

func TestSuccessfulSignInClearsTheCount(t *testing.T) {
	svc, store := lockoutFixture(t)
	ctx := context.Background()
	if _, _, err := svc.Register(ctx, "a@example.com", goodPassword, ""); err != nil {
		t.Fatal(err)
	}

	// A few fat-fingered attempts, then the real password.
	for i := 0; i < 3; i++ {
		_, _ = svc.AuthenticatePassword(ctx, "a@example.com", "wrong")
	}
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", goodPassword); err != nil {
		t.Fatalf("correct password refused below the threshold: %v", err)
	}
	if _, err := store.LoginAttempts.Get(ctx, "a@example.com"); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("the failure record survived a successful sign-in: %v", err)
	}
}

// Locking one account must not lock another.
func TestLockoutIsPerAccount(t *testing.T) {
	svc, _ := lockoutFixture(t)
	ctx := context.Background()
	for _, email := range []string{"alice@example.com", "bob@example.com"} {
		if _, _, err := svc.Register(ctx, email, goodPassword, ""); err != nil {
			t.Fatal(err)
		}
	}

	for i := 0; i < service.MaxLoginFailures; i++ {
		_, _ = svc.AuthenticatePassword(ctx, "a@example.com", "wrong")
	}
	if _, err := svc.AuthenticatePassword(ctx, "bob@example.com", goodPassword); err != nil {
		t.Fatalf("bob was locked out by alice's failures: %v", err)
	}
}

// Arbitrary identifiers must not create durable rows. Dummy Argon2 work still
// makes each guess expensive and the per-route/IP limits bound its rate.
func TestFailuresAgainstUnknownLoginsDoNotGrowState(t *testing.T) {
	svc, store := lockoutFixture(t)
	ctx := context.Background()

	for i := 0; i < service.MaxLoginFailures; i++ {
		if _, err := svc.AuthenticatePassword(ctx, "ghost@example.com", "wrong"); !errors.Is(err, service.ErrInvalidCredentials) {
			t.Fatalf("attempt %d: want ErrInvalidCredentials, got %v", i+1, err)
		}
	}
	if _, err := store.LoginAttempts.Get(ctx, "ghost@example.com"); !errors.Is(err, repo.ErrNotFound) {
		t.Fatalf("unknown login created durable state: %v", err)
	}
}

func TestUnknownLoginDoesComparablePasswordWork(t *testing.T) {
	svc, _ := lockoutFixture(t)
	ctx := context.Background()
	if _, _, err := svc.Register(ctx, "known@example.com", goodPassword, ""); err != nil {
		t.Fatal(err)
	}

	var knownDuration, unknownDuration time.Duration
	for range 3 {
		start := time.Now()
		if _, err := svc.AuthenticatePassword(ctx, "known@example.com", "wrong"); !errors.Is(err, service.ErrInvalidCredentials) {
			t.Fatalf("known account error = %v, want ErrInvalidCredentials", err)
		}
		knownDuration += time.Since(start)

		start = time.Now()
		if _, err := svc.AuthenticatePassword(ctx, "unknown@example.com", "wrong"); !errors.Is(err, service.ErrInvalidCredentials) {
			t.Fatalf("unknown account error = %v, want ErrInvalidCredentials", err)
		}
		unknownDuration += time.Since(start)
	}

	// This deliberately uses a broad bound: it detects the old near-instant
	// unknown-account path without asserting scheduler-sensitive equality.
	shortest := min(knownDuration, unknownDuration)
	longest := max(knownDuration, unknownDuration)
	if shortest*4 < longest {
		t.Fatalf("password work differs too much: known=%s unknown=%s",
			knownDuration, unknownDuration)
	}
}

// Casing must not reset the counter.
func TestLockoutIgnoresEmailCasing(t *testing.T) {
	svc, _ := lockoutFixture(t)
	ctx := context.Background()
	if _, _, err := svc.Register(ctx, "a@example.com", goodPassword, ""); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < service.MaxLoginFailures; i++ {
		_, _ = svc.AuthenticatePassword(ctx, "A@EXAMPLE.COM", "wrong")
	}
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", goodPassword); !errors.Is(err, service.ErrAccountLocked) {
		t.Fatalf("failures under a different casing did not count: %v", err)
	}
}

// Without the repo wired, behaviour is exactly as before.
func TestLockoutDisabledWhenUnwired(t *testing.T) {
	_, store, _ := newTodoService(t)
	svc := newAuthService(t, store) // no SetLoginAttempts
	ctx := context.Background()
	if _, _, err := svc.Register(ctx, "a@example.com", goodPassword, ""); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < service.MaxLoginFailures+5; i++ {
		_, _ = svc.AuthenticatePassword(ctx, "a@example.com", "wrong")
	}
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", goodPassword); err != nil {
		t.Fatalf("lockout applied without the repo wired: %v", err)
	}
}

func TestPurgeDropsStaleRecords(t *testing.T) {
	svc, store := lockoutFixture(t)
	ctx := context.Background()

	if _, _, err := svc.Register(ctx, "known@example.com", goodPassword, ""); err != nil {
		t.Fatal(err)
	}
	_, _ = svc.AuthenticatePassword(ctx, "known@example.com", "wrong")
	if _, err := store.LoginAttempts.Get(ctx, "known@example.com"); err != nil {
		t.Fatalf("setup: %v", err)
	}
	// Everything older than now is stale.
	if err := store.LoginAttempts.PurgeBefore(ctx, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.LoginAttempts.Get(ctx, "known@example.com"); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("stale record survived the purge: %v", err)
	}
}
