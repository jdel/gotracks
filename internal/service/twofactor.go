package service

import (
	"context"
	"encoding/base64"
	"errors"
	"regexp"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/metrics"
	"github.com/jdel/gotracks/internal/repo"
)

// Second-factor errors.
var (
	// ErrTwoFactorChallenge covers an unknown, expired or exhausted challenge.
	ErrTwoFactorChallenge = errors.New("two-factor challenge expired")
	// ErrTwoFactorCode is returned for any wrong code, TOTP or recovery alike,
	// so a response cannot be used to work out which factors are configured.
	ErrTwoFactorCode       = errors.New("invalid two-factor code")
	ErrTwoFactorEnabled    = errors.New("two-factor is already enabled")
	ErrTwoFactorNotEnabled = errors.New("two-factor is not enabled")
)

// totpCode matches a plain six-digit authenticator code; anything else typed
// into the same field is treated as a recovery code.
var totpCode = regexp.MustCompile(`^\d{6}$`)

// TwoFactorService owns TOTP enrolment, verification and recovery codes.
//
// It deliberately does not mint tokens: handlers call AuthService.IssueFor once
// a factor is proven, which keeps this service and AuthService independent.
type TwoFactorService struct {
	twoFactor  repo.TwoFactorRepo
	recovery   repo.RecoveryCodeRepo
	users      repo.UserRepo
	challenges *challengeStore
	issuer     string
	now        func() time.Time
	metrics    *metrics.Recorder
}

// SetMetrics enables two-factor metrics. Nil-safe.
func (s *TwoFactorService) SetMetrics(m *metrics.Recorder) { s.metrics = m }

// NewTwoFactorService builds the service. issuer is the label shown in
// authenticator apps.
func NewTwoFactorService(
	twoFactor repo.TwoFactorRepo,
	recovery repo.RecoveryCodeRepo,
	users repo.UserRepo,
	ephemeral repo.EphemeralRepo,
	issuer string,
) *TwoFactorService {
	if issuer == "" {
		issuer = "gotracks"
	}
	return &TwoFactorService{
		twoFactor:  twoFactor,
		recovery:   recovery,
		users:      users,
		challenges: newChallengeStore(ephemeral),
		issuer:     issuer,
		now:        time.Now,
	}
}

// Status describes a user's second-factor configuration.
type Status struct {
	Enabled                bool       `json:"enabled"`
	EnabledAt              *time.Time `json:"enabledAt,omitempty"`
	RecoveryCodesRemaining int        `json:"recoveryCodesRemaining"`
}

