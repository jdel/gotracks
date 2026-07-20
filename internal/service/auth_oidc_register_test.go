package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/service"
)

// Registration disabled must hold for SSO too: with it off, an unknown IdP
// identity may not provision a fresh account.
func TestOIDCDoesNotProvisionWhenRegisterDisabled(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()

	tm := auth.NewTokenManager([]byte("test-secret"), time.Minute, time.Hour)
	settings := service.NewSettingsService(store.Settings, true)
	authSvc := service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)

	// First account (admin), then close registration.
	if _, _, err := authSvc.Register(ctx, "root@example.com", "S3cret-Passw0rd!", ""); err != nil {
		t.Fatalf("register admin: %v", err)
	}
	if _, err := settings.SetAllowRegister(ctx, false); err != nil {
		t.Fatalf("disable registration: %v", err)
	}

	if _, _, err := authSvc.LoginOIDC(ctx, &auth.OIDCUser{
		Subject: "stranger-sub",
		Email:   "stranger@example.com",
	}); !errors.Is(err, service.ErrRegisterDisabled) {
		t.Fatalf("want ErrRegisterDisabled, got %v", err)
	}
}

// The first account may still be provisioned through SSO on an empty instance,
// so a fresh deployment is not un-bootstrappable when it uses only SSO.
func TestOIDCProvisionsFirstAccountEvenWhenDisabled(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()

	tm := auth.NewTokenManager([]byte("test-secret"), time.Minute, time.Hour)
	settings := service.NewSettingsService(store.Settings, false)
	authSvc := service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)

	u, _, err := authSvc.LoginOIDC(ctx, &auth.OIDCUser{Subject: "sub-1", Email: "first@example.com"})
	if err != nil {
		t.Fatalf("first SSO account refused on empty instance: %v", err)
	}
	if !u.IsAdmin {
		t.Fatal("first account provisioned through SSO is not admin")
	}
}
