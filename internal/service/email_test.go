package service_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/mail"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// captureMailer records what would have been sent.
type captureMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (m *captureMailer) Name() string { return "capture" }

func (m *captureMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

func (m *captureMailer) last() (mail.Message, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		return mail.Message{}, false
	}
	return m.sent[len(m.sent)-1], true
}

func (m *captureMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

func emailFixture(t *testing.T, enforcing bool) (*service.EmailService, *service.AuthService, *repo.Store, *captureMailer) {
	t.Helper()
	_, store, _ := newTodoService(t)
	authSvc := newAuthService(t, store)
	m := &captureMailer{}
	svc := service.NewEmailService(store.Users, store.Ephemeral, m, authSvc,
		"https://tracks.example.com", enforcing)
	return svc, authSvc, store, m
}

// tokenFrom pulls the token out of the link in the mail body.
func tokenFrom(t *testing.T, body string) string {
	t.Helper()
	i := strings.Index(body, "token=")
	if i < 0 {
		t.Fatalf("no token in the message:\n%s", body)
	}
	tok := body[i+len("token="):]
	if j := strings.IndexAny(tok, "\n \""); j >= 0 {
		tok = tok[:j]
	}
	return tok
}

const emailPassword = "Str0ng!Passw0rd"

func TestVerificationRoundTrip(t *testing.T) {
	svc, authSvc, store, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, err := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	if err != nil {
		t.Fatal(err)
	}

	// Unverified: sign-in is refused.
	if err := svc.CheckVerified(u); !errors.Is(err, service.ErrEmailUnverified) {
		t.Fatalf("an unverified account was let in: %v", err)
	}
	if err := svc.SendVerification(ctx, u); err != nil {
		t.Fatal(err)
	}
	msg, ok := m.last()
	if !ok {
		t.Fatal("no verification mail was sent")
	}
	if !strings.Contains(msg.Text, "https://tracks.example.com/verify-email?token=") {
		t.Fatalf("the link is not absolute:\n%s", msg.Text)
	}

	if err := svc.Verify(ctx, tokenFrom(t, msg.Text)); err != nil {
		t.Fatalf("verify: %v", err)
	}
	fresh, err := store.Users.ByID(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.EmailVerifiedAt == nil {
		t.Fatal("the address was not marked verified")
	}
	if err := svc.CheckVerified(fresh); err != nil {
		t.Fatalf("a verified account was still refused: %v", err)
	}
}

// A link is a credential: it must work once.
func TestVerificationTokenIsSingleUse(t *testing.T) {
	svc, authSvc, _, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	_ = svc.SendVerification(ctx, u)
	msg, _ := m.last()
	token := tokenFrom(t, msg.Text)

	if err := svc.Verify(ctx, token); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verify(ctx, token); !errors.Is(err, service.ErrEmailToken) {
		t.Fatalf("a spent verification link worked again: %v", err)
	}
}

func TestUnknownTokensAreRejected(t *testing.T) {
	svc, _, _, _ := emailFixture(t, true)
	ctx := context.Background()

	if err := svc.Verify(ctx, "made-up"); !errors.Is(err, service.ErrEmailToken) {
		t.Errorf("verify accepted an unknown token: %v", err)
	}
	if err := svc.ResetPassword(ctx, "made-up", emailPassword); !errors.Is(err, service.ErrEmailToken) {
		t.Errorf("reset accepted an unknown token: %v", err)
	}
}

// Only a hash is stored, so a database copy yields no working links.
func TestTokensAreStoredHashed(t *testing.T) {
	svc, authSvc, store, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	_ = svc.SendVerification(ctx, u)
	msg, _ := m.last()
	token := tokenFrom(t, msg.Text)

	// The raw token must not be usable as the stored key.
	if _, err := store.Ephemeral.Peek(ctx, "email-verify", token); !errors.Is(err, repo.ErrNotFound) {
		t.Error("the raw token is stored verbatim; a leaked database would hand out working links")
	}
	if _, err := store.Ephemeral.Peek(ctx, "email-verify", auth.HashEmailToken(token)); err != nil {
		t.Errorf("the hashed token is not stored: %v", err)
	}
}

func TestPasswordResetRoundTrip(t *testing.T) {
	svc, authSvc, _, m := emailFixture(t, true)
	ctx := context.Background()
	u, first, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	if err := svc.MarkVerified(ctx, u); err != nil {
		t.Fatal(err)
	}

	svc.RequestReset(ctx, "alice@example.com")
	msg, ok := m.last()
	if !ok {
		t.Fatal("no reset mail was sent")
	}
	const newPassword = "N3w!Passw0rd-x"
	if err := svc.ResetPassword(ctx, tokenFrom(t, msg.Text), newPassword); err != nil {
		t.Fatalf("reset: %v", err)
	}

	if _, err := authSvc.AuthenticatePassword(ctx, "alice@example.com", newPassword); err != nil {
		t.Fatalf("the new password does not work: %v", err)
	}
	if _, err := authSvc.AuthenticatePassword(ctx, "alice@example.com", emailPassword); !errors.Is(err, service.ErrInvalidCredentials) {
		t.Error("the old password still works after a reset")
	}
	// A reset is how someone evicts whoever prompted it.
	if _, err := authSvc.Refresh(ctx, first.RefreshToken); !errors.Is(err, service.ErrInvalidRefresh) {
		t.Error("existing sessions survived a password reset")
	}
}

func TestResetTokenIsSingleUse(t *testing.T) {
	svc, authSvc, _, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	_ = svc.MarkVerified(ctx, u)
	svc.RequestReset(ctx, "alice@example.com")
	token := tokenFrom(t, mustLast(t, m).Text)

	if err := svc.ResetPassword(ctx, token, "N3w!Passw0rd-x"); err != nil {
		t.Fatal(err)
	}
	if err := svc.ResetPassword(ctx, token, "An0ther!Passw0rd"); !errors.Is(err, service.ErrEmailToken) {
		t.Fatalf("a spent reset link worked again: %v", err)
	}
}

// A weak password must be refused before the token is spent, or the user is
// left with a dead link and no way in.
func TestWeakPasswordDoesNotBurnTheResetToken(t *testing.T) {
	svc, authSvc, _, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	_ = svc.MarkVerified(ctx, u)
	svc.RequestReset(ctx, "alice@example.com")
	token := tokenFrom(t, mustLast(t, m).Text)

	if err := svc.ResetPassword(ctx, token, "weak"); !errors.Is(err, auth.ErrWeakPassword) {
		t.Fatalf("want ErrWeakPassword, got %v", err)
	}
	if err := svc.ResetPassword(ctx, token, "N3w!Passw0rd-x"); err != nil {
		t.Fatalf("the link was consumed by the rejected attempt: %v", err)
	}
}

// The endpoints must not reveal which addresses have accounts.
func TestResetAndResendAreSilentForUnknownAddresses(t *testing.T) {
	svc, _, _, m := emailFixture(t, true)
	ctx := context.Background()

	svc.RequestReset(ctx, "nobody@example.com")
	svc.ResendVerification(ctx, "nobody@example.com")
	if m.count() != 0 {
		t.Errorf("%d messages sent for an address with no account", m.count())
	}
}

// An SSO account has no local password, so there is nothing to reset and a
// mail would only be confusing.
func TestNoResetForSSOAccounts(t *testing.T) {
	svc, authSvc, _, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, err := authSvc.LoginOIDC(ctx, &auth.OIDCUser{Subject: "s", Email: "bob@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	_ = svc.MarkVerified(ctx, u)

	svc.RequestReset(ctx, "bob@example.com")
	if m.count() != 0 {
		t.Error("a reset mail was sent for an SSO-only account")
	}
}

// With no mail provider, verification must not be enforced — otherwise a
// deployment refuses every sign-in for accounts it just created.
func TestVerificationNotEnforcedWithoutMail(t *testing.T) {
	svc, authSvc, _, _ := emailFixture(t, false)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")

	if svc.VerificationRequired() {
		t.Fatal("verification is enforced with no provider configured")
	}
	if err := svc.CheckVerified(u); err != nil {
		t.Fatalf("an unverified account was refused with mail disabled: %v", err)
	}
}

// Completing a reset proves the mailbox, so the address counts as verified.
func TestResetVerifiesTheAddress(t *testing.T) {
	svc, authSvc, store, m := emailFixture(t, false)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")

	svc.RequestReset(ctx, "alice@example.com")
	if err := svc.ResetPassword(ctx, tokenFrom(t, mustLast(t, m).Text), "N3w!Passw0rd-x"); err != nil {
		t.Fatal(err)
	}
	fresh, _ := store.Users.ByID(ctx, u.ID)
	if fresh.EmailVerifiedAt == nil {
		t.Error("completing a reset did not verify the address")
	}
}

func mustLast(t *testing.T, m *captureMailer) mail.Message {
	t.Helper()
	msg, ok := m.last()
	if !ok {
		t.Fatal("no message was sent")
	}
	return msg
}
