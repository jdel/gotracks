package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/mail"
	"github.com/jdel/gotracks/internal/repo"
)

// Email-flow errors.
var (
	// ErrEmailToken covers an unknown, expired or already-used link. One error
	// for all three: telling the difference helps nobody but an attacker.
	ErrEmailToken = errors.New("this link is no longer valid")
	// ErrEmailUnverified is returned when a sign-in is refused pending
	// verification.
	ErrEmailUnverified = errors.New("email address not verified")
)

const (
	kindEmailVerify   = "email-verify"
	kindPasswordReset = "password-reset"

	// verifyTTL is generous: people read mail hours later.
	verifyTTL = 24 * time.Hour
	// resetTTL is short. It is a credential, and a mailbox is not a vault.
	resetTTL = 30 * time.Minute

	// maxLiveTokensPerUser stops repeated requests filling the table.
	maxLiveTokensPerUser = 5
)

// EmailService owns address verification and password reset.
type EmailService struct {
	users     repo.UserRepo
	tokens    repo.EphemeralRepo
	mailer    mail.Mailer
	auth      *AuthService
	baseURL   string
	enforcing bool
}

// NewEmailService builds the service.
//
// enforcing says whether an unverified address blocks sign-in. It is false when
// no mail provider is configured — otherwise a deployment without mail would
// lock out every account it creates, including the first one.
func NewEmailService(
	users repo.UserRepo,
	tokens repo.EphemeralRepo,
	mailer mail.Mailer,
	authSvc *AuthService,
	baseURL string,
	enforcing bool,
) *EmailService {
	return &EmailService{
		users:     users,
		tokens:    tokens,
		mailer:    mailer,
		auth:      authSvc,
		baseURL:   baseURL,
		enforcing: enforcing,
	}
}

// VerificationRequired reports whether unverified accounts are blocked.
func (s *EmailService) VerificationRequired() bool { return s.enforcing }

// CheckVerified gates a sign-in. It returns nil when verification is not being
// enforced, so turning mail off cannot lock anybody out.
func (s *EmailService) CheckVerified(u *domain.User) error {
	if !s.enforcing || u.EmailVerifiedAt != nil {
		return nil
	}
	return ErrEmailUnverified
}

// MarkVerified records an address as proven. Used for the first account, which
// is created before there is any way to send it mail.
func (s *EmailService) MarkVerified(ctx context.Context, u *domain.User) error {
	now := time.Now()
	u.EmailVerifiedAt = &now
	u.UpdatedAt = now
	return s.users.Update(ctx, u)
}

// issueToken stores a single-use token and returns the raw value for the link.
//
// Only a hash is stored. The raw token is a credential for the length of its
// life, and a database copy — a backup, a replica, an errant query — should not
// hand out working reset links.
func (s *EmailService) issueToken(ctx context.Context, kind string, userID int64, ttl time.Duration) (string, error) {
	n, err := s.tokens.CountForUser(ctx, kind, userID)
	if err != nil {
		return "", err
	}
	if n >= maxLiveTokensPerUser {
		// Enough links are already in flight; quietly reuse the allowance
		// rather than letting a repeated request grow the table.
		return "", ErrEmailToken
	}

	raw, err := randomToken()
	if err != nil {
		return "", err
	}
	if err := s.tokens.Put(ctx, &domain.Ephemeral{
		ID:        auth.HashEmailToken(raw),
		Kind:      kind,
		UserID:    userID,
		ExpiresAt: time.Now().Add(ttl),
	}); err != nil {
		return "", err
	}
	return raw, nil
}

// consumeToken redeems a token and returns the account it belongs to.
func (s *EmailService) consumeToken(ctx context.Context, kind, raw string) (*domain.User, error) {
	e, err := s.tokens.Take(ctx, kind, auth.HashEmailToken(raw))
	if err != nil {
		return nil, ErrEmailToken
	}
	u, err := s.users.ByID(ctx, e.UserID)
	if err != nil {
		return nil, ErrEmailToken
	}
	return u, nil
}

func (s *EmailService) link(path, token string) string {
	return fmt.Sprintf("%s%s?token=%s", s.baseURL, path, url.QueryEscape(token))
}

