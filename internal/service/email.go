package service

import (
	"context"
	"errors"
	"fmt"
	"html"
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
	// ErrEmailVerified prevents an invitation from becoming an admin-triggered
	// password reset for an already active account.
	ErrEmailVerified = errors.New("email address already verified")
)

const (
	kindEmailVerify   = "email-verify"
	kindPasswordReset = "password-reset"
	kindInvitation    = "user-invitation"
	kindAccountDelete = "account-deletion"
	kindEmailChange   = "email-change"

	// verifyTTL is generous: people read mail hours later.
	verifyTTL = 24 * time.Hour
	// resetTTL is short. It is a credential, and a mailbox is not a vault.
	resetTTL = 30 * time.Minute
	// Invitations may be sent well before somebody checks their mailbox.
	invitationTTL = 48 * time.Hour
	// Account-deletion links authorize an irreversible operation and should not
	// remain useful in an old inbox for long.
	accountDeletionTTL = 30 * time.Minute
	// Changing an address requires proving control of the new mailbox.
	emailChangeTTL = 24 * time.Hour

	// maxLiveTokensPerUser stops repeated requests filling the table.
	maxLiveTokensPerUser = 5
)

// EmailService owns address verification, invitations and password reset.
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
	return s.issueTokenWithPayload(ctx, kind, userID, ttl, nil)
}

func (s *EmailService) issueTokenWithPayload(ctx context.Context, kind string, userID int64, ttl time.Duration, payload []byte) (string, error) {
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
		Payload:   payload,
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

// SendInvitation lets an administrator invite a pending account to choose its
// own password. Unlike a password reset, this is only valid before the address
// has been verified.
func (s *EmailService) SendInvitation(ctx context.Context, u *domain.User) error {
	if u.EmailVerifiedAt != nil {
		return ErrEmailVerified
	}
	token, err := s.issueToken(ctx, kindInvitation, u.ID, invitationTTL)
	if err != nil {
		return err
	}
	href := s.link("/accept-invitation", token)
	return s.mailer.Send(ctx, mail.Message{
		To:      u.Email,
		Subject: "Your gotracks invitation",
		Text: "You have been invited to gotracks. Choose your password to activate your account:\n\n" + href +
			"\n\nThe link is valid for 48 hours and can be used once. If you were not expecting this invitation, ignore this message.",
		HTML: `<p>You have been invited to gotracks.</p>` +
			`<p><a href="` + href + `">Choose my password</a></p>` +
			`<p>The link is valid for 48 hours and can be used once. If you were not expecting this invitation, ignore this message.</p>`,
	})
}

// RequestInvitation resends enrollment mail without revealing whether the
// address exists. It is used by the public endpoint when somebody enrolls an
// already-pending address.
func (s *EmailService) RequestInvitation(ctx context.Context, email string) {
	u, err := s.users.ByEmail(ctx, auth.NormaliseEmail(email))
	if err != nil || u.EmailVerifiedAt != nil {
		return
	}
	if err := s.SendInvitation(ctx, u); err != nil {
		log.Warn().Err(err).Msg("could not resend an invitation")
	}
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

// SendAccountDeletion mails a single-use link for the signed-in account to
// confirm its irreversible deletion. The authenticated endpoint supplies the
// user ID; the destination address is always loaded from the account and can
// therefore not be redirected by request input.
func (s *EmailService) SendAccountDeletion(ctx context.Context, userID int64) error {
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return err
	}
	token, err := s.issueToken(ctx, kindAccountDelete, userID, accountDeletionTTL)
	if err != nil {
		return err
	}
	href := s.link("/delete-account", token)
	return s.mailer.Send(ctx, mail.Message{
		To:      u.Email,
		Subject: "Confirm your gotracks account deletion",
		Text: "You requested to permanently delete your gotracks account and all of its data:\n\n" + href +
			"\n\nThe link is valid for 30 minutes and can be used once. " +
			"Nothing is deleted until you confirm. After confirmation, your account and data cannot be recovered.",
		HTML: `<p>You requested to permanently delete your gotracks account and all of its data.</p>` +
			`<p><a href="` + href + `">Review and confirm account deletion</a></p>` +
			`<p>The link is valid for 30 minutes and can be used once. Nothing is deleted until you confirm. ` +
			`After confirmation, your account and data cannot be recovered.</p>`,
	})
}

// RedeemAccountDeletion consumes a mailed deletion token and returns the
// account it authorized. The HTTP layer immediately passes the ID to the one
// account-purge implementation shared with administrator deletion.
func (s *EmailService) RedeemAccountDeletion(ctx context.Context, token string) (int64, error) {
	e, err := s.tokens.Take(ctx, kindAccountDelete, auth.HashEmailToken(token))
	if err != nil {
		return 0, ErrEmailToken
	}
	if _, err := s.users.ByID(ctx, e.UserID); err != nil {
		return 0, ErrEmailToken
	}
	return e.UserID, nil
}

// SendEmailChange sends proof of the requested address to that new mailbox.
// The current account address remains unchanged until the link is redeemed.
func (s *EmailService) SendEmailChange(ctx context.Context, userID int64, newEmail string) error {
	newEmail = auth.NormaliseEmail(newEmail)
	if err := auth.ValidateEmail(newEmail); err != nil {
		return err
	}
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return err
	}
	if u.Email == newEmail {
		return ErrEmailTaken
	}
	if _, err := s.users.ByEmail(ctx, newEmail); err == nil {
		return ErrEmailTaken
	} else if !errors.Is(err, repo.ErrNotFound) {
		return err
	}

	token, err := s.issueTokenWithPayload(ctx, kindEmailChange, userID, emailChangeTTL, []byte(newEmail))
	if err != nil {
		return err
	}
	href := s.link("/change-email", token)
	return s.mailer.Send(ctx, mail.Message{
		To:      newEmail,
		Subject: "Confirm your new gotracks email address",
		Text: "Confirm this address as the new email for your gotracks account:\n\n" + href +
			"\n\nThe link is valid for 24 hours and can be used once. " +
			"Your current address remains active until you confirm this one.",
		HTML: `<p>Confirm this address as the new email for your gotracks account:</p>` +
			`<p><a href="` + href + `">Confirm my new email address</a></p>` +
			`<p>The link is valid for 24 hours and can be used once. ` +
			`Your current address remains active until you confirm this one.</p>`,
	})
}

