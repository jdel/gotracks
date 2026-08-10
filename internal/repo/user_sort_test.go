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
		{"email", repo.UserFilter{SortBy: "email"}, "email ASC, id ASC"},
		{"email desc", repo.UserFilter{SortBy: "email", SortDesc: true}, "email DESC, id DESC"},
		{"created", repo.UserFilter{SortBy: "created"}, "created_at ASC, id ASC"},
		{"verified", repo.UserFilter{SortBy: "verified"}, "email_verified_at ASC, id ASC"},
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
