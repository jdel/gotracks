package service_test

import (
	"context"
	"testing"

	// Embedding tzdata here mirrors main.go, so this test fails the same way a
	// stripped production binary would if the embed were removed.
	_ "time/tzdata"

	"github.com/jdel/gotracks/internal/service"
)

// Setting a real IANA timezone must be accepted. It only works when the binary
// can time.LoadLocation the zone, which needs the tz database embedded (main.go
// imports time/tzdata) — a CGO-free build on a minimal image has none otherwise.
func TestUpdatePreferenceAcceptsIANAZone(t *testing.T) {
	_, store, _ := newTodoService(t)
	ctx := context.Background()
	prefs := service.NewPreferenceService(store.Preferences)

	zone := "Europe/Paris"
	p, err := prefs.Update(ctx, 1, service.PreferenceInput{TimeZone: &zone})
	if err != nil {
		t.Fatalf("update timezone: %v", err)
	}
	if p.TimeZone != zone {
		t.Fatalf("timezone not stored: got %q want %q", p.TimeZone, zone)
	}
}
