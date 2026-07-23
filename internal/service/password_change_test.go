package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/service"
)

// authFixture builds an AuthService over a fresh in-memory database.
func authFixture(t *testing.T) *service.AuthService {
	t.Helper()
	_, store, _ := newTodoService(t)
	return newAuthService(t, store)
}

func TestChangePasswordReplacesTheCredential(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()
	u, _, err := svc.Register(ctx, "a@example.com", "Old-Passw0rd!", "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ChangePassword(ctx, u.ID, "Old-Passw0rd!", "New-Passw0rd!"); err != nil {
		t.Fatalf("change password: %v", err)
	}
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", "New-Passw0rd!"); err != nil {
		t.Fatalf("new password rejected: %v", err)
	}
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", "Old-Passw0rd!"); !errors.Is(err, service.ErrInvalidCredentials) {
		t.Fatalf("old password still works: %v", err)
	}
}

// A stolen access token must not be enough to seize the account.
func TestChangePasswordRequiresTheCurrentOne(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()
	u, _, err := svc.Register(ctx, "a@example.com", "Old-Passw0rd!", "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ChangePassword(ctx, u.ID, "wrong-password", "New-Passw0rd!"); !errors.Is(err, service.ErrInvalidCredentials) {
		t.Fatalf("want ErrInvalidCredentials, got %v", err)
	}
	// And the account is untouched.
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", "Old-Passw0rd!"); err != nil {
		t.Fatalf("failed attempt changed the password anyway: %v", err)
	}
}

// Changing a password is how someone evicts a session they do not control.
func TestChangePasswordRevokesOtherSessions(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()
	u, first, err := svc.Register(ctx, "a@example.com", "Old-Passw0rd!", "")
	if err != nil {
		t.Fatal(err)
	}
	// A second device.
	second, err := svc.IssueFor(ctx, u)
	if err != nil {
		t.Fatal(err)
	}

	fresh, err := svc.ChangePassword(ctx, u.ID, "Old-Passw0rd!", "New-Passw0rd!")
	if err != nil {
		t.Fatal(err)
	}

	for name, token := range map[string]string{"first": first.RefreshToken, "second": second.RefreshToken} {
		if _, err := svc.Refresh(ctx, token); !errors.Is(err, service.ErrInvalidRefresh) {
			t.Errorf("%s session survived the password change: %v", name, err)
		}
	}
	// The caller keeps a working session, otherwise changing a password would
	// sign you out of the page you changed it on.
	if _, err := svc.Refresh(ctx, fresh.RefreshToken); err != nil {
		t.Errorf("the pair issued by the change does not work: %v", err)
	}
}

func TestChangePasswordRejectsEmptyNewPassword(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()
	u, _, err := svc.Register(ctx, "a@example.com", "Old-Passw0rd!", "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ChangePassword(ctx, u.ID, "Old-Passw0rd!", ""); !errors.Is(err, auth.ErrWeakPassword) {
		t.Fatalf("want ErrWeakPassword, got %v", err)
	}
}

// SetPassword skips the current-password check, so it is only ever safe behind
// a proof the caller supplied — today a passkey assertion. These pin the parts
// that hold regardless of how that proof was obtained.
func TestSetPasswordReplacesCredentialAndRevokesSessions(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()
	u, first, err := svc.Register(ctx, "a@example.com", "Old-Passw0rd!", "")
	if err != nil {
		t.Fatal(err)
	}

	fresh, err := svc.SetPassword(ctx, u.ID, "New-Passw0rd!")
	if err != nil {
		t.Fatalf("set password: %v", err)
	}
	if _, err := svc.AuthenticatePassword(ctx, "a@example.com", "New-Passw0rd!"); err != nil {
		t.Fatalf("new password rejected: %v", err)
	}
	if _, err := svc.Refresh(ctx, first.RefreshToken); !errors.Is(err, service.ErrInvalidRefresh) {
		t.Errorf("old session survived: %v", err)
	}
	if _, err := svc.Refresh(ctx, fresh.RefreshToken); err != nil {
		t.Errorf("the pair issued by the change does not work: %v", err)
	}
}

func TestSetPasswordRejectsWeakPassword(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()
	u, _, err := svc.Register(ctx, "a@example.com", "Old-Passw0rd!", "")
	if err != nil {
		t.Fatal(err)
	}
	// An empty password now fails the policy rather than the old bare
	// non-empty check.
	if _, err := svc.SetPassword(ctx, u.ID, ""); !errors.Is(err, auth.ErrWeakPassword) {
		t.Fatalf("want ErrWeakPassword for an empty password, got %v", err)
	}
	if _, err := svc.SetPassword(ctx, u.ID, "short1!A"); !errors.Is(err, auth.ErrWeakPassword) {
		t.Fatalf("want ErrWeakPassword for a too-short password, got %v", err)
	}
}

// The address is the identity, so a second account cannot be created for the
// same mailbox by varying the casing.
func TestRegistrationIsCaseInsensitiveOnEmail(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()

	u, _, err := svc.Register(ctx, "  Alice@Example.COM ", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "alice@example.com" {
		t.Fatalf("stored email = %q, want the canonical form", u.Email)
	}
	if _, _, err := svc.Register(ctx, "ALICE@example.com", "Str0ng!Passw0rd", ""); !errors.Is(err, service.ErrEmailTaken) {
		t.Fatalf("a second account was created for the same mailbox: %v", err)
	}
	// And signing in works whatever casing is typed.
	for _, typed := range []string{"alice@example.com", "Alice@Example.com", "ALICE@EXAMPLE.COM"} {
		if _, err := svc.AuthenticatePassword(ctx, typed, "Str0ng!Passw0rd"); err != nil {
			t.Errorf("sign-in as %q failed: %v", typed, err)
		}
	}
}

func TestRegistrationRejectsInvalidEmail(t *testing.T) {
	svc := authFixture(t)
	ctx := context.Background()

	for _, email := range []string{"", "alice", "alice@", "alice@localhost"} {
		if _, _, err := svc.Register(ctx, email, "Str0ng!Passw0rd", ""); !errors.Is(err, auth.ErrInvalidEmail) {
			t.Errorf("Register(%q) = %v, want ErrInvalidEmail", email, err)
		}
	}
}
