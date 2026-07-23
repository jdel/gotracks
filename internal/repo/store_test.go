package repo_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// eachEngine runs fn against SQLite always, and Postgres when TRACKS_TEST_PG is set,
// so repository behavior is verified on both dialects (catching dialect drift).
func eachEngine(t *testing.T, fn func(t *testing.T, store *repo.Store)) {
	t.Helper()

	t.Run("sqlite", func(t *testing.T) {
		sqldb, err := sql.Open(sqliteshim.ShimName, ":memory:")
		if err != nil {
			t.Fatal(err)
		}
		sqldb.SetMaxOpenConns(1)
		bdb := bun.NewDB(sqldb, sqlitedialect.New())
		runWith(t, bdb, fn)
	})

	if dsn := os.Getenv("TRACKS_TEST_PG"); dsn != "" {
		t.Run("postgres", func(t *testing.T) {
			sqldb := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
			bdb := bun.NewDB(sqldb, pgdialect.New())
			runWith(t, bdb, fn)
		})
	}
}

func runWith(t *testing.T, bdb *bun.DB, fn func(*testing.T, *repo.Store)) {
	t.Helper()
	defer bdb.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	fn(t, repo.NewStore(bdb))
}

func TestUserCreateAndLookup(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		u := &domain.User{Email: "jdel@example.com", Password: "x", IsAdmin: true}
		if err := store.Users.Create(ctx, u); err != nil {
			t.Fatalf("create: %v", err)
		}
		got, err := store.Users.ByEmail(ctx, "jdel@example.com")
		if err != nil {
			t.Fatalf("by email: %v", err)
		}
		if got.ID != u.ID {
			t.Fatalf("id mismatch: %d != %d", got.ID, u.ID)
		}
		// The address is the identity, so lookup folds case.
		if mixed, err := store.Users.ByEmail(ctx, "JDel@Example.COM"); err != nil || mixed.ID != u.ID {
			t.Fatalf("case-insensitive lookup failed: %v", err)
		}
		if _, err := store.Users.ByEmail(ctx, "nobody@example.com"); !errors.Is(err, repo.ErrNotFound) {
			t.Fatalf("expected ErrNotFound, got %v", err)
		}
	})
}

func TestTwoFactorStepIsConsumedOnce(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		tf := &domain.TwoFactor{
			UserID:   42,
			Enabled:  true,
			Secret:   "secret",
			LastStep: 100,
		}
		if err := store.TwoFactor.Upsert(ctx, tf); err != nil {
			t.Fatalf("create two-factor state: %v", err)
		}
		if err := store.TwoFactor.ConsumeStep(ctx, tf.UserID, 101); err != nil {
			t.Fatalf("consume new step: %v", err)
		}
		if err := store.TwoFactor.ConsumeStep(ctx, tf.UserID, 101); !errors.Is(err, repo.ErrNotFound) {
			t.Fatalf("reused step error = %v, want ErrNotFound", err)
		}
		if err := store.TwoFactor.ConsumeStep(ctx, tf.UserID, 100); !errors.Is(err, repo.ErrNotFound) {
			t.Fatalf("older step error = %v, want ErrNotFound", err)
		}

		stored, err := store.TwoFactor.Get(ctx, tf.UserID)
		if err != nil {
			t.Fatal(err)
		}
		if stored.LastStep != 101 {
			t.Fatalf("last step = %d, want 101", stored.LastStep)
		}
	})
}

func TestContextScopedByUser(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		c := &domain.Context{UserID: 1, Name: "@home", Position: 1, State: domain.StateActive}
		if err := store.Contexts.Create(ctx, c); err != nil {
			t.Fatalf("create: %v", err)
		}
		// Another user must not see it.
		list, err := store.Contexts.List(ctx, 2)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(list) != 0 {
			t.Fatalf("expected 0 contexts for other user, got %d", len(list))
		}
		// Owner sees it.
		list, err = store.Contexts.List(ctx, 1)
		if err != nil || len(list) != 1 {
			t.Fatalf("owner list: %v len=%d", err, len(list))
		}
		// Delete scoped to wrong user is a no-op → ErrNotFound.
		if err := store.Contexts.Delete(ctx, 2, c.ID); !errors.Is(err, repo.ErrNotFound) {
			t.Fatalf("expected ErrNotFound deleting other user's context, got %v", err)
		}
	})
}

// Every list must come back as an empty JSON array, never null, for a user who
// owns nothing. A nil slice marshals to null, which clients have to special-case
// on top of the empty case they already handle.
func TestEmptyListsMarshalAsArrays(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		const noSuchUser int64 = 999

		lists := map[string]func() (any, error){
			"contexts": func() (any, error) { return store.Contexts.List(ctx, noSuchUser) },
			"projects": func() (any, error) { return store.Projects.List(ctx, noSuchUser, "") },
			"todos":    func() (any, error) { return store.Todos.List(ctx, noSuchUser, repo.TodoFilter{}) },
			"tags":     func() (any, error) { return store.Tags.List(ctx, noSuchUser) },
			"notes":    func() (any, error) { return store.Notes.List(ctx, noSuchUser, nil) },
			"recurring": func() (any, error) {
				return store.Recurring.List(ctx, noSuchUser, "")
			},
			"credentials": func() (any, error) { return store.Credentials.ListForUser(ctx, noSuchUser) },
			"users":       func() (any, error) { return store.Users.List(ctx) },
		}

		for name, list := range lists {
			t.Run(name, func(t *testing.T) {
				got, err := list()
				if err != nil {
					t.Fatal(err)
				}
				encoded, err := json.Marshal(got)
				if err != nil {
					t.Fatal(err)
				}
				if string(encoded) == "null" {
					t.Errorf("empty %s list marshals to null, want []", name)
				}
			})
		}
	})
}
