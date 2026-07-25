package service_test

import (
	"context"
	"testing"

	"github.com/jdel/gotracks/internal/service"
)

func TestNormaliseLocale(t *testing.T) {
	cases := map[string]string{
		"fr":      "fr",
		"en":      "en",
		"FR":      "fr",
		"  fr  ":  "fr",
		"it":      "it",
		"de":      "de",
		"fr-CA":   "fr", // translations are language-wide, not regional
		"fr_FR":   "fr",
		"de-AT":   "de",
		"ja":      "en", // nothing is translated into Japanese
		"":        "en",
		"garbage": "en",
	}
	for in, want := range cases {
		if got := service.NormaliseLocale(in); got != want {
			t.Errorf("NormaliseLocale(%q) = %q, want %q", in, got, want)
		}
	}
}

// The language is picked before the account exists, so it has to be stored as
// part of registering — otherwise the first screens after signing up are in
// the wrong language until the user finds the settings page.
func TestRegisterStoresTheChosenLocale(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	authSvc := newAuthService(t, store)
	authSvc.SetPreferences(store.Preferences)
	prefs := service.NewPreferenceService(store.Preferences)

	u, _, err := authSvc.Register(ctx, "fr@example.com", "Str0ng!Passw0rd", "fr-CA")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	p, err := prefs.Get(ctx, u.ID)
	if err != nil {
		t.Fatalf("get preferences: %v", err)
	}
	if p.Locale != "fr" {
		t.Errorf("locale = %q, want %q", p.Locale, "fr")
	}
}

// A language nothing is translated into must not block the signup.
func TestRegisterFallsBackForAnUnsupportedLocale(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	authSvc := newAuthService(t, store)
	authSvc.SetPreferences(store.Preferences)
	prefs := service.NewPreferenceService(store.Preferences)

	u, _, err := authSvc.Register(ctx, "ja@example.com", "Str0ng!Passw0rd", "ja")
	if err != nil {
		t.Fatalf("register refused over a display setting: %v", err)
	}
	p, err := prefs.Get(ctx, u.ID)
	if err != nil {
		t.Fatalf("get preferences: %v", err)
	}
	if p.Locale != "en" {
		t.Errorf("locale = %q, want the default %q", p.Locale, "en")
	}
}

// The settings picker only ever offers supported values, so anything else
// reaching the update path is refused rather than quietly normalised.
func TestUpdateRejectsAnUnsupportedLocale(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)

	bad := "ja"
	if _, err := prefs.Update(ctx, 1, service.PreferenceInput{Locale: &bad}); err == nil {
		t.Fatal("stored a locale the interface cannot render")
	}
	good := "fr"
	if _, err := prefs.Update(ctx, 1, service.PreferenceInput{Locale: &good}); err != nil {
		t.Fatalf("supported locale refused: %v", err)
	}
}
