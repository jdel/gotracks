package repo_test

import (
	"context"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// The admin list is server-paginated, so ordering has to happen in SQL. The
// column name reaches the query through a whitelist and never as free text.
func TestUserFilterOrderByWhitelistsTheColumn(t *testing.T) {
	cases := []struct {
		name string
		f    repo.UserFilter
		want string
	}{
		{"default", repo.UserFilter{}, "id ASC"},
		{"email", repo.UserFilter{SortBy: "email"}, "email ASC NULLS FIRST, id ASC"},
		{"email desc", repo.UserFilter{SortBy: "email", SortDesc: true}, "email DESC NULLS LAST, id DESC"},
		{"created", repo.UserFilter{SortBy: "created"}, "created_at ASC NULLS FIRST, id ASC"},
		{"verified", repo.UserFilter{SortBy: "verified"}, "email_verified_at ASC NULLS FIRST, id ASC"},
		// Anything outside the whitelist falls back rather than reaching SQL.
		{"unknown", repo.UserFilter{SortBy: "password"}, "id ASC"},
		{"injection", repo.UserFilter{SortBy: "email; DROP TABLE users"}, "id ASC"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.f.OrderBy(); got != tc.want {
				t.Fatalf("OrderBy() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestListPageOrdersByTheRequestedColumn(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		// Created out of alphabetical order, so an email sort cannot pass by
		// accidentally agreeing with the id order.
		for _, email := range []string{"carol@example.com", "alice@example.com", "bob@example.com"} {
			u := &domain.User{Email: email, Password: "x", CreatedAt: time.Now(), UpdatedAt: time.Now()}
			if err := store.Users.Create(ctx, u); err != nil {
				t.Fatalf("create %s: %v", email, err)
			}
		}

		emails := func(f repo.UserFilter) []string {
			us, err := store.Users.ListPage(ctx, f, 0, 10)
			if err != nil {
				t.Fatalf("list page: %v", err)
			}
			out := make([]string, len(us))
			for i, u := range us {
				out[i] = u.Email
			}
			return out
		}

		want := []string{"alice@example.com", "bob@example.com", "carol@example.com"}
		if got := emails(repo.UserFilter{SortBy: "email"}); !equal(got, want) {
			t.Fatalf("email ASC = %v, want %v", got, want)
		}

		want = []string{"carol@example.com", "bob@example.com", "alice@example.com"}
		if got := emails(repo.UserFilter{SortBy: "email", SortDesc: true}); !equal(got, want) {
			t.Fatalf("email DESC = %v, want %v", got, want)
		}

		// The default is still insertion order, which the list relied on before.
		want = []string{"carol@example.com", "alice@example.com", "bob@example.com"}
		if got := emails(repo.UserFilter{}); !equal(got, want) {
			t.Fatalf("default = %v, want %v", got, want)
		}
	})
}

// Sorting has to survive paging: the second page must continue the first, which
// is why the id is appended as a tiebreak.
func TestListPageSortIsStableAcrossPages(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		// All unverified, so the sort column is NULL for every row and only the
		// tiebreak can order them.
		for _, email := range []string{"d@example.com", "a@example.com", "c@example.com", "b@example.com"} {
			u := &domain.User{Email: email, Password: "x", CreatedAt: time.Now(), UpdatedAt: time.Now()}
			if err := store.Users.Create(ctx, u); err != nil {
				t.Fatalf("create %s: %v", email, err)
			}
		}

		f := repo.UserFilter{SortBy: "verified"}
		seen := map[string]bool{}
		for offset := 0; offset < 4; offset += 2 {
			us, err := store.Users.ListPage(ctx, f, offset, 2)
			if err != nil {
				t.Fatalf("page at %d: %v", offset, err)
			}
			for _, u := range us {
				if seen[u.Email] {
					t.Fatalf("%s appeared on two pages", u.Email)
				}
				seen[u.Email] = true
			}
		}
		if len(seen) != 4 {
			t.Fatalf("paged over %d accounts, want 4", len(seen))
		}
	})
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Sorting by verification has to put the unverified accounts at a predictable
// end. SQLite sorts NULLs first and Postgres sorts them last, so the ordering
// says so explicitly rather than inheriting whatever the engine prefers.
func TestListPageGroupsUnverifiedAccountsPredictably(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		verified := time.Now().Add(-24 * time.Hour)

		for _, u := range []*domain.User{
			{Email: "invited@example.com", Password: "x"},
			{Email: "proven@example.com", Password: "x", EmailVerifiedAt: &verified},
		} {
			u.CreatedAt, u.UpdatedAt = time.Now(), time.Now()
			if err := store.Users.Create(ctx, u); err != nil {
				t.Fatalf("create %s: %v", u.Email, err)
			}
		}

		first := func(f repo.UserFilter) string {
			us, err := store.Users.ListPage(ctx, f, 0, 10)
			if err != nil {
				t.Fatalf("list page: %v", err)
			}
			if len(us) == 0 {
				t.Fatal("no accounts returned")
			}
			return us[0].Email
		}

		// Ascending: never-verified first, on either engine.
		if got := first(repo.UserFilter{SortBy: "verified"}); got != "invited@example.com" {
			t.Errorf("verified ASC first = %s, want invited@example.com", got)
		}
		// Descending inverts it, so the unverified move to the end.
		if got := first(repo.UserFilter{SortBy: "verified", SortDesc: true}); got != "proven@example.com" {
			t.Errorf("verified DESC first = %s, want proven@example.com", got)
		}
	})
}
