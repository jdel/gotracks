package service

import (
	"testing"
	"time"
)

func TestReportScheduleMinuteUsesConfiguredTimeZoneAcrossDST(t *testing.T) {
	tests := []struct {
		name string
		now  time.Time
		zone string
		want int
	}{
		{name: "UTC default", now: time.Date(2026, 1, 15, 15, 30, 0, 0, time.UTC), want: 15*60 + 30},
		{name: "New York winter", now: time.Date(2026, 1, 15, 15, 30, 0, 0, time.UTC), zone: "America/New_York", want: 10*60 + 30},
		{name: "New York summer", now: time.Date(2026, 7, 15, 15, 30, 0, 0, time.UTC), zone: "America/New_York", want: 11*60 + 30},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := reportScheduleMinute(tt.now, tt.zone)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("minute = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestReportScheduleMinuteRejectsInvalidTimeZone(t *testing.T) {
	if _, err := reportScheduleMinute(time.Now(), "not/a-zone"); err == nil {
		t.Fatal("accepted an invalid time zone")
	}
}
