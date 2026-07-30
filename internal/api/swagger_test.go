package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/config"
	"github.com/jdel/gotracks/internal/service"
)

// The interactive API docs must not be an unauthenticated surface: the per-Host
// handler cache and the Host-reflecting config script are only reachable once
// signed in. An anonymous request is refused.
func TestSwaggerDocsRequireAuth(t *testing.T) {
	store := newTestStore(t)
	settings := service.NewSettingsService(store.Settings, true)
	tm := auth.NewTokenManager([]byte("test"), time.Minute, time.Hour)
	authSvc := service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)
	handler := New(
		&config.Config{RateLimitRPS: 100, RateLimitBurst: 100},
		tm,
		&Services{Auth: authSvc, Settings: settings},
		nil,
	)

	for _, path := range []string{"/doc", "/doc/", "/doc/index.html", "/doc/doc.json"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s without a token = %d, want %d", path, rec.Code, http.StatusUnauthorized)
		}
	}
}