// SendVerification mails a fresh verification link.
func (s *EmailService) SendVerification(ctx context.Context, u *domain.User) error {
	token, err := s.issueToken(ctx, kindEmailVerify, u.ID, verifyTTL)
	if err != nil {
		return err
	}
	href := s.link("/verify-email", token)
	return s.mailer.Send(ctx, mail.Message{
		To:      u.Email,
		Subject: "Confirm your email address",
		Text: "Confirm your email address to finish setting up gotracks:\n\n" + href +
			"\n\nThe link is valid for 24 hours. If you did not create this account, ignore this message.",
		HTML: `<p>Confirm your email address to finish setting up gotracks:</p>` +
			`<p><a href="` + href + `">Confirm my address</a></p>` +
			`<p>The link is valid for 24 hours. If you did not create this account, ignore this message.</p>`,
	})
}

// Verify marks an address proven.
func (s *EmailService) Verify(ctx context.Context, token string) error {
	u, err := s.consumeToken(ctx, kindEmailVerify, token)
	if err != nil {
		return err
	}
	if u.EmailVerifiedAt != nil {
		return nil // already done; a second click is not an error
	}
	return s.MarkVerified(ctx, u)
}

// ResendVerification sends another link.
//
// It reports success whatever happens, so the endpoint cannot be used to find
// out which addresses have accounts. Real failures are logged.
func (s *EmailService) ResendVerification(ctx context.Context, email string) {
	u, err := s.users.ByEmail(ctx, auth.NormaliseEmail(email))
	if err != nil || u.EmailVerifiedAt != nil {
		return
	}
	if err := s.SendVerification(ctx, u); err != nil {
		log.Warn().Err(err).Msg("could not resend a verification mail")
	}
}

// RequestReset mails a password-reset link.
//
// Silent for the same reason: the response must be identical whether or not the
// address is registered.
func (s *EmailService) RequestReset(ctx context.Context, email string) {
	u, err := s.users.ByEmail(ctx, auth.NormaliseEmail(email))
	if err != nil {
		return
	}
	// An SSO account has no local password to reset, and an unverified address
	// has not been proven to belong to whoever is asking.
	if u.Password == oidcPassword || (s.enforcing && u.EmailVerifiedAt == nil) {
		return
	}

	token, err := s.issueToken(ctx, kindPasswordReset, u.ID, resetTTL)
	if err != nil {
		log.Warn().Err(err).Msg("could not issue a password-reset token")
		return
	}
	href := s.link("/reset-password", token)
	if err := s.mailer.Send(ctx, mail.Message{
		To:      u.Email,
		Subject: "Reset your password",
		Text: "Somebody asked to reset the gotracks password for this address:\n\n" + href +
			"\n\nThe link is valid for 30 minutes and can be used once. " +
			"If it was not you, ignore this message — your password has not changed.",
		HTML: `<p>Somebody asked to reset the gotracks password for this address:</p>` +
			`<p><a href="` + href + `">Choose a new password</a></p>` +
			`<p>The link is valid for 30 minutes and can be used once. ` +
			`If it was not you, ignore this message — your password has not changed.</p>`,
	}); err != nil {
		log.Warn().Err(err).Msg("could not send a password-reset mail")
	}
}

// ResetPassword completes a reset.
//
// Using the link proves control of the mailbox, so no current password is
// asked for. SetPassword revokes every existing session, which is the point:
// whoever prompted the reset should be signed out.
func (s *EmailService) ResetPassword(ctx context.Context, token, newPassword string) error {
	// The password is checked before the token is spent, so a rejected
	// password does not cost the user their link.
	if err := auth.ValidatePassword(newPassword); err != nil {
		return err
	}
	u, err := s.consumeToken(ctx, kindPasswordReset, token)
	if err != nil {
		return err
	}
	if _, err := s.auth.SetPassword(ctx, u.ID, newPassword); err != nil {
		return err
	}
	// Reaching the mailbox is itself proof of the address.
	if u.EmailVerifiedAt == nil {
		return s.MarkVerified(ctx, u)
	}
	return nil
}
