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

// The admin user list pages and filters in the database, so the whole table is
// never loaded and the filters see every match, not just one page.
func TestListUsersFiltersAndPages(t *testing.T) {
	_, store, _ := newTodoService(t)
	admin := service.NewAdminService(store, nil)
	ctx := context.Background()

	mk := func(email string, isAdmin, twoFA bool) {
		u := &domain.User{Email: email, Password: "x", IsAdmin: isAdmin}
		if err := store.Users.Create(ctx, u); err != nil {
			t.Fatal(err)
		}
		if twoFA {
			if err := store.TwoFactor.Upsert(ctx, &domain.TwoFactor{UserID: u.ID, Enabled: true, Secret: "s"}); err != nil {
				t.Fatal(err)
			}
		}
	}
	mk("root@example.com", true, true)
	mk("alice@example.com", false, false)
	mk("bob@corp.test", false, true)
	mk("carol@example.com", false, false)

	// 4 accounts, page size 2: two pages of two, total reported as four.
	p1, err := admin.ListUsers(ctx, repo.UserFilter{}, service.Page{Number: 1, Size: 2})
	if err != nil {
		t.Fatal(err)
	}
	if p1.Total != 4 || len(p1.Users) != 2 {
		t.Fatalf("page 1: total=%d n=%d, want 4 and 2", p1.Total, len(p1.Users))
	}
	p2, _ := admin.ListUsers(ctx, repo.UserFilter{}, service.Page{Number: 2, Size: 2})
	if len(p2.Users) != 2 || p2.Users[0].ID == p1.Users[0].ID {
		t.Fatalf("page 2 did not advance: %+v", p2.Users)
	}

	// Filters count every match, not just the current page.
	byEmail, _ := admin.ListUsers(ctx, repo.UserFilter{Search: "CORP"}, service.Page{})
	if byEmail.Total != 1 || byEmail.Users[0].Email != "bob@corp.test" {
		t.Fatalf("search: total=%d, want 1 (bob)", byEmail.Total)
	}
	admins, _ := admin.ListUsers(ctx, repo.UserFilter{Admin: "on"}, service.Page{})
	if admins.Total != 1 || !admins.Users[0].IsAdmin {
		t.Fatalf("admin filter: total=%d, want 1 admin", admins.Total)
	}
	on, _ := admin.ListUsers(ctx, repo.UserFilter{TwoFactor: "on"}, service.Page{})
	off, _ := admin.ListUsers(ctx, repo.UserFilter{TwoFactor: "off"}, service.Page{})
	if on.Total != 2 || off.Total != 2 {
		t.Fatalf("2fa split: on=%d off=%d, want 2 and 2", on.Total, off.Total)
	}
}

// Deleting an account must take everything private to it. Nothing cascades in
// the schema, so anything missed here outlives the account it belonged to.
func TestDeleteUserPurgesEverythingItOwned(t *testing.T) {
	todoSvc, store, _ := newTodoService(t)
	ctx := context.Background()

	blobs, uploads := testStoreDir(t)
	attachments := service.NewAttachmentService(store.Attachments, store.Todos, blobs, 1<<20)
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

	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
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
	if _, err := store.LoginAttempts.RecordFailure(ctx, victim.Email, time.Minute, 10); err != nil {
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
	if _, err := store.LoginAttempts.Get(ctx, victim.Email); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("login-attempt history survived user deletion: %v", err)
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

func TestDeleteOwnAccountPreservesLastAdmin(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	admin := service.NewAdminService(store, nil)

	u := &domain.User{Email: "root@example.com", Password: "x", IsAdmin: true}
	if err := store.Users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}
	if err := admin.DeleteOwnAccount(ctx, u.ID); !errors.Is(err, service.ErrLastAdmin) {
		t.Fatalf("delete last admin = %v, want ErrLastAdmin", err)
	}
	if _, err := store.Users.ByID(ctx, u.ID); err != nil {
		t.Fatalf("last admin was deleted: %v", err)
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
