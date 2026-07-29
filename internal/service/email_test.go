package service_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

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
	authSvc.SetEnrollments(store.Enrollments)
	authSvc.SetPreferences(store.Preferences)
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
	if _, err := svc.RedeemAccountDeletion(ctx, "made-up"); !errors.Is(err, service.ErrEmailToken) {
		t.Errorf("account deletion accepted an unknown token: %v", err)
	}
}

func TestAccountDeletionEmailRoundTrip(t *testing.T) {
	svc, authSvc, store, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, err := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.SendAccountDeletion(ctx, u.ID); err != nil {
		t.Fatalf("send deletion email: %v", err)
	}
	msg := mustLast(t, m)
	if msg.To != u.Email || msg.Subject != "Confirm your gotracks account deletion" {
		t.Fatalf("unexpected deletion message: %#v", msg)
	}
	if !strings.Contains(msg.Text, "https://tracks.example.com/delete-account?token=") {
		t.Fatalf("the deletion link is not absolute:\n%s", msg.Text)
	}
	if !strings.Contains(msg.Text, "permanently delete") || !strings.Contains(msg.Text, "cannot be recovered") {
		t.Fatalf("the deletion message does not explain the irreversible loss:\n%s", msg.Text)
	}

	token := tokenFrom(t, msg.Text)
	stored, err := store.Ephemeral.Peek(ctx, "account-deletion", auth.HashEmailToken(token))
	if err != nil {
		t.Fatalf("deletion token was not persisted: %v", err)
	}
	remaining := time.Until(stored.ExpiresAt)
	if remaining < 29*time.Minute || remaining > 31*time.Minute {
		t.Fatalf("deletion token lifetime = %v, want 30m", remaining)
	}

	userID, err := svc.RedeemAccountDeletion(ctx, token)
	if err != nil {
		t.Fatalf("redeem deletion token: %v", err)
	}
	if userID != u.ID {
		t.Fatalf("redeemed user = %d, want %d", userID, u.ID)
	}
	if _, err := svc.RedeemAccountDeletion(ctx, token); !errors.Is(err, service.ErrEmailToken) {
		t.Fatalf("a spent deletion link worked again: %v", err)
	}
}

func TestEmailChangeWaitsForNewAddressVerification(t *testing.T) {
	svc, authSvc, store, m := emailFixture(t, true)
	ctx := context.Background()
	u, pair, err := authSvc.Register(ctx, "old@example.com", emailPassword, "")
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.SendEmailChange(ctx, u.ID, "  NEW@Example.com "); err != nil {
		t.Fatalf("send email change: %v", err)
	}
	msg := mustLast(t, m)
	if msg.To != "new@example.com" || msg.Subject != "Confirm your new gotracks email address" {
		t.Fatalf("unexpected email-change message: %#v", msg)
	}
	if !strings.Contains(msg.Text, "https://tracks.example.com/change-email?token=") {
		t.Fatalf("the email-change link is not absolute:\n%s", msg.Text)
	}
	if _, err := store.Users.ByEmail(ctx, "old@example.com"); err != nil {
		t.Fatalf("the old email changed before verification: %v", err)
	}

	token := tokenFrom(t, msg.Text)
	stored, err := store.Ephemeral.Peek(ctx, "email-change", auth.HashEmailToken(token))
	if err != nil {
		t.Fatalf("email-change token was not persisted: %v", err)
	}
	if string(stored.Payload) != "new@example.com" {
		t.Fatalf("stored new email = %q", stored.Payload)
	}

	if err := svc.ConfirmEmailChange(ctx, token); err != nil {
		t.Fatalf("confirm email change: %v", err)
	}
	if _, err := store.Users.ByEmail(ctx, "new@example.com"); err != nil {
		t.Fatalf("new email was not saved: %v", err)
	}
	if _, err := store.Users.ByEmail(ctx, "old@example.com"); !errors.Is(err, repo.ErrNotFound) {
		t.Fatalf("old email still resolves: %v", err)
	}
	if _, err := authSvc.Refresh(ctx, pair.RefreshToken); !errors.Is(err, service.ErrInvalidRefresh) {
		t.Fatalf("existing session survived email change: %v", err)
	}
	if got := mustLast(t, m); got.To != "old@example.com" || !strings.Contains(got.Text, "changed to new@example.com") {
		t.Fatalf("old address was not notified: %#v", got)
	}
	if err := svc.ConfirmEmailChange(ctx, token); !errors.Is(err, service.ErrEmailToken) {
		t.Fatalf("a spent email-change link worked again: %v", err)
	}
}

