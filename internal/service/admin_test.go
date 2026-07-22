package service_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// Deleting an account must take everything private to it. Nothing cascades in
// the schema, so anything missed here outlives the account it belonged to.
func TestDeleteUserPurgesEverythingItOwned(t *testing.T) {
	todoSvc, store, _ := newTodoService(t)
	ctx := context.Background()

	uploads := t.TempDir()
	attachments := service.NewAttachmentService(store.Attachments, store.Todos, uploads, 1<<20)
	admin := service.NewAdminService(store, attachments)

	caller := &domain.User{Email: "root@example.com", Password: "x", IsAdmin: true}
	if err := store.Users.Create(ctx, caller); err != nil {
		t.Fatal(err)
	}
	victim := &domain.User{Email: "victim@example.com", Password: "x"}
	if err := store.Users.Create(ctx, victim); err != nil {
		t.Fatal(err)
	}

	// Give the victim a full GTD footprint of their own.
	victimCtx := &domain.Context{
		UserID: victim.ID, Name: "@private", Position: 1, State: domain.StateActive,
	}
	if err := store.Contexts.Create(ctx, victimCtx); err != nil {
		t.Fatal(err)
	}

	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring)
	p, err := projects.Create(ctx, victim.ID, service.ProjectInput{Name: strPtr("secret project")})
	if err != nil {
		t.Fatal(err)
	}
	first, err := todoSvc.Create(ctx, victim.ID, service.TodoInput{
		ContextID: &victimCtx.ID, ProjectID: &p.ID, Description: strPtr("private thing"),
		Tags: []string{"confidential"}, HasTags: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// A second action, so the cascade is shown to clear more than one row.
	if _, err := todoSvc.Create(ctx, victim.ID, service.TodoInput{
		ContextID: &victimCtx.ID, Description: strPtr("another private thing"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Notes.Create(ctx, &domain.Note{
		UserID: victim.ID, ProjectID: &p.ID, Body: "private note",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := attachments.Save(ctx, victim.ID, first.ID, "secret.txt", "text/plain",
		strings.NewReader("classified")); err != nil {
		t.Fatal(err)
	}
	if err := store.RefreshTokens.Create(ctx, &domain.RefreshToken{
		UserID: victim.ID, TokenHash: "hash-1",
		ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Credentials.Create(ctx, &domain.Credential{
		UserID: victim.ID, Name: "yubikey", CredentialID: "cred-1",
		PublicKey: "pk", CreatedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	// Two-factor enrolment: the secret and the recovery codes are credentials
	// too, and must not outlive the account.
	twoFactor := service.NewTwoFactorService(store.TwoFactor, store.RecoveryCodes, store.Users, store.Ephemeral, "gotracks")
	enrolment, err := twoFactor.BeginEnrolment(ctx, victim.ID)
	if err != nil {
		t.Fatal(err)
	}
	totpCode, err := auth.GenerateTOTP(enrolment.Secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := twoFactor.FinishEnrolment(ctx, victim.ID, enrolment.EnrolmentID, totpCode); err != nil {
		t.Fatal(err)
	}

	if files, err := os.ReadDir(uploads); err != nil {
		t.Fatal(err)
	} else if len(files) != 1 {
		t.Fatalf("setup: want 1 uploaded file, got %d", len(files))
	}

	if err := admin.DeleteUser(ctx, caller.ID, victim.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	if _, err := store.RefreshTokens.ByHash(ctx, "hash-1"); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("refresh token survived user deletion: %v", err)
	}
	if creds, err := store.Credentials.ListForUser(ctx, victim.ID); err != nil {
		t.Error(err)
	} else if len(creds) != 0 {
		t.Errorf("%d passkey credentials survived user deletion", len(creds))
	}
	if _, err := store.TwoFactor.Get(ctx, victim.ID); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("two-factor secret survived user deletion: %v", err)
	}
	if n, err := store.RecoveryCodes.CountUnused(ctx, victim.ID); err != nil {
		t.Error(err)
	} else if n != 0 {
		t.Errorf("%d recovery codes survived user deletion", n)
	}
	if todos, err := store.Todos.List(ctx, victim.ID, repo.TodoFilter{}); err != nil {
		t.Error(err)
	} else if len(todos) != 0 {
		t.Errorf("%d todos survived user deletion", len(todos))
	}
	if ps, err := store.Projects.List(ctx, victim.ID, ""); err != nil {
		t.Error(err)
	} else if len(ps) != 0 {
		t.Errorf("%d projects survived user deletion", len(ps))
	}
	if cs, err := store.Contexts.List(ctx, victim.ID); err != nil {
		t.Error(err)
	} else if len(cs) != 0 {
		t.Errorf("%d contexts survived user deletion", len(cs))
	}
	if ns, err := store.Notes.List(ctx, victim.ID, nil); err != nil {
		t.Error(err)
	} else if len(ns) != 0 {
		t.Errorf("%d notes survived user deletion", len(ns))
	}
	if tags, err := store.Tags.List(ctx, victim.ID); err != nil {
		t.Error(err)
	} else if len(tags) != 0 {
		t.Errorf("%d tags survived user deletion", len(tags))
	}
	if as, err := store.Attachments.ListForTodo(ctx, victim.ID, first.ID); err != nil {
		t.Error(err)
	} else if len(as) != 0 {
		t.Errorf("%d attachment rows survived user deletion", len(as))
	}
	if files, err := os.ReadDir(uploads); err != nil {
		t.Fatal(err)
	} else if len(files) != 0 {
		t.Errorf("%d uploaded files left on disk after user deletion", len(files))
	}
	if _, err := store.Users.ByID(ctx, victim.ID); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("user row survived deletion: %v", err)
	}
}

// Another user's data must be untouched by the purge.
func TestDeleteUserLeavesOtherAccountsAlone(t *testing.T) {
	todoSvc, store, ctxID := newTodoService(t)
	ctx := context.Background()
	admin := service.NewAdminService(store, nil)

	// The fixture context belongs to user 1; keep a todo in it.
	keeper, err := todoSvc.Create(ctx, 1, service.TodoInput{
		ContextID: &ctxID, Description: strPtr("still mine"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Users.Create(ctx, &domain.User{
		Email: "keeper@example.com", Password: "x", IsAdmin: true,
	}); err != nil {
		t.Fatal(err)
	}
	victim := &domain.User{Email: "victim@example.com", Password: "x"}
	if err := store.Users.Create(ctx, victim); err != nil {
		t.Fatal(err)
	}

	if err := admin.DeleteUser(ctx, 1, victim.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	if _, err := todoSvc.Get(ctx, 1, keeper.ID); err != nil {
		t.Fatalf("another user's todo was purged: %v", err)
	}
}

// A password reset is how a compromised account is taken back; sessions issued
// under the old password must not outlive it.
func TestPasswordResetRevokesRefreshTokens(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	authSvc := newAuthService(t, store)
	admin := service.NewAdminService(store, nil)

	u, pair, err := authSvc.Register(ctx, "alice@example.com", "Old-Passw0rd!", "")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	// The session works before the reset.
	if _, err := authSvc.Refresh(ctx, pair.RefreshToken); err != nil {
		t.Fatalf("setup: refresh should work before the reset: %v", err)
	}
	loggedIn, err := authSvc.AuthenticatePassword(ctx, "alice@example.com", "Old-Passw0rd!")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	pair, err = authSvc.IssueFor(ctx, loggedIn)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	newPassword := "New-Passw0rd!"
	if _, err := admin.UpdateUser(ctx, u.ID, nil, &newPassword, nil); err != nil {
		t.Fatalf("update user: %v", err)
	}

	if _, err := authSvc.Refresh(ctx, pair.RefreshToken); err == nil {
		t.Fatal("refresh token issued before the password reset still works")
	}
	if _, err := authSvc.AuthenticatePassword(ctx, "alice@example.com", "New-Passw0rd!"); err != nil {
		t.Fatalf("new password does not work: %v", err)
	}
}

func TestCreatedUserHasNoKnownInitialPassword(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	authSvc := newAuthService(t, store)
	admin := service.NewAdminService(store, nil)

	u, err := admin.CreateUser(ctx, "invited@example.com", false)
	if err != nil {
		t.Fatal(err)
	}
	if u.Password == "" {
		t.Fatal("the required password column was left empty")
	}
	for _, password := range []string{"password", "Invited-Passw0rd!"} {
		if _, err := authSvc.AuthenticatePassword(ctx, u.Email, password); !errors.Is(err, service.ErrInvalidCredentials) {
			t.Fatalf("created account accepted %q before its invitation: %v", password, err)
		}
	}
}
