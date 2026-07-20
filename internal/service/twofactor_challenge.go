package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

const (
	// challengeTTL is how long a half-finished sign-in stays valid.
	challengeTTL = 5 * time.Minute
	// enrolmentTTL is longer: the user has to install the secret in an app
	// and wait for a fresh code before confirming.
	enrolmentTTL = 10 * time.Minute
	// maxAttempts is how many wrong codes a single challenge tolerates before
	// it is destroyed and the password has to be entered again.
	maxAttempts = 5
	// maxChallengesPerUser bounds how much pending state one account can pile
	// up, so a replayed valid password cannot mint challenges without limit.
	maxChallengesPerUser = 5
)

// Kinds of pending second-factor state. Stored on the row, so a token issued
// for one flow cannot be redeemed by the other.
const (
	kindLogin     = "2fa-login"
	kindEnrolment = "2fa-enrolment"
)

// challengePayload is what a pending entry carries beyond its owner.
type challengePayload struct {
	// Secret is set for enrolment only: the candidate TOTP secret, held here
	// rather than in the user's row until a code proves it works.
	Secret string `json:"secret,omitempty"`
}

// challenge is a live pending entry.
type challenge struct {
	userID   int64
	attempts int
	secret   string
}

// challengeStore keeps in-flight second-factor state in the database.
//
// It was a per-process map, which is correct for one instance and quietly wrong
// for several: the password step and the code that answers it can land on
// different replicas. Sharing the rows is what lets this run without sticky
// sessions, and it means an attempt counter cannot be reset by restarting an
// instance or by hopping to another one.
type challengeStore struct {
	repo repo.EphemeralRepo
}

func newChallengeStore(r repo.EphemeralRepo) *challengeStore {
	return &challengeStore{repo: r}
}

func ttlFor(kind string) time.Duration {
	if kind == kindEnrolment {
		return enrolmentTTL
	}
	return challengeTTL
}

func (s *challengeStore) put(ctx context.Context, kind string, userID int64, secret string) (string, error) {
	// Bound per-account pending state before adding more.
	n, err := s.repo.CountForUser(ctx, kind, userID)
	if err != nil {
		return "", err
	}
	if n >= maxChallengesPerUser {
		return "", ErrTwoFactorChallenge
	}

	id, err := randomToken()
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(challengePayload{Secret: secret})
	if err != nil {
		return "", err
	}
	if err := s.repo.Put(ctx, &domain.Ephemeral{
		ID:        id,
		Kind:      kind,
		UserID:    userID,
		Payload:   payload,
		ExpiresAt: time.Now().Add(ttlFor(kind)),
	}); err != nil {
		return "", err
	}
	return id, nil
}

func decodeChallenge(e *domain.Ephemeral) *challenge {
	var p challengePayload
	// A payload that will not decode is not worth failing the request over:
	// the owner and the attempt count are on the row itself.
	_ = json.Unmarshal(e.Payload, &p)
	return &challenge{userID: e.UserID, attempts: e.Attempts, secret: p.Secret}
}

// attempt records a failed use and returns the entry.
//
// Unlike a consume, this deliberately leaves the entry in place: a single
// mistyped digit must not send the user back to the password screen. The row
// disappears once the allowance is spent, so an attacker has to prove the
// password again to get another.
func (s *challengeStore) attempt(ctx context.Context, id, kind string) (*challenge, bool) {
	e, err := s.repo.Attempt(ctx, kind, id, maxAttempts)
	if err != nil {
		return nil, false
	}
	return decodeChallenge(e), true
}

// take consumes an entry once its code has been accepted.
func (s *challengeStore) take(ctx context.Context, id, kind string) (*challenge, bool) {
	e, err := s.repo.Take(ctx, kind, id)
	if err != nil {
		return nil, false
	}
	return decodeChallenge(e), true
}

// forget drops every pending entry for a user, so disabling two-factor or an
// admin reset cannot leave a usable half-finished sign-in behind.
func (s *challengeStore) forget(ctx context.Context, userID int64) error {
	err := s.repo.DeleteForUser(ctx, userID)
	if errors.Is(err, repo.ErrNotFound) {
		return nil
	}
	return err
}
