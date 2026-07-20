package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func newAuthService(t *testing.T, store *repo.Store) *service.AuthService {
	t.Helper()
	tm := auth.NewTokenManager([]byte("test-secret"), time.Minute, time.Hour)
	settings := service.NewSettingsService(store.Settings, true)
	return service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)
}

// The issuer only vouches for the subject; preferred_username is often
// self-service. Matching it against a local password account would hand that
// account — the first-run admin included — to anyone who can pick a username.
func TestOIDCLoginCannotClaimPasswordAccount(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	authSvc := newAuthService(t, store)

	if _, _, err := authSvc.Register(ctx, "alice@example.com", "S3cret-Passw0rd!", ""); err != nil {
		t.Fatalf("register: %v", err)
	}

	_, _, err := authSvc.LoginOIDC(ctx, &auth.OIDCUser{
		Subject: "attacker-subject",
		Email:   "alice@example.com",
	})
	if err == nil {
		t.Fatal("OIDC identity signed in as the local password account of the same name")
	}
	if !errors.Is(err, service.ErrEmailTaken) {
		t.Fatalf("want ErrLoginTaken, got %v", err)
	}

	// The local account must be untouched: its password still works.
	if _, err := authSvc.AuthenticatePassword(ctx, "alice@example.com", "S3cret-Passw0rd!"); err != nil {
		t.Fatalf("local login broken after refused SSO: %v", err)
	}
}

// An account provisioned by SSO is still reused on the next sign-in.
func TestOIDCLoginReusesItsOwnAccount(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	authSvc := newAuthService(t, store)

	id := &auth.OIDCUser{Subject: "sub-1", PreferredUsername: "bob", Email: "bob@example.com"}
	first, _, err := authSvc.LoginOIDC(ctx, id)
	if err != nil {
		t.Fatalf("first sso login: %v", err)
	}
	second, _, err := authSvc.LoginOIDC(ctx, id)
	if err != nil {
		t.Fatalf("second sso login: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("sso login provisioned a duplicate account: %d then %d", first.ID, second.ID)
	}

	// And it has no usable password.
	if _, err := authSvc.AuthenticatePassword(ctx, "bob@example.com", "!oidc"); err == nil {
		t.Fatal("sso-only account accepted a password login")
	}
}
