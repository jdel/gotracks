package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/config"
	"github.com/jdel/gotracks/internal/service"
)

// The interactive API docs must not be an unauthenticated surface. An anonymous
// request is refused before it reaches the handler.
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

// The docs page must not reflect the request Host: the spec is relative, so the
// server never reads Host, never keys a cache on it, and never writes it into a
// script. A hostile Host header must appear nowhere in the response.
func TestSwaggerDoesNotReflectRequestHost(t *testing.T) {
	mux := http.NewServeMux()
	// Identity middleware so the handler itself is exercised, not the auth gate.
	swaggerHandlers(mux, func(h http.Handler) http.Handler { return h })

	req := httptest.NewRequest(http.MethodGet, "/doc/index.html", nil)
	req.Host = "evil-marker.example');window.pwned=1;//"
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /doc/index.html = %d, want 200", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "evil-marker") {
		t.Fatal("swagger page reflected the request Host")
	}
}
