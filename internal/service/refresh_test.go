package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// gatedRefreshTokens holds both refresh requests after they have read the
// original token. This deterministically reproduces the race rather than
// relying on scheduler timing.
type gatedRefreshTokens struct {
	repo.RefreshTokenRepo
	arrived chan struct{}
	release chan struct{}
}

func (g *gatedRefreshTokens) ByHash(
	ctx context.Context,
	hash string,
) (*domain.RefreshToken, error) {
	token, err := g.RefreshTokenRepo.ByHash(ctx, hash)
	g.arrived <- struct{}{}
	<-g.release
	return token, err
}

func TestConcurrentRefreshConsumesTokenExactlyOnce(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()

	tokens := &gatedRefreshTokens{
		RefreshTokenRepo: store.RefreshTokens,
		arrived:          make(chan struct{}, 2),
		release:          make(chan struct{}),
	}
	tm := auth.NewTokenManager(
		[]byte("test-secret"),
		time.Minute,
		time.Hour,
	)
	settings := service.NewSettingsService(store.Settings, true)
	svc := service.NewAuthService(store.Users, tokens, tm, settings)

	_, pair, err := svc.Register(
		ctx,
		"alice@example.com",
		"Str0ng!Passw0rd",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}

	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := svc.Refresh(ctx, pair.RefreshToken)
			results <- err
		}()
	}

	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for range 2 {
		select {
		case <-tokens.arrived:
		case <-timeout.C:
			close(tokens.release)
			t.Fatal("refresh requests did not reach the race barrier")
		}
	}
	close(tokens.release)

	var succeeded, rejected int
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, service.ErrInvalidRefresh):
			rejected++
		default:
			t.Fatalf("unexpected refresh error: %v", err)
		}
	}

	if succeeded != 1 || rejected != 1 {
		t.Fatalf(
			"concurrent refreshes: succeeded=%d rejected=%d, want 1 each",
			succeeded,
			rejected,
		)
	}
}
