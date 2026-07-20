package service_test

import (
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func TestNextOccurrenceDaily(t *testing.T) {
	start := day(2026, time.July, 1)
	r := &domain.RecurringTodo{Period: domain.PeriodDaily, EveryN: 3, StartFrom: &start}

	tests := []struct {
		after time.Time
		want  time.Time
	}{
		{day(2026, time.June, 30), day(2026, time.July, 1)}, // before start → start
		{day(2026, time.July, 1), day(2026, time.July, 4)},
		{day(2026, time.July, 3), day(2026, time.July, 4)},
		{day(2026, time.July, 4), day(2026, time.July, 7)},
	}
	for _, tc := range tests {
		if got := service.NextOccurrence(r, tc.after); !got.Equal(tc.want) {
			t.Errorf("after %s: got %s, want %s",
				tc.after.Format("2006-01-02"), got.Format("2006-01-02"), tc.want.Format("2006-01-02"))
		}
	}
}

func TestNextOccurrenceWeeklyMultipleDays(t *testing.T) {
	// Wednesday 2026-07-01. Every week on Mon(1) and Fri(5).
	start := day(2026, time.July, 1)
	r := &domain.RecurringTodo{Period: domain.PeriodWeekly, EveryN: 1, Weekdays: "1,5", StartFrom: &start}

	got := service.NextOccurrence(r, day(2026, time.July, 1))
	if want := day(2026, time.July, 3); !got.Equal(want) { // Friday
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
	got = service.NextOccurrence(r, day(2026, time.July, 3))
	if want := day(2026, time.July, 6); !got.Equal(want) { // following Monday
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

func TestNextOccurrenceBiweeklyStaysAligned(t *testing.T) {
	// Every 2 weeks on Wednesday, anchored the week of 2026-07-01 (a Wednesday).
	start := day(2026, time.July, 1)
	r := &domain.RecurringTodo{Period: domain.PeriodWeekly, EveryN: 2, Weekdays: "3", StartFrom: &start}

	got := service.NextOccurrence(r, day(2026, time.July, 1))
	if want := day(2026, time.July, 15); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
	// The intervening Wednesday must be skipped.
	got = service.NextOccurrence(r, day(2026, time.July, 15))
	if want := day(2026, time.July, 29); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

func TestNextOccurrenceMonthlyClampsShortMonths(t *testing.T) {
	// The 31st of every month: February must clamp to the 28th (2027 is not a leap year).
	start := day(2026, time.December, 31)
	r := &domain.RecurringTodo{Period: domain.PeriodMonthly, EveryN: 1, DayOfMonth: 31, StartFrom: &start}

	got := service.NextOccurrence(r, day(2027, time.January, 31))
	if want := day(2027, time.February, 28); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

func TestNextOccurrenceMonthlyEveryThree(t *testing.T) {
	start := day(2026, time.January, 15)
	r := &domain.RecurringTodo{Period: domain.PeriodMonthly, EveryN: 3, DayOfMonth: 15, StartFrom: &start}

	got := service.NextOccurrence(r, day(2026, time.January, 15))
	if want := day(2026, time.April, 15); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

func TestNextOccurrenceYearlyLeapDayClamps(t *testing.T) {
	// Feb 29 yearly: non-leap years clamp to Feb 28.
	start := day(2028, time.February, 29)
	r := &domain.RecurringTodo{
		Period: domain.PeriodYearly, EveryN: 1, MonthOfYear: 2, DayOfMonth: 29, StartFrom: &start,
	}
	got := service.NextOccurrence(r, day(2028, time.February, 29))
	if want := day(2029, time.February, 28); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

func TestNextOccurrenceStopsAtEndDate(t *testing.T) {
	start := day(2026, time.July, 1)
	end := day(2026, time.July, 5)
	r := &domain.RecurringTodo{
		Period: domain.PeriodDaily, EveryN: 1, StartFrom: &start, EndDate: &end,
	}
	if got := service.NextOccurrence(r, day(2026, time.July, 4)); got.IsZero() {
		t.Fatal("expected an occurrence before the end date")
	}
	if got := service.NextOccurrence(r, day(2026, time.July, 5)); !got.IsZero() {
		t.Fatalf("expected no occurrence past the end date, got %s", got.Format("2006-01-02"))
	}
}

func TestNextOccurrenceUnknownPeriod(t *testing.T) {
	r := &domain.RecurringTodo{Period: "fortnightly", EveryN: 1}
	if got := service.NextOccurrence(r, time.Now()); !got.IsZero() {
		t.Fatalf("expected zero time for unknown period, got %s", got)
	}
}
