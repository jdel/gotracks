package service

import (
	"context"
	"errors"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// oidcStateKind labels OIDC CSRF states in the shared ephemeral table.
const oidcStateKind = "oidc-state"

// OIDCStateStore backs auth.StateStore with the shared table, so a sign-in
// begun on one instance can be completed on another.
//
// This matters more than the other shared flows: the callback arrives as a
// redirect from the identity provider, so it is the request least likely to
// come back to the instance that started it.
type OIDCStateStore struct {
	repo repo.EphemeralRepo
}

// NewOIDCStateStore builds the adapter.
func NewOIDCStateStore(r repo.EphemeralRepo) *OIDCStateStore {
	return &OIDCStateStore{repo: r}
}

func (s *OIDCStateStore) Put(ctx context.Context, state string, expiresAt time.Time) error {
	// UserID stays zero: nobody is signed in yet, and the row is anonymous
	// until the callback resolves it to an account.
	return s.repo.Put(ctx, &domain.Ephemeral{
		ID:        state,
		Kind:      oidcStateKind,
		ExpiresAt: expiresAt,
	})
}

// Consume reports whether the state was live and removes it. Take is atomic,
// so a replayed callback cannot be accepted twice.
func (s *OIDCStateStore) Consume(ctx context.Context, state string) (bool, error) {
	if _, err := s.repo.Take(ctx, oidcStateKind, state); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
