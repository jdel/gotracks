package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
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
	h := &metaHandler{settings: settings, auth: authSvc, passkeys: true, twoFactor: true}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	rec := httptest.NewRecorder()
	h.config(rec, req.WithContext(context.Background()))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var got map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"allowRegister":     true,
		"bootstrapRequired": true,
		"passkeys":          true,
		"twoFactor":         true,
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
