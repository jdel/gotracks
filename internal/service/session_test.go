package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// sessionIDOf pulls the session id out of an access token.
func sessionIDOf(t *testing.T, token string) string {
	t.Helper()
	tm := auth.NewTokenManager([]byte("test-secret"), 0, 0)
	claims, err := tm.ParseAccessToken(token)
	if err != nil {
		t.Fatal(err)
	}
	return claims.SessionID
}

// One sign-in is one session that survives the token rotating on refresh: the
// list must show a single session, not a new one per refresh.
func TestRefreshKeepsOneSession(t *testing.T) {
	_, store, _ := newTodoService(t)
	authSvc := newAuthService(t, store)
	ctx := context.Background()

	u, pair, err := authSvc.Register(ctx, "alice@example.com", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	sid := sessionIDOf(t, pair.AccessToken)

	// Refresh a few times; each rotates the token but continues the session.
	for i := 0; i < 3; i++ {
		pair, err = authSvc.Refresh(ctx, pair.RefreshToken)
		if err != nil {
			t.Fatalf("refresh %d: %v", i, err)
		}
		if got := sessionIDOf(t, pair.AccessToken); got != sid {
			t.Fatalf("refresh %d changed the session id: %s -> %s", i, sid, got)
		}
	}

	sessions, err := authSvc.Sessions(ctx, u.ID, sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("rotation produced %d sessions, want 1", len(sessions))
	}
	if !sessions[0].Current {
		t.Error("the caller's own session is not marked current")
	}
}

// A second sign-in is a second session, and the two are told apart.
func TestSecondSignInIsASecondSession(t *testing.T) {
	_, store, _ := newTodoService(t)
	authSvc := newAuthService(t, store)
	ctx := context.Background()

	u, first, err := authSvc.Register(ctx, "alice@example.com", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	// A second device: issue another pair for the same user.
	second, err := authSvc.IssueFor(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	firstID := sessionIDOf(t, first.AccessToken)
	secondID := sessionIDOf(t, second.AccessToken)
	if firstID == secondID {
		t.Fatal("two sign-ins shared a session id")
	}

	sessions, err := authSvc.Sessions(ctx, u.ID, secondID)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 {
		t.Fatalf("two sign-ins produced %d sessions", len(sessions))
	}
	current := 0
	for _, s := range sessions {
		if s.Current {
			current++
			if s.ID != secondID {
				t.Error("the wrong session is marked current")
			}
		}
	}
	if current != 1 {
		t.Errorf("%d sessions marked current, want exactly 1", current)
	}
}

// Revoking a session kills only that one, and revoking one you do not own does
// nothing to it.
func TestRevokeSession(t *testing.T) {
	_, store, _ := newTodoService(t)
	authSvc := newAuthService(t, store)
	ctx := context.Background()

	u, first, err := authSvc.Register(ctx, "alice@example.com", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := authSvc.IssueFor(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	firstID := sessionIDOf(t, first.AccessToken)

	// Revoke the first from the second's perspective.
	if err := authSvc.RevokeSession(ctx, u.ID, firstID); err != nil {
		t.Fatal(err)
	}
	// The revoked session's refresh token no longer works.
	if _, err := authSvc.Refresh(ctx, first.RefreshToken); err == nil {
		t.Error("a revoked session could still refresh")
	}
	// The other session is untouched.
	if _, err := authSvc.Refresh(ctx, second.RefreshToken); err != nil {
		t.Errorf("revoking one session broke another: %v", err)
	}

	// A session id belonging to nobody, or another user, must not delete rows.
	other, _, err := authSvc.Register(ctx, "bob@example.com", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	otherPair, err := authSvc.IssueFor(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	otherID := sessionIDOf(t, otherPair.AccessToken)
	// Alice tries to revoke Bob's session — scoped to her id, so it is a no-op.
	if err := authSvc.RevokeSession(ctx, u.ID, otherID); err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.Refresh(ctx, otherPair.RefreshToken); err != nil {
		t.Errorf("one user revoked another's session: %v", err)
	}
}

// "Sign out everywhere else" keeps the caller's own session and drops the rest.
func TestRevokeOtherSessions(t *testing.T) {
	_, store, _ := newTodoService(t)
	authSvc := newAuthService(t, store)
	ctx := context.Background()

	u, keep, err := authSvc.Register(ctx, "alice@example.com", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	drop1, _ := authSvc.IssueFor(ctx, u)
	drop2, _ := authSvc.IssueFor(ctx, u)
	keepID := sessionIDOf(t, keep.AccessToken)

	if err := authSvc.RevokeOtherSessions(ctx, u.ID, keepID); err != nil {
		t.Fatal(err)
	}
	sessions, err := authSvc.Sessions(ctx, u.ID, keepID)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].ID != keepID {
		t.Fatalf("sign-out-elsewhere left %d sessions, want only the current one", len(sessions))
	}
	if _, err := authSvc.Refresh(ctx, keep.RefreshToken); err != nil {
		t.Errorf("the kept session was revoked: %v", err)
	}
	for i, d := range []*service.TokenPair{drop1, drop2} {
		if _, err := authSvc.Refresh(ctx, d.RefreshToken); err == nil {
			t.Errorf("dropped session %d could still refresh", i)
		}
	}
}

// SR-12: a stateless access token must stop authorizing the moment its session
// is revoked, not linger until the JWT expires. CurrentUser is the access-path
// check RequireAuth runs on every request, so revocation has to bite here.
func TestCurrentUserRejectsRevokedSession(t *testing.T) {
	_, store, _ := newTodoService(t)
	authSvc := newAuthService(t, store)
	ctx := context.Background()

	u, first, err := authSvc.Register(ctx, "alice@example.com", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	// A second live session proves revocation is per-session, not per-user.
	second, err := authSvc.IssueFor(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	firstID := sessionIDOf(t, first.AccessToken)
	secondID := sessionIDOf(t, second.AccessToken)

	// A live session authorizes.
	if _, err := authSvc.CurrentUser(ctx, u.ID, firstID); err != nil {
		t.Fatalf("live session rejected: %v", err)
	}

	// Revoke the first; its access token must now be rejected immediately.
	if err := authSvc.RevokeSession(ctx, u.ID, firstID); err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.CurrentUser(ctx, u.ID, firstID); !errors.Is(err, service.ErrSessionRevoked) {
		t.Fatalf("revoked session access = %v, want ErrSessionRevoked", err)
	}
	// The other session is untouched.
	if _, err := authSvc.CurrentUser(ctx, u.ID, secondID); err != nil {
		t.Errorf("revoking one session blocked another: %v", err)
	}
	// An empty session id (a token minted before sessions existed) fails closed.
	if _, err := authSvc.CurrentUser(ctx, u.ID, ""); !errors.Is(err, service.ErrSessionRevoked) {
		t.Errorf("empty session id access = %v, want ErrSessionRevoked", err)
	}
}

// The device is remembered from sign-in and reflects the latest refresh, so a
// session shows a recognisable address and browser.
func TestSessionRecordsDevice(t *testing.T) {
	_, store, _ := newTodoService(t)
	authSvc := newAuthService(t, store)
	ctx := service.WithSessionMeta(context.Background(), service.SessionMeta{
		IP: "203.0.113.5", UserAgent: "Firefox on Linux",
	})

	u, pair, err := authSvc.Register(ctx, "alice@example.com", "Str0ng!Passw0rd", "")
	if err != nil {
		t.Fatal(err)
	}
	sid := sessionIDOf(t, pair.AccessToken)
	sessions, err := authSvc.Sessions(ctx, u.ID, sid)
	if err != nil {
		t.Fatal(err)
	}
	if sessions[0].IP != "203.0.113.5" || sessions[0].UserAgent != "Firefox on Linux" {
		t.Errorf("device not recorded: %+v", sessions[0])
	}

	// A refresh that carries no headers keeps the recognisable device rather
	// than blanking it.
	if _, err := authSvc.Refresh(context.Background(), pair.RefreshToken); err != nil {
		t.Fatal(err)
	}
	sessions, _ = authSvc.Sessions(ctx, u.ID, sid)
	if sessions[0].IP != "203.0.113.5" {
		t.Errorf("a headerless refresh blanked the device: %+v", sessions[0])
	}
	_ = domain.AuditSessionRevoked
}
