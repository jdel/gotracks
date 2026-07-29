package metrics_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/metrics"
)

// stubReports is a UsageReportRepo whose Aggregate returns a fixed set of
// per-account snapshots.
type stubReports struct {
	snaps []*domain.UsageSnapshot
	err   error
}

func (s stubReports) Aggregate(context.Context) ([]*domain.UsageSnapshot, error) {
	return s.snaps, s.err
}
func (s stubReports) Replace(context.Context, []*domain.UsageSnapshot) error     { return nil }
func (s stubReports) List(context.Context, int) ([]*domain.UsageSnapshot, error) { return s.snaps, nil }
func (s stubReports) DeleteForUser(context.Context, int64) error                 { return nil }

func scrape(t *testing.T, r *metrics.Recorder) string {
	t.Helper()
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	return rec.Body.String()
}

func TestGaugesAreInstanceTotalsOnly(t *testing.T) {
	snaps := []*domain.UsageSnapshot{
		{UserID: 1, Email: "a@example.com", Todos: 5, Projects: 2, StorageBytes: 1000},
		{UserID: 2, Email: "b@example.com", Todos: 3, Projects: 1, StorageBytes: 500},
	}
	r := metrics.New(stubReports{snaps: snaps}, metrics.Limits{Actions: 100, StorageBytes: 1 << 20, TagsPerTodo: 50})
	body := scrape(t, r)

	for _, want := range []string{
		"gotracks_users 2",
		"gotracks_actions 8",         // instance-wide sum
		"gotracks_quota_actions 100", // configured limit
		"gotracks_attachment_storage_bytes 1500",
		"gotracks_quota_tags_per_action 50",
		"go_goroutines", // stock collectors registered too
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output missing %q", want)
		}
	}
	// No per-account usage series: those are the admin report's job.
	if strings.Contains(body, "gotracks_user_actions") {
		t.Error("per-account usage gauges must not be emitted")
	}
}

// SR-16: the security counters aggregate by bounded labels and carry no
// per-account label, so cardinality cannot grow with historical accounts and no
// account identifier leaks on the unauthenticated metrics endpoint.
func TestSecurityCountersHaveNoUserLabel(t *testing.T) {
	r := metrics.New(stubReports{}, metrics.Limits{})

	r.LoginAttempt(metrics.OutcomeSuccess)
	r.LoginAttempt(metrics.OutcomeInvalid)
	r.LoginAttempt(metrics.OutcomeInvalid)
	r.QuotaRejected("storage")
	r.Registration("throttled")
	r.AccountActivated()
	r.AccountActivated()
	r.RateLimited("login")

	body := scrape(t, r)
	for _, want := range []string{
		`gotracks_login_attempts_total{outcome="success"} 1`,
		`gotracks_login_attempts_total{outcome="invalid"} 2`,
		`gotracks_quota_rejections_total{resource="storage"} 1`,
		`gotracks_registrations_total{outcome="throttled"} 1`,
		`gotracks_accounts_activated_total 2`,
		`gotracks_ratelimit_rejections_total{limiter="login"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(body, "user=") {
		t.Error("no metric may carry a per-account label")
	}
}

func TestNilRecorderIsSafe(t *testing.T) {
	var r *metrics.Recorder
	r.LoginAttempt(metrics.OutcomeSuccess) // must not panic
	r.QuotaRejected("storage")
	r.Registration("pending")
}

func TestGaugesSurviveAggregationError(t *testing.T) {
	r := metrics.New(stubReports{err: context.DeadlineExceeded}, metrics.Limits{Actions: 10})
	body := scrape(t, r)
	if !strings.Contains(body, "gotracks_quota_actions 10") {
		t.Error("quota gauge should serve even when aggregation fails")
	}
	if !strings.Contains(body, "gotracks_scrape_errors_total 1") {
		t.Error("a scrape error should be counted")
	}
	if strings.Contains(body, "gotracks_users ") {
		t.Error("live gauges should be absent when aggregation fails")
	}
}
