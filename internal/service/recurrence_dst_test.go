package service_test

import (
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// Elapsed days must be counted in calendar days. Measuring them as elapsed
// hours divided by 24 loses a day across a spring-forward DST change, and the
// returned occurrence then equals `after` instead of following it — which makes
// a pattern spawn the same date forever.
func TestNextOccurrenceDailyAdvancesAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("tzdata unavailable")
	}
	local := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 0, 0, 0, 0, loc)
	}

	start := local(2026, time.January, 1) // anchor before the March DST switch
	r := &domain.RecurringTodo{Period: domain.PeriodDaily, EveryN: 1, StartFrom: &start}

	after := local(2026, time.July, 1) // last spawned date, after the switch
	got := service.NextOccurrence(r, after)
	if !got.After(after) {
		t.Fatalf("occurrence %s is not strictly after %s",
			got.Format("2006-01-02"), after.Format("2006-01-02"))
	}
	if want := local(2026, time.July, 2); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

// The same day arithmetic drives weekly alignment. A DST change swallows one
// week, so an every-N-weeks pattern lands on the wrong parity and every later
// occurrence is a week late. EveryN must be > 1 to see it: with every == 1 the
// modulo matches whatever the count is.
func TestNextOccurrenceBiweeklyStaysAlignedAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("tzdata unavailable")
	}
	local := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 0, 0, 0, 0, loc)
	}

	// Every 2 weeks on Wednesday, anchored well before the March switch.
	start := local(2026, time.January, 7)
	r := &domain.RecurringTodo{
		Period: domain.PeriodWeekly, EveryN: 2, Weekdays: "3", StartFrom: &start,
	}

	after := local(2026, time.July, 1) // a Wednesday on the pattern, after the switch
	got := service.NextOccurrence(r, after)
	if !got.After(after) {
		t.Fatalf("occurrence %s is not strictly after %s",
			got.Format("2006-01-02"), after.Format("2006-01-02"))
	}
	// 2026-07-08 is 26 weeks after the anchor's week: on the every-2 alignment.
	if want := local(2026, time.July, 8); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}
