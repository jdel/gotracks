package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/config"
	"github.com/jdel/gotracks/internal/service"
)

func TestPublicConfigContainsOnlySupportedCapabilities(t *testing.T) {
	store := newTestStore(t)
	settings := service.NewSettingsService(store.Settings, true)
	authSvc := service.NewAuthService(
		store.Users,
		store.RefreshTokens,
		auth.NewTokenManager([]byte("test"), time.Minute, time.Hour),
		settings,
	)
	h := &metaHandler{
		settings: settings, auth: authSvc,
		passkeys: true, twoFactor: true, legal: true, version: "v1.2.3",
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	rec := httptest.NewRecorder()
	h.config(rec, req.WithContext(context.Background()))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	// Decoded loosely, so a field added to the response without being added
	// here still fails rather than passing unnoticed.
	var got map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"allowRegister":     true,
		"bootstrapRequired": true,
		"passkeys":          true,
		"twoFactor":         true,
		"legal":             true,
	}
	if len(got) != len(want) {
		t.Fatalf("capabilities = %v, want %v", got, want)
	}
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("capability %q = %v, want %v", key, got[key], value)
		}
	}
}

// The legal pages are off by default, so an instance that never enabled them
// must neither advertise them nor answer on their routes: a private deployment
// has nobody to inform, and a link to a 404 is worse than no link.
func TestLegalRoutesFollowTheFlag(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		store := newTestStore(t)
		settings := service.NewSettingsService(store.Settings, true)
		tm := auth.NewTokenManager([]byte("test"), time.Minute, time.Hour)
		authSvc := service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)

		svc := &Services{Auth: authSvc, Settings: settings}
		if enabled {
			svc.Legal = service.NewLegalService(store.Legal)
		}
		// A zero-value config rate-limits everything to nothing.
		handler := New(&config.Config{RateLimitRPS: 100, RateLimitBurst: 100}, tm, svc, nil)

		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/legal", nil))
		if enabled && rec.Code != http.StatusOK {
			t.Fatalf("enabled: /api/v1/legal = %d, want %d", rec.Code, http.StatusOK)
		}
		if !enabled && rec.Code != http.StatusNotFound {
			t.Fatalf("disabled: /api/v1/legal = %d, want %d", rec.Code, http.StatusNotFound)
		}

		rec = httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
		var caps struct {
			Legal bool `json:"legal"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&caps); err != nil {
			t.Fatal(err)
		}
		if caps.Legal != enabled {
			t.Fatalf("advertised legal=%v, want %v", caps.Legal, enabled)
		}
	}
}

// The capability probe has to answer before anyone can sign in — the sign-in
// page cannot decide whether to offer a passkey button or a register link
// without it. The build version does not belong in that answer: naming the
// release to anyone who can reach the port hands a scanner something to match
// against advisories, and no signed-out screen uses it.
func TestVersionIsNotPublicButIsServedToAnAccount(t *testing.T) {
	store := newTestStore(t)
	settings := service.NewSettingsService(store.Settings, true)
	tm := auth.NewTokenManager([]byte("test"), time.Minute, time.Hour)
	authSvc := service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)
	handler := New(
		&config.Config{RateLimitRPS: 100, RateLimitBurst: 100, Version: "v1.2.3"},
		tm,
		&Services{Auth: authSvc, Settings: settings},
		nil,
	)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
	if body := rec.Body.String(); strings.Contains(body, "v1.2.3") {
		t.Fatalf("the public capability probe leaks the build: %s", body)
	}

	// And the shell, which is signed in, cannot read it without a token.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/version", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /version = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