// Challenge is the ticket handed to a client that has passed the password step
// but still owes a second factor. It carries no account information.
type Challenge struct {
	ChallengeID string    `json:"challengeId"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

// Enrolment is the material a client needs to add the account to an
// authenticator app.
type Enrolment struct {
	EnrolmentID string `json:"enrolmentId"`
	Secret      string `json:"secret"`
	OTPAuthURL  string `json:"otpauthUrl"`
	QR          string `json:"qr"` // data: URI, PNG
}

// Status reports whether a user has 2FA on and how many recovery codes are left.
func (s *TwoFactorService) Status(ctx context.Context, userID int64) (*Status, error) {
	tf, err := s.config(ctx, userID)
	if err != nil {
		return nil, err
	}
	if tf == nil || !tf.Enabled {
		return &Status{}, nil
	}
	remaining, err := s.recovery.CountUnused(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &Status{Enabled: true, EnabledAt: tf.EnabledAt, RecoveryCodesRemaining: remaining}, nil
}

// Enabled reports whether a user must present a second factor.
func (s *TwoFactorService) Enabled(ctx context.Context, userID int64) (bool, error) {
	tf, err := s.config(ctx, userID)
	if err != nil {
		return false, err
	}
	return tf != nil && tf.Enabled, nil
}

// config returns the user's row, or nil when they have never enrolled.
func (s *TwoFactorService) config(ctx context.Context, userID int64) (*domain.TwoFactor, error) {
	tf, err := s.twoFactor.Get(ctx, userID)
	if errors.Is(err, repo.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return tf, nil
}

// Begin issues a sign-in challenge after the password has been verified.
func (s *TwoFactorService) Begin(ctx context.Context, userID int64) (*Challenge, error) {
	id, err := s.challenges.put(ctx, kindLogin, userID, "")
	if err != nil {
		return nil, err
	}
	return &Challenge{ChallengeID: id, ExpiresAt: s.now().Add(challengeTTL)}, nil
}

// Verify checks a code against a pending challenge and returns the user it
// belongs to. A six-digit code is treated as TOTP, anything else as a recovery
// code; both failures report ErrTwoFactorCode identically.
func (s *TwoFactorService) Verify(ctx context.Context, challengeID, code string) (*domain.User, error) {
	c, ok := s.challenges.attempt(ctx, challengeID, kindLogin)
	if !ok {
		return nil, ErrTwoFactorChallenge
	}
	tf, err := s.config(ctx, c.userID)
	if err != nil {
		return nil, err
	}
	if tf == nil || !tf.Enabled {
		return nil, ErrTwoFactorNotEnabled
	}

	var accepted bool
	if totpCode.MatchString(code) {
		accepted, err = s.consumeTOTP(ctx, tf, code)
	} else {
		accepted, err = s.consumeRecovery(ctx, c.userID, code)
	}
	if err != nil {
		return nil, err
	}
	if !accepted {
		s.metrics.TwoFactor(metrics.OutcomeFailed)
		return nil, ErrTwoFactorCode
	}

	if _, ok := s.challenges.take(ctx, challengeID, kindLogin); !ok {
		return nil, ErrTwoFactorChallenge
	}
	s.metrics.TwoFactor(metrics.OutcomePassed)
	return s.users.ByID(ctx, c.userID)
}

// consumeTOTP validates a code and records the timestep it used.
//
// Requiring the step to advance is what stops a code being replayed inside the
// drift window: once step N is spent, N itself and the earlier N-1 are both
// refused, even though plain skew validation would still accept them.
func (s *TwoFactorService) consumeTOTP(ctx context.Context, tf *domain.TwoFactor, code string) (bool, error) {
	step, ok := auth.ValidateTOTP(tf.Secret, code, s.now())
	if !ok {
		return false, nil
	}
	if err := s.twoFactor.ConsumeStep(ctx, tf.UserID, step); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *TwoFactorService) consumeRecovery(ctx context.Context, userID int64, code string) (bool, error) {
	stored, err := s.recovery.ByHash(ctx, userID, auth.HashRecoveryCode(code))
	if errors.Is(err, repo.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// Consume reports ErrNotFound when another request got there first, which
	// is what keeps a code single-use.
	if err := s.recovery.Consume(ctx, stored.ID); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// BeginEnrolment generates a candidate secret. Nothing is written to the
// database until FinishEnrolment proves the user's app produces valid codes.
func (s *TwoFactorService) BeginEnrolment(ctx context.Context, userID int64) (*Enrolment, error) {
	tf, err := s.config(ctx, userID)
	if err != nil {
		return nil, err
	}
	if tf != nil && tf.Enabled {
		return nil, ErrTwoFactorEnabled
	}
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	key, err := auth.NewTOTPSecret(s.issuer, u.Email)
	if err != nil {
		return nil, err
	}
	png, err := auth.TOTPQRPNG(key, 220)
	if err != nil {
		return nil, err
	}
	id, err := s.challenges.put(ctx, kindEnrolment, userID, key.Secret())
	if err != nil {
		return nil, err
	}
	return &Enrolment{
		EnrolmentID: id,
		Secret:      key.Secret(),
		OTPAuthURL:  key.URL(),
		QR:          "data:image/png;base64," + base64PNG(png),
	}, nil
}

// FinishEnrolment turns 2FA on once a code from the pending secret validates,
// and returns the recovery codes, which are shown to the user exactly once.
func (s *TwoFactorService) FinishEnrolment(ctx context.Context, userID int64, enrolmentID, code string) ([]string, error) {
	c, ok := s.challenges.attempt(ctx, enrolmentID, kindEnrolment)
	if !ok {
		return nil, ErrTwoFactorChallenge
	}
	if c.userID != userID {
		return nil, ErrTwoFactorChallenge
	}
	step, ok := auth.ValidateTOTP(c.secret, code, s.now())
	if !ok {
		return nil, ErrTwoFactorCode
	}

	now := s.now()
	if err := s.twoFactor.Upsert(ctx, &domain.TwoFactor{
		UserID:    userID,
		Enabled:   true,
		Secret:    c.secret,
		LastStep:  step,
		EnabledAt: &now,
	}); err != nil {
		return nil, err
	}
	codes, err := s.replaceRecoveryCodes(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.challenges.take(ctx, enrolmentID, kindEnrolment)
	return codes, nil
}

// RegenerateRecoveryCodes issues a fresh set, invalidating the previous one.
func (s *TwoFactorService) RegenerateRecoveryCodes(ctx context.Context, userID int64) ([]string, error) {
	tf, err := s.config(ctx, userID)
	if err != nil {
		return nil, err
	}
	if tf == nil || !tf.Enabled {
		return nil, ErrTwoFactorNotEnabled
	}
	return s.replaceRecoveryCodes(ctx, userID)
}

func (s *TwoFactorService) replaceRecoveryCodes(ctx context.Context, userID int64) ([]string, error) {
	plain, hashes, err := auth.NewRecoveryCodes(auth.RecoveryCodeCount)
	if err != nil {
		return nil, err
	}
	if err := s.recovery.ReplaceAll(ctx, userID, hashes); err != nil {
		return nil, err
	}
	return plain, nil
}

// Disable turns 2FA off. The caller checks the password; a valid current code
// is required too, so that a session alone cannot strip the factor.
func (s *TwoFactorService) Disable(ctx context.Context, userID int64, code string) error {
	tf, err := s.config(ctx, userID)
	if err != nil {
		return err
	}
	if tf == nil || !tf.Enabled {
		return ErrTwoFactorNotEnabled
	}

	var accepted bool
	if totpCode.MatchString(code) {
		accepted, err = s.consumeTOTP(ctx, tf, code)
	} else {
		accepted, err = s.consumeRecovery(ctx, userID, code)
	}
	if err != nil {
		return err
	}
	if !accepted {
		return ErrTwoFactorCode
	}
	return s.Reset(ctx, userID)
}

// EnabledUsers returns the set of user ids with 2FA on, for the admin screen.
func (s *TwoFactorService) EnabledUsers(ctx context.Context) (map[int64]bool, error) {
	ids, err := s.twoFactor.EnabledUserIDs(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// EnabledFor returns which of the given users have 2FA on, so a paged admin
// list loads the flag only for the page it shows.
func (s *TwoFactorService) EnabledFor(ctx context.Context, ids []int64) (map[int64]bool, error) {
	enabled, err := s.twoFactor.EnabledUserIDsIn(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(enabled))
	for _, id := range enabled {
		out[id] = true
	}
	return out, nil
}

// Reset removes 2FA entirely. Used by Disable and by an admin unlocking an
// account whose owner lost both authenticator and codes.
func (s *TwoFactorService) Reset(ctx context.Context, userID int64) error {
	if err := s.recovery.DeleteForUser(ctx, userID); err != nil {
		return err
	}
	if err := s.twoFactor.DeleteForUser(ctx, userID); err != nil {
		return err
	}
	// Drop any in-flight challenge, so a half-finished sign-in cannot be
	// completed against configuration that no longer exists.
	return s.challenges.forget(ctx, userID)
}

// base64PNG encodes rendered QR bytes for a data: URI.
func base64PNG(b []byte) string { return base64.StdEncoding.EncodeToString(b) }
