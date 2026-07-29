// Package metrics exposes gotracks' application and runtime metrics in the
// Prometheus text format, served on its own address (--metrics.addr).
//
// It has two families. Instance-wide gauges (account counts, attachment
// storage, configured quotas) are pulled live at scrape time from the same
// per-account aggregation the admin usage report uses, so the two cannot drift;
// deliberately only totals, never a series per account. Security counters are
// held in memory and incremented at the event, labelled by the account they
// concern — so a series appears only once something has happened to that
// account, and idle accounts never show up.
//
// A *Recorder is nil-safe: every method is a no-op on a nil receiver, so a
// service can be wired with metrics or without (tests leave it nil).
package metrics

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

const (
	namespace = "gotracks"
	cacheTTL  = 15 * time.Second
)

// Outcome label values, shared so the emit sites and any dashboards agree.
const (
	OutcomeSuccess = "success"
	OutcomeInvalid = "invalid"
	OutcomeLocked  = "locked"
	OutcomePassed  = "passed"
	OutcomeFailed  = "failed"
)

// Limits are the configured per-account quotas (0 = unlimited), exported as
// static gauges. Mirrors the service quota values without importing them, so
// there is no import cycle with the services that emit metrics.
type Limits struct {
	StorageBytes int64
	Actions      int
	Projects     int
	Notes        int
	Contexts     int
	Tags         int
	Recurring    int
	TagsPerTodo  int
}

// Recorder owns the registry, the live gauge collector, and the security
// counters.
type Recorder struct {
	reg *prometheus.Registry

	login          *prometheus.CounterVec // outcome
	tokenRefresh   *prometheus.CounterVec // outcome
	twoFactor      *prometheus.CounterVec // outcome
	passkey        *prometheus.CounterVec // type, outcome
	quotaReject    *prometheus.CounterVec // resource
	activated      prometheus.Counter
	registrations  *prometheus.CounterVec // outcome
	rateLimited    *prometheus.CounterVec // limiter
	inviteThrottle prometheus.Counter
}

// New builds a Recorder: the standard Go/process collectors, the live
// application-gauge collector, and the security counters, all in one registry.
func New(reports repo.UsageReportRepo, limits Limits) *Recorder {
	r := &Recorder{
		reg: prometheus.NewRegistry(),
		login: counterVec("login_attempts_total",
			"Password sign-in attempts by outcome.", "outcome"),
		tokenRefresh: counterVec("token_refresh_total",
			"Refresh-token rotations by outcome.", "outcome"),
		twoFactor: counterVec("two_factor_total",
			"Two-factor verifications by outcome.", "outcome"),
		passkey: counterVec("passkey_ceremonies_total",
			"Passkey ceremonies by type and outcome.", "type", "outcome"),
		quotaReject: counterVec("quota_rejections_total",
			"Requests refused for exceeding a per-account quota, by resource.", "resource"),
		activated: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: namespace, Name: "accounts_activated_total",
			Help: "Registrations completed into a real account.",
		}),
		registrations: counterVec("registrations_total",
			"Public registration attempts by outcome.", "outcome"),
		rateLimited: counterVec("ratelimit_rejections_total",
			"Requests rejected by an abuse limiter.", "limiter"),
		inviteThrottle: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: namespace, Name: "invitation_throttle_suppressed_total",
			Help: "Invitation emails suppressed by the per-address cooldown.",
		}),
	}
	r.reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		newAppCollector(reports, limits),
		r.login, r.tokenRefresh, r.twoFactor, r.passkey, r.quotaReject,
		r.activated, r.registrations, r.rateLimited, r.inviteThrottle,
	)
	return r
}

func counterVec(name, help string, labels ...string) *prometheus.CounterVec {
	return prometheus.NewCounterVec(
		prometheus.CounterOpts{Namespace: namespace, Name: name, Help: help}, labels)
}

// Handler serves the registry in the Prometheus text format.
func (r *Recorder) Handler() http.Handler {
	return promhttp.HandlerFor(r.reg, promhttp.HandlerOpts{})
}

// LoginAttempt records a password sign-in by outcome. Which account was
// involved belongs in the audit log, not a high-cardinality metric label.
func (r *Recorder) LoginAttempt(outcome string) {
	if r == nil {
		return
	}
	r.login.WithLabelValues(outcome).Inc()
}

// TokenRefresh records a refresh-token rotation.
func (r *Recorder) TokenRefresh(outcome string) {
	if r == nil {
		return
	}
	r.tokenRefresh.WithLabelValues(outcome).Inc()
}

// TwoFactor records a two-factor verification.
func (r *Recorder) TwoFactor(outcome string) {
	if r == nil {
		return
	}
	r.twoFactor.WithLabelValues(outcome).Inc()
}

// Passkey records a passkey ceremony. kind is "login" or "register".
func (r *Recorder) Passkey(kind, outcome string) {
	if r == nil {
		return
	}
	r.passkey.WithLabelValues(kind, outcome).Inc()
}

// QuotaRejected records a request refused for exceeding a quota.
func (r *Recorder) QuotaRejected(resource string) {
	if r == nil {
		return
	}
	r.quotaReject.WithLabelValues(resource).Inc()
}

