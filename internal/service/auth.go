// Package service holds application logic sitting between HTTP handlers and repos.
package service

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
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
	ErrBootstrapRequired  = errors.New("valid bootstrap secret required")
	ErrEnrollmentCapacity = errors.New("too many pending enrollments")
	ErrInvalidRefresh     = errors.New("invalid or expired refresh token")
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

// dummyPasswordHash has the same Argon2id parameters and encoded lengths as a
// real password hash. Its arbitrary all-zero digest is intentionally not a
// credential; verifying against it only makes unknown-account login perform
// the same expensive work as a wrong password for an existing account.
const dummyPasswordHash = "$argon2id$v=19$m=65536,t=1,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

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
	// enrollments holds public signups before mailbox proof. bootstrapSecret is
	// required only while the users table is empty.
	enrollments     repo.PendingEnrollmentRepo
	bootstrapSecret string
}

// SetLoginAttempts enables per-account lockout. Wired separately so the
// constructor signature stays stable.
func (s *AuthService) SetLoginAttempts(a repo.LoginAttemptRepo) { s.attempts = a }

// SetPreferences enables storing the language picked on the registration form.
// Wired separately for the same reason as the above.
func (s *AuthService) SetPreferences(p repo.PreferenceRepo) { s.prefs = p }

// SetEnrollments enables bounded public enrollment and protects first-admin
// creation with an operator-supplied secret.
func (s *AuthService) SetEnrollments(e repo.PendingEnrollmentRepo, bootstrapSecret string) {
	s.enrollments = e
	s.bootstrapSecret = bootstrapSecret
}

// NewAuthService builds an AuthService.
func NewAuthService(
	users repo.UserRepo,
	rts repo.RefreshTokenRepo,
	tm *auth.TokenManager,
	settings *SettingsService,
) *AuthService {
	return &AuthService{users: users, refreshTokens: rts, tokens: tm, settings: settings}
}

// CurrentUser returns the authoritative account state for access-token checks.
func (s *AuthService) CurrentUser(ctx context.Context, id int64) (*domain.User, error) {
	return s.users.ByID(ctx, id)
}

// IssueFor mints a token pair for an already-authenticated user, used by
// passkey flows which verify identity by other means.
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
	email, count, err := s.registrationIdentity(ctx, email)
	if err != nil {
		return nil, nil, err
	}
	if err := auth.ValidatePassword(password); err != nil {
		return nil, nil, err
	}
	hash, err := auth.HashPasswordContext(ctx, password)
	if err != nil {
		return nil, nil, err
	}
	u, err := s.createRegisteredUser(ctx, email, hash, locale, "", count == 0)
	if err != nil {
		return nil, nil, err
	}
	pair, err := s.issue(ctx, u)
	if err != nil {
		return nil, nil, err
	}
	return u, pair, nil
}

const maxPendingEnrollments = 1000

// BootstrapRequired reports whether the instance still needs its first
// administrator.
func (s *AuthService) BootstrapRequired(ctx context.Context) (bool, error) {
	count, err := s.users.Count(ctx)
	return count == 0, err
}

// BeginEnrollment stores a bounded pending signup without hashing a password or
// creating a user. It returns the raw single-use token for email delivery.
func (s *AuthService) BeginEnrollment(
	ctx context.Context, email, locale, timeZone, suppliedBootstrapSecret string,
) (string, string, error) {
	if s.enrollments == nil {
		return "", "", ErrRegisterDisabled
	}
	email = auth.NormaliseEmail(email)
	if err := auth.ValidateEmail(email); err != nil {
		return "", "", err
	}
	count, err := s.users.Count(ctx)
	if err != nil {
		return "", "", err
	}
	bootstrap := count == 0
	if bootstrap {
		want := sha256.Sum256([]byte(s.bootstrapSecret))
		got := sha256.Sum256([]byte(suppliedBootstrapSecret))
		if s.bootstrapSecret == "" || subtle.ConstantTimeCompare(want[:], got[:]) != 1 {
			return "", "", ErrBootstrapRequired
		}
	} else {
		allowed, err := s.settings.AllowRegister(ctx)
		if err != nil {
			return "", "", err
		}
		if !allowed {
			return "", "", ErrRegisterDisabled
		}
	}
	if _, err := s.users.ByEmail(ctx, email); err == nil {
		return "", "", ErrEmailTaken
	} else if !errors.Is(err, repo.ErrNotFound) {
		return "", "", err
	}

	if _, err := time.LoadLocation(timeZone); err != nil {
		timeZone = "UTC"
	}
	raw, err := randomToken()
	if err != nil {
		return "", "", err
	}
	pending := &domain.PendingEnrollment{
		Email:     email,
		TokenHash: auth.HashEmailToken(raw),
		Locale:    NormaliseLocale(locale),
		TimeZone:  timeZone,
		Bootstrap: bootstrap,
		ExpiresAt: time.Now().Add(invitationTTL),
		CreatedAt: time.Now(),
	}
	if err := s.enrollments.Replace(ctx, pending, maxPendingEnrollments); err != nil {
		if errors.Is(err, repo.ErrCapacity) {
			return "", "", ErrEnrollmentCapacity
		}
		return "", "", err
	}
	return email, raw, nil
}

