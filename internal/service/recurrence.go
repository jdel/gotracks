package service

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
)

// startOfDay truncates a time to midnight in its own location.
func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

// daysBetween counts calendar days from a to b. Subtracting the instants and
// dividing by 24h would be off by one across a DST change, where a local day is
// 23 or 25 hours long, so the dates are compared in UTC where every day is 24h.
func daysBetween(a, b time.Time) int {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	au := time.Date(ay, am, ad, 0, 0, 0, 0, time.UTC)
	bu := time.Date(by, bm, bd, 0, 0, 0, 0, time.UTC)
	return int(bu.Sub(au) / (24 * time.Hour))
}

// parseWeekdays reads "1,3,5" into a sorted set of weekdays (Sunday=0).
func parseWeekdays(s string) []time.Weekday {
	var out []time.Weekday
	seen := map[int]bool{}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 || n > 6 || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, time.Weekday(n))
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// NextOccurrence returns the first occurrence strictly after `after`, or the
// zero time if the pattern has ended or is unsatisfiable.
//
// The anchor for interval arithmetic is StartFrom (falling back to CreatedAt),
// so "every 2 weeks" stays aligned to the day the pattern started.
func NextOccurrence(r *domain.RecurringTodo, after time.Time) time.Time {
	every := r.EveryN
	if every < 1 {
		every = 1
	}
	after = startOfDay(after)

	anchor := r.CreatedAt
	if r.StartFrom != nil {
		anchor = *r.StartFrom
	}
	anchor = startOfDay(anchor)

	// Never schedule before the pattern starts.
	if after.Before(anchor) {
		after = anchor.AddDate(0, 0, -1)
	}

	var next time.Time
	switch r.Period {
	case domain.PeriodDaily:
		next = nextDaily(anchor, after, every)
	case domain.PeriodWeekly:
		next = nextWeekly(anchor, after, every, parseWeekdays(r.Weekdays))
	case domain.PeriodMonthly:
		next = nextMonthly(anchor, after, every, r.DayOfMonth)
	case domain.PeriodYearly:
		next = nextYearly(anchor, after, every, r.MonthOfYear, r.DayOfMonth)
	default:
		return time.Time{}
	}

	if next.IsZero() {
		return time.Time{}
	}
	if r.EndDate != nil && next.After(startOfDay(*r.EndDate)) {
		return time.Time{}
	}
	return next
}

// nextDaily advances in `every`-day steps from the anchor.
func nextDaily(anchor, after time.Time, every int) time.Time {
	if !after.Before(anchor) {
		// Number of whole intervals elapsed, then step to the next one.
		steps := daysBetween(anchor, after)/every + 1
		return anchor.AddDate(0, 0, steps*every)
	}
	return anchor
}

// nextWeekly finds the next selected weekday, keeping `every`-week alignment
// relative to the anchor's week.
func nextWeekly(anchor, after time.Time, every int, weekdays []time.Weekday) time.Time {
	if len(weekdays) == 0 {
		// No weekday selected: behave like "every N weeks on the anchor's weekday".
		weekdays = []time.Weekday{anchor.Weekday()}
	}
	anchorWeek := weekStart(anchor)

	// Scan forward day by day; bounded by every*7 weeks plus a full week of slack.
	limit := every*7 + 7
	for i := 1; i <= limit; i++ {
		day := after.AddDate(0, 0, i)
		if !containsWeekday(weekdays, day.Weekday()) {
			continue
		}
		weeksSince := daysBetween(anchorWeek, weekStart(day)) / 7
		if weeksSince >= 0 && weeksSince%every == 0 {
			return day
		}
	}
	return time.Time{}
}

// weekStart returns the Sunday that begins the week containing t.
func weekStart(t time.Time) time.Time {
	return startOfDay(t).AddDate(0, 0, -int(t.Weekday()))
}

func containsWeekday(list []time.Weekday, d time.Weekday) bool {
	for _, w := range list {
		if w == d {
			return true
		}
	}
	return false
}

// nextMonthly steps `every` months, landing on dayOfMonth. Months that are too
// short are clamped to their last day (31st in February becomes the 28th/29th).
func nextMonthly(anchor, after time.Time, every, dayOfMonth int) time.Time {
	if dayOfMonth < 1 {
		dayOfMonth = anchor.Day()
	}
	// Step months arithmetically rather than with AddDate: AddDate normalizes
	// overflow (Feb 31 → Mar 3), which would skip short months entirely.
	baseYear, baseMonth := anchor.Year(), int(anchor.Month())
	for i := 0; i < 1200; i++ {
		total := baseMonth - 1 + i*every
		year := baseYear + total/12
		month := time.Month(total%12 + 1)
		candidate := clampDay(year, month, dayOfMonth, anchor.Location())
		if candidate.After(after) {
			return candidate
		}
	}
	return time.Time{}
}

// nextYearly steps `every` years, landing on month/day.
func nextYearly(anchor, after time.Time, every, month, dayOfMonth int) time.Time {
	if month < 1 || month > 12 {
		month = int(anchor.Month())
	}
	if dayOfMonth < 1 {
		dayOfMonth = anchor.Day()
	}
	for i := 0; i < 200; i++ {
		year := anchor.Year() + i*every
		candidate := clampDay(year, time.Month(month), dayOfMonth, anchor.Location())
		if candidate.After(after) {
			return candidate
		}
	}
	return time.Time{}
}

// clampDay builds a date, clamping the day to the last day of that month.
func clampDay(year int, month time.Month, day int, loc *time.Location) time.Time {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, loc).Day()
	if day > last {
		day = last
	}
	return time.Date(year, month, day, 0, 0, 0, 0, loc)
}