// ConfirmEmailChange proves control of the new mailbox, replaces the account
// address, revokes existing sessions and notifies the previous address.
func (s *EmailService) ConfirmEmailChange(ctx context.Context, token string) error {
	e, err := s.tokens.Take(ctx, kindEmailChange, auth.HashEmailToken(token))
	if err != nil {
		return ErrEmailToken
	}
	newEmail := string(e.Payload)
	if err := auth.ValidateEmail(newEmail); err != nil {
		return ErrEmailToken
	}
	if _, err := s.users.ByEmail(ctx, newEmail); err == nil {
		return ErrEmailTaken
	} else if !errors.Is(err, repo.ErrNotFound) {
		return err
	}
	u, err := s.users.ByID(ctx, e.UserID)
	if err != nil {
		return ErrEmailToken
	}
	oldEmail := u.Email
	if err := s.auth.refreshTokens.DeleteForUser(ctx, u.ID); err != nil {
		return err
	}
	u.Email = newEmail
	u.UpdatedAt = time.Now()
	if err := s.users.Update(ctx, u); err != nil {
		return err
	}
	safeNewEmail := html.EscapeString(newEmail)
	if err := s.mailer.Send(ctx, mail.Message{
		To:      oldEmail,
		Subject: "Your gotracks email address was changed",
		Text:    "The email address for your gotracks account was changed to " + newEmail + ".\n\nIf you did not make this change, contact your instance administrator immediately.",
		HTML:    `<p>The email address for your gotracks account was changed to ` + safeNewEmail + `.</p><p>If you did not make this change, contact your instance administrator immediately.</p>`,
	}); err != nil {
		log.Warn().Err(err).Msg("could not notify previous address of email change")
	}
	return nil
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
	return s.setPasswordAndVerify(ctx, u, newPassword)
}

// AcceptInvitation activates a pending account. The password is checked before
// consuming the token so a typo or weak choice does not destroy the invitation.
func (s *EmailService) AcceptInvitation(ctx context.Context, token, newPassword string) (*domain.User, error) {
	if err := auth.ValidatePassword(newPassword); err != nil {
		return nil, err
	}
	u, err := s.consumeToken(ctx, kindInvitation, token)
	if err != nil {
		return nil, err
	}
	if u.EmailVerifiedAt != nil {
		return nil, ErrEmailToken
	}
	if err := s.setPasswordAndVerify(ctx, u, newPassword); err != nil {
		return nil, err
	}
	return s.users.ByID(ctx, u.ID)
}

// setPasswordAndVerify reloads the user before marking it verified. SetPassword
// updates its own copy; writing the older copy afterwards would restore the old
// password hash while appearing to complete the flow successfully.
func (s *EmailService) setPasswordAndVerify(ctx context.Context, u *domain.User, password string) error {
	if _, err := s.auth.SetPassword(ctx, u.ID, password); err != nil {
		return err
	}
	if u.EmailVerifiedAt != nil {
		return nil
	}
	fresh, err := s.users.ByID(ctx, u.ID)
	if err != nil {
		return err
	}
	return s.MarkVerified(ctx, fresh)
}
