// Package service holds application logic sitting between HTTP handlers and repos.
package service

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// Auth-related errors surfaced to handlers.
var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailTaken         = errors.New("email already registered")
	ErrRegisterDisabled   = errors.New("registration is disabled")
	ErrInvalidRefresh     = errors.New("invalid or expired refresh token")
	// ErrNoLocalPassword is returned for an account that signs in through the
	// identity provider and therefore has no password to change.
	ErrNoLocalPassword = errors.New("account has no local password")
	// ErrAccountLocked is returned once a login has failed too many times in a
	// row. It is deliberately distinct from ErrInvalidCredentials so the user is
	// told to wait rather than left retrying a correct password.
	ErrAccountLocked = errors.New("account temporarily locked")
)

// Lockout policy for repeated failed sign-ins.
const (
	// MaxLoginFailures is how many consecutive failures lock a login.
	MaxLoginFailures = 10
	// LoginLockDuration is how long it stays locked.
	LoginLockDuration = 15 * time.Minute
	// loginAttemptRetention is when a quiet record is forgotten.
	loginAttemptRetention = 24 * time.Hour
)

// oidcPassword marks an account as SSO-only. It is not a valid argon2id hash
// (those always start with "$argon2id$"), so VerifyPassword can never accept
// any password for such an account, and it identifies the accounts that a
// later SSO sign-in is allowed to reuse.
const oidcPassword = "!oidc"

// AuthService handles registration, login and token rotation.
type AuthService struct {
	users         repo.UserRepo
	refreshTokens repo.RefreshTokenRepo
	tokens        *auth.TokenManager
	settings      *SettingsService
	// attempts is optional: nil disables lockout, which keeps the many tests
	// that construct AuthService directly working unchanged.
	attempts repo.LoginAttemptRepo
	// prefs is optional too, and only used to record the language chosen at
	// registration. Nil simply leaves the account on the default.
	prefs repo.PreferenceRepo
}

// SetLoginAttempts enables per-account lockout. Wired separately so the
// constructor signature stays stable.
func (s *AuthService) SetLoginAttempts(a repo.LoginAttemptRepo) { s.attempts = a }

// SetPreferences enables storing the language picked on the registration form.
// Wired separately for the same reason as the above.
func (s *AuthService) SetPreferences(p repo.PreferenceRepo) { s.prefs = p }

// NewAuthService builds an AuthService.
func NewAuthService(
	users repo.UserRepo,
	rts repo.RefreshTokenRepo,
	tm *auth.TokenManager,
	settings *SettingsService,
) *AuthService {
	return &AuthService{users: users, refreshTokens: rts, tokens: tm, settings: settings}
}

// IssueFor mints a token pair for an already-authenticated user, used by the
// passkey and SSO flows which verify identity by other means.
func (s *AuthService) IssueFor(ctx context.Context, u *domain.User) (*TokenPair, error) {
	return s.issue(ctx, u)
}

// TokenPair is an issued access token plus refresh token.
type TokenPair struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