// AccountActivated records a registration completed into a real account. It is a
// plain total: per-account detail lives in the audit log.
func (r *Recorder) AccountActivated() {
	if r == nil {
		return
	}
	r.activated.Inc()
}

// Registration records a public registration attempt by outcome.
func (r *Recorder) Registration(outcome string) {
	if r == nil {
		return
	}
	r.registrations.WithLabelValues(outcome).Inc()
}

// RateLimited records a request rejected by the named abuse limiter.
func (r *Recorder) RateLimited(limiter string) {
	if r == nil {
		return
	}
	r.rateLimited.WithLabelValues(limiter).Inc()
}

// InvitationThrottled records an invitation email suppressed by the cooldown.
func (r *Recorder) InvitationThrottled() {
	if r == nil {
		return
	}
	r.inviteThrottle.Inc()
}

// resource is one per-account countable, exported as an instance-wide sum and
// as its configured quota — never per account.
type resource struct {
	total *prometheus.Desc
	quota *prometheus.Desc
	value func(*domain.UsageSnapshot) float64
	limit float64
}

type appCollector struct {
	reports repo.UsageReportRepo

	users            *prometheus.Desc
	quotaTagsPerTodo *prometheus.Desc
	tagsPerTodo      float64
	scrapeErrors     *prometheus.Desc
	resources        []resource

	mu       sync.Mutex
	cache    []*domain.UsageSnapshot
	cachedAt time.Time
	errCount float64
}

func newAppCollector(reports repo.UsageReportRepo, q Limits) *appCollector {
	res := func(name, help string, limit float64, val func(*domain.UsageSnapshot) float64) resource {
		return resource{
			total: prometheus.NewDesc(namespace+"_"+name, "Instance-wide total of "+help+".", nil, nil),
			quota: prometheus.NewDesc(namespace+"_quota_"+name, "Configured per-account limit for "+help+" (0 = unlimited).", nil, nil),
			value: val,
			limit: limit,
		}
	}
	return &appCollector{
		reports: reports,
		users:   prometheus.NewDesc(namespace+"_users", "Number of user accounts.", nil, nil),
		quotaTagsPerTodo: prometheus.NewDesc(namespace+"_quota_tags_per_action",
			"Configured limit on tags accepted on one action (0 = unlimited).", nil, nil),
		tagsPerTodo: float64(q.TagsPerTodo),
		scrapeErrors: prometheus.NewDesc(namespace+"_scrape_errors_total",
			"Aggregation failures while collecting application metrics.", nil, nil),
		resources: []resource{
			res("actions", "actions", float64(q.Actions), func(s *domain.UsageSnapshot) float64 { return float64(s.Todos) }),
			res("projects", "projects", float64(q.Projects), func(s *domain.UsageSnapshot) float64 { return float64(s.Projects) }),
			res("notes", "notes", float64(q.Notes), func(s *domain.UsageSnapshot) float64 { return float64(s.Notes) }),
			res("contexts", "contexts", float64(q.Contexts), func(s *domain.UsageSnapshot) float64 { return float64(s.Contexts) }),
			res("tags", "tags", float64(q.Tags), func(s *domain.UsageSnapshot) float64 { return float64(s.Tags) }),
			res("recurring_actions", "recurring actions", float64(q.Recurring), func(s *domain.UsageSnapshot) float64 { return float64(s.Recurring) }),
			res("attachment_storage_bytes", "attachment storage in bytes", float64(q.StorageBytes), func(s *domain.UsageSnapshot) float64 { return float64(s.StorageBytes) }),
		},
	}
}

func (c *appCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.users
	ch <- c.quotaTagsPerTodo
	ch <- c.scrapeErrors
	for _, r := range c.resources {
		ch <- r.total
		ch <- r.quota
	}
}

func (c *appCollector) Collect(ch chan<- prometheus.Metric) {
	// Quotas are static configuration and always available.
	ch <- prometheus.MustNewConstMetric(c.quotaTagsPerTodo, prometheus.GaugeValue, c.tagsPerTodo)
	for _, r := range c.resources {
		ch <- prometheus.MustNewConstMetric(r.quota, prometheus.GaugeValue, r.limit)
	}

	snaps, errCount, err := c.snapshots()
	ch <- prometheus.MustNewConstMetric(c.scrapeErrors, prometheus.CounterValue, errCount)
	if err != nil {
		return // leave the live gauges absent this scrape rather than reporting zeros
	}

	ch <- prometheus.MustNewConstMetric(c.users, prometheus.GaugeValue, float64(len(snaps)))
	for _, r := range c.resources {
		var sum float64
		for _, s := range snaps {
			sum += r.value(s)
		}
		ch <- prometheus.MustNewConstMetric(r.total, prometheus.GaugeValue, sum)
	}
}

// snapshots returns the per-account aggregation, recomputing at most once per
// cacheTTL, along with the running scrape-error count — all under one lock so a
// concurrent scrape cannot race it.
func (c *appCollector) snapshots() ([]*domain.UsageSnapshot, float64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cache != nil && time.Since(c.cachedAt) < cacheTTL {
		return c.cache, c.errCount, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	snaps, err := c.reports.Aggregate(ctx)
	if err != nil {
		c.errCount++
		return nil, c.errCount, err
	}
	c.cache = snaps
	c.cachedAt = time.Now()
	return snaps, c.errCount, nil
}
