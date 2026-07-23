package service_test

import (
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func newAuthService(t *testing.T, store *repo.Store) *service.AuthService {
	t.Helper()
	tm := auth.NewTokenManager([]byte("test-secret"), time.Minute, time.Hour)
	settings := service.NewSettingsService(store.Settings, true)
	return service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)
}