// Register creates a new user. The first user ever created becomes admin.
func (s *AuthService) Register(ctx context.Context, email, password, locale string) (*domain.User, *TokenPair, error) {
	email = auth.NormaliseEmail(email)
	if err := auth.ValidateEmail(email); err != nil {
		return nil, nil, err
	}

	count, err := s.users.Count(ctx)
	if err != nil {
		return nil, nil, err
	}
	// Registration may be disabled, but the very first (admin) account is always
	// allowed — otherwise a fresh instance could never be set up.
	if count > 0 {
		allowed, err := s.settings.AllowRegister(ctx)
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			return nil, nil, ErrRegisterDisabled
		}
	}

	if _, err := s.users.ByEmail(ctx, email); err == nil {
		return nil, nil, ErrEmailTaken
	} else if !errors.Is(err, repo.ErrNotFound) {
		return nil, nil, err
	}

	if err := auth.ValidatePassword(password); err != nil {
		return nil, nil, err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	u := &domain.User{
		Email:     email,
		Password:  hash,
		IsAdmin:   count == 0,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.users.Create(ctx, u); err != nil {
		return nil, nil, err
	}

	// The language chosen on the form, so the account reads correctly from the
	// first screen rather than defaulting to English until someone visits
	// settings. An unusable value falls back instead of failing the signup.
	if s.prefs != nil && locale != "" {
		p := DefaultPreference(u.ID)
		p.Locale = NormaliseLocale(locale)
		p.UpdatedAt = now
		if err := s.prefs.Upsert(ctx, p); err != nil {
			return nil, nil, err
		}
	}

	pair, err := s.issue(ctx, u)
	if err != nil {
		return nil, nil, err
	}
	return u, pair, nil
}

// LoginOIDC signs in (or provisions) a user identified by an OIDC provider.
// An account previously provisioned by SSO under the same login is reused;
// otherwise an account is created without a usable password, so it can only be
// accessed through the identity provider.
//
// An existing *password* account of the same name is never claimed: the issuer
// only vouches for the subject, and preferred_username is often self-service at
// the provider, so linking by name would let anyone who can set their username
// sign in as the local account that happens to share it — including the admin
// created on first run.
func (s *AuthService) LoginOIDC(ctx context.Context, id *auth.OIDCUser) (*domain.User, *TokenPair, error) {
	// The account is the address the provider asserts. A provider that will
	// not release one cannot be used to sign in, because there would be no
	// identity to attach the account to.
	email := auth.NormaliseEmail(id.Email)
	if err := auth.ValidateEmail(email); err != nil {
		return nil, nil, err
	}

	u, err := s.users.ByEmail(ctx, email)
	if err == nil && u.Password != oidcPassword {
		return nil, nil, ErrEmailTaken
	}
	if errors.Is(err, repo.ErrNotFound) {
		count, cErr := s.users.Count(ctx)
		if cErr != nil {
			return nil, nil, cErr
		}
		// "Registration disabled" must hold for every route in, not just the
		// password one. The first account is always allowed so a fresh instance
		// can still be set up through SSO.
		if count > 0 {
			allowed, aErr := s.settings.AllowRegister(ctx)
			if aErr != nil {
				return nil, nil, aErr
			}
			if !allowed {
				return nil, nil, ErrRegisterDisabled
			}
		}
		now := time.Now()
		u = &domain.User{
			Email:     email,
			Password:  oidcPassword,
			IsAdmin:   count == 0,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := s.users.Create(ctx, u); err != nil {
			return nil, nil, err
		}
	} else if err != nil {
		return nil, nil, err
	}

	pair, err := s.issue(ctx, u)
	if err != nil {
		return nil, nil, err
	}
	return u, pair, nil
}

// Me returns the user for an authenticated request.
func (s *AuthService) Me(ctx context.Context, userID int64) (*domain.User, error) {
	return s.users.ByID(ctx, userID)
}

// AuthenticatePassword verifies a login and password and returns the user. It
// deliberately does not issue tokens: a password alone may not be enough, and
// the caller decides whether a second factor is owed before calling IssueFor.
//
// Keeping token minting out of this method is what makes skipping the
// second-factor check impossible by construction rather than by discipline —
// there is no path from a password straight to a session.
func (s *AuthService) AuthenticatePassword(ctx context.Context, email, password string) (*domain.User, error) {
	email = auth.NormaliseEmail(email)
	// Checked before the account is even looked up, so a locked address costs
	// an attacker the same whether or not the account exists.
	if err := s.checkLocked(ctx, email); err != nil {
		return nil, err
	}

	u, err := s.users.ByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			// Counted too: otherwise guessing addresses is free, and the
			// timing difference would say which ones exist.
			s.recordFailure(ctx, email)
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	ok, err := auth.VerifyPassword(password, u.Password)
	if err != nil || !ok {
		s.recordFailure(ctx, email)
		return nil, ErrInvalidCredentials
	}

	// A correct password clears the record, so an honest user who mistyped a
	// few times is not carrying a count toward a future lockout.
	if s.attempts != nil {
		if err := s.attempts.Clear(ctx, email); err != nil {
			log.Warn().Err(err).Msg("could not clear login attempts")
		}
	}
	return u, nil
}

// checkLocked reports ErrAccountLocked while a lock is in force.
func (s *AuthService) checkLocked(ctx context.Context, email string) error {
	if s.attempts == nil {
		return nil
	}
	a, err := s.attempts.Get(ctx, email)
	if errors.Is(err, repo.ErrNotFound) {
		return nil
	}
	if err != nil {
		// Never fail closed on a storage problem: that would turn a database
		// hiccup into an outage of the whole sign-in path.
		log.Warn().Err(err).Msg("could not read login attempts")
		return nil
	}
	if a.LockedUntil != nil && time.Now().Before(*a.LockedUntil) {
		return ErrAccountLocked
	}
	return nil
}

// recordFailure counts a failed sign-in. Errors are logged, not returned: the
// caller is already reporting a failure and must not leak storage state.
func (s *AuthService) recordFailure(ctx context.Context, email string) {
	if s.attempts == nil {
		return
	}
	if _, err := s.attempts.RecordFailure(ctx, email, LoginLockDuration, MaxLoginFailures); err != nil {
		log.Warn().Err(err).Msg("could not record a failed sign-in")
	}
}

// PurgeLoginAttempts drops records untouched for a day. Called periodically by
// the server so the table cannot grow without bound from junk logins.
func (s *AuthService) PurgeLoginAttempts(ctx context.Context) error {
	if s.attempts == nil {
		return nil
	}
	return s.attempts.PurgeBefore(ctx, time.Now().Add(-loginAttemptRetention))
}

// SetPassword replaces a password without checking the current one. The caller
// must have proven identity some other way first — today that means a passkey
// assertion. It is deliberately separate from ChangePassword so that skipping
// the check is always a visible decision at the call site.
func (s *AuthService) SetPassword(ctx context.Context, userID int64, next string) (*TokenPair, error) {
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if u.Password == oidcPassword {
		return nil, ErrNoLocalPassword
	}
	return s.replacePassword(ctx, u, next)
}

// ChangePassword updates the caller's own password, given the current one.
//
// Every existing session is dropped and a fresh pair is issued to the caller,
// so a password change signs out the other devices — which is the point of
// changing it — while leaving the person who made the change signed in.
func (s *AuthService) ChangePassword(ctx context.Context, userID int64, current, next string) (*TokenPair, error) {
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	// An SSO account has a sentinel in place of a hash; there is nothing here
	// to change, and the provider owns the credential.
	if u.Password == oidcPassword {
		return nil, ErrNoLocalPassword
	}
	ok, err := auth.VerifyPassword(current, u.Password)
	if err != nil || !ok {
		return nil, ErrInvalidCredentials
	}
	return s.replacePassword(ctx, u, next)
}

// replacePassword writes the new hash and rotates sessions.
func (s *AuthService) replacePassword(ctx context.Context, u *domain.User, next string) (*TokenPair, error) {
	if err := auth.ValidatePassword(next); err != nil {
		return nil, err
	}
	hash, err := auth.HashPassword(next)
	if err != nil {
		return nil, err
	}
	u.Password = hash
	u.UpdatedAt = time.Now()
	if err := s.users.Update(ctx, u); err != nil {
		return nil, err
	}
	// Order matters: revoke first, then mint, so the caller's new pair is not
	// caught by the revocation it just triggered.
	if err := s.refreshTokens.DeleteForUser(ctx, u.ID); err != nil {
		return nil, err
	}
	return s.issue(ctx, u)
}

// Refresh rotates a refresh token, returning a fresh token pair.
func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*TokenPair, error) {
	hash := s.tokens.HashRefreshToken(refreshToken)
	stored, err := s.refreshTokens.ByHash(ctx, hash)
	if err != nil {
		return nil, ErrInvalidRefresh
	}
	if time.Now().After(stored.ExpiresAt) {
		_ = s.refreshTokens.DeleteByHash(ctx, hash)
		return nil, ErrInvalidRefresh
	}
	u, err := s.users.ByID(ctx, stored.UserID)
	if err != nil {
		return nil, ErrInvalidRefresh
	}
	// Rotate: delete the used token before issuing a new one.
	if err := s.refreshTokens.DeleteByHash(ctx, hash); err != nil {
		return nil, err
	}
	return s.issue(ctx, u)
}

// Logout revokes a single refresh token.
func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	return s.refreshTokens.DeleteByHash(ctx, s.tokens.HashRefreshToken(refreshToken))
}

func (s *AuthService) issue(ctx context.Context, u *domain.User) (*TokenPair, error) {
	access, err := s.tokens.NewAccessToken(u.ID, u.IsAdmin)
	if err != nil {
		return nil, err
	}
	refresh, hash, err := s.tokens.NewRefreshToken()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	rt := &domain.RefreshToken{
		UserID:    u.ID,
		TokenHash: hash,
		ExpiresAt: now.Add(s.tokens.RefreshTTL()),
		CreatedAt: now,
	}
	if err := s.refreshTokens.Create(ctx, rt); err != nil {
		return nil, err
	}
	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    now.Add(s.tokens.AccessTTL()),
	}, nil
}
