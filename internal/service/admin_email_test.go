package service_test

import (
	"context"
	"testing"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// An admin editing a user's address must store the same normalised form login
// looks up, or the edit silently locks the account out.
func TestUpdateUserNormalisesEmail(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	admin := service.NewAdminService(store, nil)

	u := &domain.User{Email: "root@example.com", Password: "x"}
	if err := store.Users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}

	mixed := "Alice@Example.com "
	if _, err := admin.UpdateUser(ctx, 999, u.ID, &mixed, nil, nil); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, err := store.Users.ByEmail(ctx, "alice@example.com")
	if err != nil {
		t.Fatalf("normalised address not found after admin edit: %v", err)
	}
	if got.Email != "alice@example.com" {
		t.Fatalf("email stored un-normalised: %q", got.Email)
	}
}

// A malformed address must be refused, exactly as it is on create.
func TestUpdateUserRejectsInvalidEmail(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	admin := service.NewAdminService(store, nil)

	u := &domain.User{Email: "root@example.com", Password: "x"}
	if err := store.Users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}

	bad := "not-an-email"
	if _, err := admin.UpdateUser(ctx, 999, u.ID, &bad, nil, nil); err == nil {
		t.Fatal("admin set a malformed email without error")
	} else if err != auth.ErrInvalidEmail {
		t.Fatalf("want ErrInvalidEmail, got %v", err)
	}
}