func TestEmailChangeRejectsAnAddressAlreadyInUse(t *testing.T) {
	svc, authSvc, _, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "old@example.com", emailPassword, "")
	_, _, _ = authSvc.Register(ctx, "taken@example.com", emailPassword, "")

	if err := svc.SendEmailChange(ctx, u.ID, "taken@example.com"); !errors.Is(err, service.ErrEmailTaken) {
		t.Fatalf("duplicate email change = %v, want ErrEmailTaken", err)
	}
	if m.count() != 0 {
		t.Fatalf("sent %d messages for a duplicate address", m.count())
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

// A reset link is a credential, so its lifetime is part of what makes it safe
// to put in a mailbox: an old message must not still open the account.
func TestExpiredResetTokenIsRefused(t *testing.T) {
	svc, authSvc, store, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, _ := authSvc.Register(ctx, "alice@example.com", emailPassword, "")
	_ = svc.MarkVerified(ctx, u)
	svc.RequestReset(ctx, "alice@example.com")
	token := tokenFrom(t, mustLast(t, m).Text)

	stored, err := store.Ephemeral.Peek(ctx, "password-reset", auth.HashEmailToken(token))
	if err != nil {
		t.Fatalf("no stored reset token: %v", err)
	}
	stored.ExpiresAt = time.Now().Add(-time.Minute)
	if err := store.Ephemeral.ReplaceForUser(ctx, stored); err != nil {
		t.Fatal(err)
	}

	if err := svc.ResetPassword(ctx, token, "N3w!Passw0rd-x"); !errors.Is(err, service.ErrEmailToken) {
		t.Fatalf("an expired reset link was accepted: %v", err)
	}
	if _, err := authSvc.AuthenticatePassword(ctx, "alice@example.com", emailPassword); err != nil {
		t.Errorf("the original password stopped working: %v", err)
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

func TestInvitationSetsPasswordAndVerifiesAddress(t *testing.T) {
	svc, authSvc, store, m := emailFixture(t, true)
	ctx := context.Background()
	admin := service.NewAdminService(store, nil)
	u, err := admin.CreateUser(ctx, "invited@example.com", false)
	if err != nil {
		t.Fatal(err)
	}
	if u.EmailVerifiedAt != nil {
		t.Fatal("a new invitation was already verified")
	}
	if err := svc.SendInvitation(ctx, u); err != nil {
		t.Fatal(err)
	}
	msg := mustLast(t, m)
	if !strings.Contains(msg.Text, "https://tracks.example.com/accept-invitation?token=") {
		t.Fatalf("the invitation link is not absolute:\n%s", msg.Text)
	}
	if !strings.Contains(msg.Text, "valid for 48 hours") {
		t.Fatalf("the invitation does not advertise the 48-hour lifetime:\n%s", msg.Text)
	}
	stored, err := store.Ephemeral.Peek(ctx, "user-invitation", auth.HashEmailToken(tokenFrom(t, msg.Text)))
	if err != nil {
		t.Fatalf("invitation was not persisted: %v", err)
	}
	remaining := time.Until(stored.ExpiresAt)
	if remaining < 47*time.Hour || remaining > 48*time.Hour {
		t.Fatalf("invitation lifetime = %v, want 48h", remaining)
	}

	const password = "Invited-Passw0rd!"
	activated, err := svc.AcceptInvitation(ctx, tokenFrom(t, msg.Text), password)
	if err != nil {
		t.Fatalf("accept invitation: %v", err)
	}
	if activated.ID != u.ID || activated.EmailVerifiedAt == nil {
		t.Fatalf("activated account = %#v", activated)
	}
	fresh, err := store.Users.ByID(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.EmailVerifiedAt == nil {
		t.Fatal("accepting the invitation did not verify the address")
	}
	if _, err := authSvc.AuthenticatePassword(ctx, u.Email, password); err != nil {
		t.Fatalf("the invited user cannot sign in: %v", err)
	}
}

func TestPublicEnrollmentCreatesUserOnlyAfterMailboxProof(t *testing.T) {
	svc, _, store, m := emailFixture(t, true)
	ctx := context.Background()

	if _, err := svc.Enroll(
		ctx, "new@example.com", "fr", "Europe/Paris",
	); err != nil {
		t.Fatal(err)
	}
	if count, err := store.Users.Count(ctx); err != nil || count != 0 {
		t.Fatalf("users before mailbox proof = %d, %v; want 0", count, err)
	}
	msg := mustLast(t, m)
	u, err := svc.AcceptInvitation(ctx, tokenFrom(t, msg.Text), "Invited-Passw0rd!")
	if err != nil {
		t.Fatalf("accept public enrollment: %v", err)
	}
	if !u.IsAdmin || u.EmailVerifiedAt == nil {
		t.Fatalf("first activated account = %#v", u)
	}
	prefs := service.NewPreferenceService(store.Preferences)
	p, err := prefs.Get(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p.Locale != "fr" {
		t.Fatalf("enrollment locale = %q, want fr", p.Locale)
	}
	if p.TimeZone != "Europe/Paris" {
		t.Fatalf("enrollment timezone = %q, want Europe/Paris", p.TimeZone)
	}
}

func TestFirstEnrollmentNeedsNoSecretButProvesMailbox(t *testing.T) {
	svc, _, store, m := emailFixture(t, true)
	ctx := context.Background()

	// The first account on an empty instance registers with no secret at all,
	// but still only exists once the mailbox is proven.
	if _, err := svc.Enroll(ctx, "root@example.com", "en", "UTC"); err != nil {
		t.Fatalf("first enrollment: %v", err)
	}
	if count, err := store.Users.Count(ctx); err != nil || count != 0 {
		t.Fatalf("users before mailbox proof = %d, %v; want 0", count, err)
	}
	if m.count() != 1 {
		t.Fatalf("first enrollment sent %d messages, want 1", m.count())
	}
}

// The public register endpoint must not become a way to flood one mailbox: a
// second invitation to the same address inside the cooldown is suppressed, with
// no extra mail and the same outward result.
func TestInvitationThrottlePerAddress(t *testing.T) {
	svc, _, _, m := emailFixture(t, true)
	ctx := context.Background()

	if out, err := svc.Enroll(ctx, "target@example.com", "en", "UTC"); err != nil || out != service.EnrollPending {
		t.Fatalf("first enroll = %v, %v; want EnrollPending", out, err)
	}
	if out, err := svc.Enroll(ctx, "target@example.com", "en", "UTC"); err != nil || out != service.EnrollThrottled {
		t.Fatalf("repeat enroll = %v, %v; want EnrollThrottled", out, err)
	}
	if m.count() != 1 {
		t.Fatalf("messages sent = %d, want 1 (the duplicate was suppressed)", m.count())
	}

	// A different address is not affected by another's cooldown.
	if out, err := svc.Enroll(ctx, "other@example.com", "en", "UTC"); err != nil || out != service.EnrollPending {
		t.Fatalf("other enroll = %v, %v; want EnrollPending", out, err)
	}
	if m.count() != 2 {
		t.Fatalf("messages sent = %d, want 2", m.count())
	}
}

// Only the first account activated on an empty instance is the administrator;
// a second enrollment begun in the same empty window still activates, but as an
// ordinary user.
func TestOnlyFirstActivatedAccountIsAdmin(t *testing.T) {
	svc, _, _, m := emailFixture(t, true)
	ctx := context.Background()
	if _, err := svc.Enroll(ctx, "first@example.com", "en", "UTC"); err != nil {
		t.Fatal(err)
	}
	first := tokenFrom(t, mustLast(t, m).Text)
	if _, err := svc.Enroll(ctx, "second@example.com", "en", "UTC"); err != nil {
		t.Fatal(err)
	}
	second := tokenFrom(t, mustLast(t, m).Text)

	a, err := svc.AcceptInvitation(ctx, first, "Invited-Passw0rd!")
	if err != nil {
		t.Fatal(err)
	}
	if !a.IsAdmin || a.Email != "first@example.com" {
		t.Fatalf("first activated account = %#v, want admin first@example.com", a)
	}
	b, err := svc.AcceptInvitation(ctx, second, "Invited-Passw0rd!")
	if err != nil {
		t.Fatal(err)
	}
	if b.IsAdmin {
		t.Fatalf("second activated account = %#v, want non-admin", b)
	}
}

func TestDisabledPublicEnrollmentDoesNotBlockAdminInvitations(t *testing.T) {
	svc, _, store, m := emailFixture(t, true)
	ctx := context.Background()
	if _, err := svc.Enroll(ctx, "root@example.com", "en", "UTC"); err != nil {
		t.Fatalf("first enrollment: %v", err)
	}
	if _, err := svc.AcceptInvitation(
		ctx, tokenFrom(t, mustLast(t, m).Text), "R00t-Passw0rd!",
	); err != nil {
		t.Fatalf("activate first account: %v", err)
	}
	settings := service.NewSettingsService(store.Settings, true)
	if _, err := settings.SetAllowRegister(ctx, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Enroll(ctx, "public@example.com", "en", "UTC"); !errors.Is(err, service.ErrRegisterDisabled) {
		t.Fatalf("public enrollment while disabled = %v, want ErrRegisterDisabled", err)
	}

	admin := service.NewAdminService(store, nil)
	u, err := admin.CreateUser(ctx, "invited@example.com", false)
	if err != nil {
		t.Fatalf("admin invitation was blocked with public enrollment: %v", err)
	}
	if err := svc.SendInvitation(ctx, u); err != nil {
		t.Fatal(err)
	}
	if m.count() != 2 {
		t.Fatalf("sent messages = %d, want first-user and admin invitations", m.count())
	}
}

func TestPublicEnrollmentDoesNotInviteAnActiveAccount(t *testing.T) {
	svc, authSvc, _, m := emailFixture(t, true)
	ctx := context.Background()
	u, _, err := authSvc.Register(ctx, "active@example.com", emailPassword, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkVerified(ctx, u); err != nil {
		t.Fatal(err)
	}

	svc.RequestInvitation(ctx, u.Email)
	if m.count() != 0 {
		t.Fatal("public enrollment sent a password-setting invitation to an active account")
	}
}

func TestInvitationIsSingleUseAndWeakPasswordDoesNotBurnIt(t *testing.T) {
	svc, _, store, m := emailFixture(t, true)
	ctx := context.Background()
	admin := service.NewAdminService(store, nil)
	u, err := admin.CreateUser(ctx, "invited@example.com", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SendInvitation(ctx, u); err != nil {
		t.Fatal(err)
	}
	token := tokenFrom(t, mustLast(t, m).Text)

	if _, err := svc.AcceptInvitation(ctx, token, "weak"); !errors.Is(err, auth.ErrWeakPassword) {
		t.Fatalf("want ErrWeakPassword, got %v", err)
	}
	if _, err := svc.AcceptInvitation(ctx, token, "Invited-Passw0rd!"); err != nil {
		t.Fatalf("the rejected password consumed the invitation: %v", err)
	}
	if _, err := svc.AcceptInvitation(ctx, token, "An0ther-Passw0rd!"); !errors.Is(err, service.ErrEmailToken) {
		t.Fatalf("a spent invitation worked again: %v", err)
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
