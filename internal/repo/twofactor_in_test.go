package repo_test

import (
	"context"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// EnabledUserIDsIn scopes the 2FA lookup to a page of user ids (an IN clause),
// so the admin list loads the flag only for the rows it shows. Verified on both
// dialects because the IN-list rendering is where SQL builders drift.
func TestEnabledUserIDsIn(t *testing.T) {
	eachEngine(t, func(t *testing.T, store *repo.Store) {
		ctx := context.Background()
		now := time.Now()
		mk := func(email string, twoFA bool) int64 {
			u := &domain.User{Email: email, Password: "x", CreatedAt: now, UpdatedAt: now}
			if err := store.Users.Create(ctx, u); err != nil {
				t.Fatal(err)
			}
			if twoFA {
				if err := store.TwoFactor.Upsert(ctx, &domain.TwoFactor{
					UserID: u.ID, Enabled: true, Secret: "s", UpdatedAt: now,
				}); err != nil {
					t.Fatal(err)
				}
			}
			return u.ID
		}
		a := mk("a@example.com", true)
		b := mk("b@example.com", false)
		c := mk("c@example.com", true)

		got, err := store.TwoFactor.EnabledUserIDsIn(ctx, []int64{a, b, c})
		if err != nil {
			t.Fatal(err)
		}
		set := map[int64]bool{}
		for _, id := range got {
			set[id] = true
		}
		if len(got) != 2 || !set[a] || !set[c] || set[b] {
			t.Fatalf("EnabledUserIDsIn = %v, want the two with 2FA on (%d, %d)", got, a, c)
		}

		// Empty input must not build a broken query.
		if e, err := store.TwoFactor.EnabledUserIDsIn(ctx, nil); err != nil || len(e) != 0 {
			t.Fatalf("empty ids = %v, err %v; want empty and nil", e, err)
		}
	})
}