// AcceptEnrollment proves mailbox control and atomically creates the account.
func (s *AuthService) AcceptEnrollment(
	ctx context.Context, token, password string,
) (*domain.User, error) {
	if s.enrollments == nil {
		return nil, ErrEmailToken
	}
	if err := auth.ValidatePassword(password); err != nil {
		return nil, err
	}
	hash, err := auth.HashPasswordContext(ctx, password)
	if err != nil {
		return nil, err
	}
	pending, user, err := s.enrollments.Activate(ctx, auth.HashEmailToken(token), hash)
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			return nil, ErrEmailToken
		}
		return nil, err
	}
	if s.prefs != nil {
		p := DefaultPreference(user.ID)
		p.Locale = pending.Locale
		p.TimeZone = pending.TimeZone
		p.UpdatedAt = time.Now()
		if err := s.prefs.Upsert(ctx, p); err != nil {
			// The account is already active atomically. Preferences have safe
			// defaults, so do not strand the user by pretending activation
			// failed after consuming the link.
			log.Warn().Err(err).Int64("user", user.ID).Msg("could not save enrollment preferences")
		}
	}
	return user, nil
}

// EnrollmentPending reports whether token names a live public enrollment.
func (s *AuthService) EnrollmentPending(ctx context.Context, token string) bool {
	if s.enrollments == nil {
		return false
	}
	_, err := s.enrollments.ByTokenHash(ctx, auth.HashEmailToken(token))
	return err == nil
}

func (s *AuthService) registrationIdentity(ctx context.Context, email string) (string, int, error) {
	email = auth.NormaliseEmail(email)
	if err := auth.ValidateEmail(email); err != nil {
		return "", 0, err
	}

	count, err := s.users.Count(ctx)
	if err != nil {
		return "", 0, err
	}
	// Registration may be disabled, but the very first (admin) account is always
	// allowed — otherwise a fresh instance could never be set up.
	if count > 0 {
		allowed, err := s.settings.AllowRegister(ctx)
		if err != nil {
			return "", 0, err
		}
		if !allowed {
			return "", 0, ErrRegisterDisabled
		}
	}

	if _, err := s.users.ByEmail(ctx, email); err == nil {
		return "", 0, ErrEmailTaken
	} else if !errors.Is(err, repo.ErrNotFound) {
		return "", 0, err
	}
	return email, count, nil
}

func (s *AuthService) createRegisteredUser(ctx context.Context, email, hash, locale, timeZone string, isAdmin bool) (*domain.User, error) {
	now := time.Now()
	u := &domain.User{
		Email:     email,
		Password:  hash,
		IsAdmin:   isAdmin,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.users.Create(ctx, u); err != nil {
		return nil, err
	}

	// The language chosen on the form, so the account reads correctly from the
	// first screen rather than defaulting to English until someone visits
	// settings. An unusable value falls back instead of failing the signup.
	if s.prefs != nil && (locale != "" || timeZone != "") {
		p := DefaultPreference(u.ID)
		p.Locale = NormaliseLocale(locale)
		if _, err := time.LoadLocation(timeZone); err == nil {
			p.TimeZone = timeZone
		}
		p.UpdatedAt = now
		if err := s.prefs.Upsert(ctx, p); err != nil {
			return nil, err
		}
	}
	return u, nil
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
			// Do the same Argon2 work as a known account before returning. The
			// result can never authenticate; only its timing is relevant.
			_, _ = auth.VerifyPasswordContext(ctx, password, dummyPasswordHash)
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	ok, err := auth.VerifyPasswordContext(ctx, password, u.Password)
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
	ok, err := auth.VerifyPasswordContext(ctx, current, u.Password)
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
	hash, err := auth.HashPasswordContext(ctx, next)
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

	// Atomically consume the old token before issuing its successor. Several
	// requests may read the same token, but exactly one delete can affect its
	// row; every losing request is rejected as a replay.
	if err := s.refreshTokens.Consume(ctx, hash); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			return nil, ErrInvalidRefresh
		}
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
