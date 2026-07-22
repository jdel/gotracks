package service_test

import (
	"context"
	"testing"

	"github.com/jdel/gotracks/internal/service"
)

func TestUsageReportTimeZoneDefaultsToUTCAndValidatesChanges(t *testing.T) {
	_, store, _ := newTodoService(t)
	settings := service.NewSettingsService(store.Settings, true)
	ctx := context.Background()

	current, err := settings.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.UsageReportTimeZone != "UTC" {
		t.Fatalf("default zone = %q, want UTC", current.UsageReportTimeZone)
	}
	if _, err := settings.SetUsageReportTimeZone(ctx, "America/New_York"); err != nil {
		t.Fatal(err)
	}
	current, err = settings.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.UsageReportTimeZone != "America/New_York" {
		t.Fatalf("zone = %q", current.UsageReportTimeZone)
	}
	if _, err := settings.SetUsageReportTimeZone(ctx, "not/a-zone"); err == nil {
		t.Fatal("accepted an invalid zone")
	}
}
