package repo_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

func put(t *testing.T, store *repo.Store, id, kind string, userID int64, ttl time.Duration) {
	t.Helper()
	err := store.Ephemeral.Put(context.Background(), &domain.Ephemeral{
		ID: id, Kind: kind, UserID: userID,
		Payload:   []byte(`{"secret":"s"}`),
		ExpiresAt: time.Now().Add(ttl),
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestEphemeralPutPeekTake(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "tok-1", "login", 7, time.Minute)

		got, err := store.Ephemeral.Peek(ctx, "login", "tok-1")
		if err != nil {
			t.Fatal(err)
		}
		if got.UserID != 7 || string(got.Payload) != `{"secret":"s"}` {
			t.Fatalf("round-trip lost data: %+v", got)
		}
		// Peeking must not consume.
		if _, err := store.Ephemeral.Peek(ctx, "login", "tok-1"); err != nil {
			t.Fatalf("peek consumed the entry: %v", err)
		}

		if _, err := store.Ephemeral.Take(ctx, "login", "tok-1"); err != nil {
			t.Fatalf("take: %v", err)
		}
		if _, err := store.Ephemeral.Peek(ctx, "login", "tok-1"); !errors.Is(err, repo.ErrNotFound) {
			t.Fatalf("entry survived being taken: %v", err)
		}
	})
}

// A token issued for one flow must not be redeemable by another.
func TestEphemeralKindIsolation(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "tok-1", "signin", 7, time.Minute)

		if _, err := store.Ephemeral.Take(ctx, "reauth", "tok-1"); !errors.Is(err, repo.ErrNotFound) {
			t.Fatalf("a signin token was redeemed as reauth: %v", err)
		}
		if _, err := store.Ephemeral.Take(ctx, "signin", "tok-1"); err != nil {
			t.Fatalf("the token no longer works for its own kind: %v", err)
		}
	})
}

func TestEphemeralExpiryIsInvisible(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "old", "login", 7, -time.Second) // already expired

		if _, err := store.Ephemeral.Peek(ctx, "login", "old"); !errors.Is(err, repo.ErrNotFound) {
			t.Errorf("an expired entry was returned: %v", err)
		}
		if _, err := store.Ephemeral.Take(ctx, "login", "old"); !errors.Is(err, repo.ErrNotFound) {
			t.Errorf("an expired entry was consumable: %v", err)
		}
		if _, err := store.Ephemeral.Attempt(ctx, "login", "old", 5); !errors.Is(err, repo.ErrNotFound) {
			t.Errorf("an expired entry accepted an attempt: %v", err)
		}
	})
}

// The property the whole design turns on: with several instances racing for one
// single-use token, exactly one may win.
func TestEphemeralTakeIsSingleUseUnderConcurrency(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "race", "login", 7, time.Minute)

		const racers = 8
		var wg sync.WaitGroup
		var mu sync.Mutex
		wins := 0

		wg.Add(racers)
		for i := 0; i < racers; i++ {
			go func() {
				defer wg.Done()
				if _, err := store.Ephemeral.Take(ctx, "login", "race"); err == nil {
					mu.Lock()
					wins++
					mu.Unlock()
				}
			}()
		}
		wg.Wait()

		if wins != 1 {
			t.Fatalf("%d callers consumed the same single-use token, want exactly 1", wins)
		}
	})
}

func TestEphemeralAttemptCountsAndBurns(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "chal", "login", 7, time.Minute)

		for i := 1; i < 5; i++ {
			e, err := store.Ephemeral.Attempt(ctx, "login", "chal", 5)
			if err != nil {
				t.Fatalf("attempt %d: %v", i, err)
			}
			if e.Attempts != i {
				t.Fatalf("attempt %d recorded %d", i, e.Attempts)
			}
			// Still usable while the allowance lasts.
			if _, err := store.Ephemeral.Peek(ctx, "login", "chal"); err != nil {
				t.Fatalf("challenge destroyed early at attempt %d", i)
			}
		}

		// The fifth spends the allowance and destroys it.
		if _, err := store.Ephemeral.Attempt(ctx, "login", "chal", 5); err != nil {
			t.Fatalf("fifth attempt: %v", err)
		}
		if _, err := store.Ephemeral.Peek(ctx, "login", "chal"); !errors.Is(err, repo.ErrNotFound) {
			t.Errorf("challenge survived its attempt allowance: %v", err)
		}
	})
}

// Concurrent guesses must not share one increment, or the allowance is
// effectively unbounded under parallel load.
func TestEphemeralAttemptsAreNotLostUnderConcurrency(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "chal", "login", 7, time.Minute)

		const guesses = 5
		var wg sync.WaitGroup
		wg.Add(guesses)
		for i := 0; i < guesses; i++ {
			go func() {
				defer wg.Done()
				_, _ = store.Ephemeral.Attempt(ctx, "login", "chal", guesses)
			}()
		}
		wg.Wait()

		if _, err := store.Ephemeral.Peek(ctx, "login", "chal"); !errors.Is(err, repo.ErrNotFound) {
			t.Error("five concurrent wrong guesses did not exhaust a five-attempt challenge")
		}
	})
}

func TestEphemeralCountAndPurge(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "a", "login", 7, time.Minute)
		put(t, store, "b", "login", 7, time.Minute)
		put(t, store, "c", "login", 8, time.Minute)
		put(t, store, "stale", "login", 7, -time.Minute)

		n, err := store.Ephemeral.CountForUser(ctx, "login", 7)
		if err != nil {
			t.Fatal(err)
		}
		if n != 2 {
			t.Fatalf("count = %d, want 2 (expired and other users excluded)", n)
		}

		if err := store.Ephemeral.PurgeExpired(ctx, time.Now()); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Ephemeral.Peek(ctx, "login", "a"); err != nil {
			t.Errorf("purge removed a live entry: %v", err)
		}
	})
}

// Deleting an account must take its pending flows with it without touching
// another user's pending flows.
func TestEphemeralDeleteForUserIsScoped(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		put(t, store, "mine", "login", 7, time.Minute)
		put(t, store, "theirs", "login", 8, time.Minute)

		if err := store.Ephemeral.DeleteForUser(ctx, 7); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Ephemeral.Peek(ctx, "login", "mine"); !errors.Is(err, repo.ErrNotFound) {
			t.Errorf("the user's entry survived: %v", err)
		}
		if _, err := store.Ephemeral.Peek(ctx, "login", "theirs"); err != nil {
			t.Errorf("another user's entry was deleted: %v", err)
		}
	})
}
