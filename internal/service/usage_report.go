package service

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// UsageReportService builds and serves the instance-wide usage report.
type UsageReportService struct {
	reports  repo.UsageReportRepo
	settings *SettingsService
	quotas   Quotas
}

// NewUsageReportService builds the service.
func NewUsageReportService(r repo.UsageReportRepo, settings *SettingsService, q Quotas) *UsageReportService {
	return &UsageReportService{reports: r, settings: settings, quotas: q}
}

// percentOf returns usage as a percentage of a limit. An unlimited resource
// reports -1, which the UI renders as a dash rather than a misleading 0%.
func percentOf(used, limit int64) int {
	if limit <= 0 {
		return -1
	}
	return int(used * 100 / limit)
}

// AccountUsage is one row of the report: the stored counts plus the
// percentages they work out to against the limits in force right now.
type AccountUsage struct {
	*domain.UsageSnapshot

	StoragePercent   int `json:"storagePercent"`
	TodoPercent      int `json:"todoPercent"`
	ProjectPercent   int `json:"projectPercent"`
	NotePercent      int `json:"notePercent"`
	ContextPercent   int `json:"contextPercent"`
	TagPercent       int `json:"tagPercent"`
	RecurringPercent int `json:"recurringPercent"`

	// WorstPercent is the highest of the above: how close this account is to
	// whichever limit it is nearest. Over 100 means it is past one — possible
	// because limits are enforced when something is created, not retroactively
	// when a limit is lowered.
	WorstPercent int `json:"worstPercent"`
}

// withPercentages derives the percentages for one account.
func (s *UsageReportService) withPercentages(u *domain.UsageSnapshot) *AccountUsage {
	a := &AccountUsage{
		UsageSnapshot:    u,
		StoragePercent:   percentOf(u.StorageBytes, s.quotas.StorageBytes),
		TodoPercent:      percentOf(int64(u.Todos), int64(s.quotas.Todos)),
		ProjectPercent:   percentOf(int64(u.Projects), int64(s.quotas.Projects)),
		NotePercent:      percentOf(int64(u.Notes), int64(s.quotas.Notes)),
		ContextPercent:   percentOf(int64(u.Contexts), int64(s.quotas.Contexts)),
		TagPercent:       percentOf(int64(u.Tags), int64(s.quotas.Tags)),
		RecurringPercent: percentOf(int64(u.Recurring), int64(s.quotas.Recurring)),
	}
	for _, p := range []int{
		a.StoragePercent, a.TodoPercent, a.ProjectPercent, a.NotePercent,
		a.ContextPercent, a.TagPercent, a.RecurringPercent,
	} {
		if p > a.WorstPercent {
			a.WorstPercent = p
		}
	}
	return a
}

// Run rebuilds the report.
func (s *UsageReportService) Run(ctx context.Context) (int, error) {
	started := time.Now()
	snapshots, err := s.reports.Aggregate(ctx)
	if err != nil {
		return 0, err
	}
	if err := s.reports.Replace(ctx, snapshots); err != nil {
		return 0, err
	}
	if err := s.settings.SetUsageReportRunAt(ctx, started); err != nil {
		return 0, err
	}
	log.Info().Int("accounts", len(snapshots)).
		Dur("took", time.Since(started)).Msg("usage report rebuilt")
	return len(snapshots), nil
}

// ReportQuery narrows and orders the report.
type ReportQuery struct {
	Search string
	// Admin and TwoFactor are "", "on" or "off", matching the user list.
	Admin     string
	TwoFactor string
	// SortBy names a column; SortDesc reverses it.
	SortBy   string
	SortDesc bool
	Page     int
	PageSize int
}

// Report is the stored report plus the limits it was measured against, so a
// reader does not have to fetch the configuration separately.
type Report struct {
	GeneratedAt *time.Time      `json:"generatedAt,omitempty"`
	AtMinute    int             `json:"usageReportAtMinute"`
	Limits      Quotas          `json:"limits"`
	Total       int             `json:"total"`
	Page        int             `json:"page"`
	PageSize    int             `json:"pageSize"`
	Accounts    []*AccountUsage `json:"accounts"`
}

const defaultReportPageSize = 50

func matchesTri(value bool, filter string) bool {
	switch filter {
	case "on":
		return value
	case "off":
		return !value
	default:
		return true
	}
}

// Latest returns the report, filtered, sorted and paged.
//
// The rows come from one query and everything else happens here rather than in
// SQL, because sorting by a percentage means sorting by something the database
// cannot see: it depends on the limits configured right now. One row per
// account keeps that cheap well beyond the scale this is meant for.
func (s *UsageReportService) Latest(ctx context.Context, q ReportQuery) (*Report, error) {
	rows, err := s.reports.List(ctx, 0)
	if err != nil {
		return nil, err
	}
	settings, err := s.settings.Raw(ctx)
	if err != nil {
		return nil, err
	}

	search := strings.ToLower(strings.TrimSpace(q.Search))
	accounts := make([]*AccountUsage, 0, len(rows))
	for _, row := range rows {
		if search != "" && !strings.Contains(strings.ToLower(row.Email), search) {
			continue
		}
		if !matchesTri(row.IsAdmin, q.Admin) || !matchesTri(row.TwoFactorEnabled, q.TwoFactor) {
			continue
		}
		accounts = append(accounts, s.withPercentages(row))
	}

	sortAccounts(accounts, q.SortBy, q.SortDesc)

	total := len(accounts)
	size := q.PageSize
	if size <= 0 {
		size = defaultReportPageSize
	}
	page := max(q.Page, 1)
	start := min((page-1)*size, total)
	end := min(start+size, total)

	return &Report{
		GeneratedAt: settings.UsageReportRunAt,
		AtMinute:    settings.UsageReportAtMinute,
		Limits:      s.quotas,
		Total:       total,
		Page:        page,
		PageSize:    size,
		Accounts:    accounts[start:end],
	}, nil
}

// sortAccounts orders the rows. The default is worst-first, since the question
// the report answers is "who is closest to a limit".
func sortAccounts(accounts []*AccountUsage, by string, desc bool) {
	key := func(a *AccountUsage) int {
		switch by {
		case "storage":
			return a.StoragePercent
		case "todos":
			return a.TodoPercent
		case "projects":
			return a.ProjectPercent
		case "notes":
			return a.NotePercent
		case "contexts":
			return a.ContextPercent
		case "tags":
			return a.TagPercent
		case "recurring":
			return a.RecurringPercent
		default:
			return a.WorstPercent
		}
	}
	sort.SliceStable(accounts, func(i, j int) bool {
		if by == "email" {
			if desc {
				return accounts[i].Email > accounts[j].Email
			}
			return accounts[i].Email < accounts[j].Email
		}
		ki, kj := key(accounts[i]), key(accounts[j])
		if ki == kj {
			return accounts[i].Email < accounts[j].Email
		}
		if desc {
			return ki > kj
		}
		return ki < kj
	})
}

// Schedule rebuilds the report once a day at the configured UTC time.
//
// The target minute is read each time round rather than captured once, so
// changing it in the admin screen takes effect without a restart. It is
// checked often and acted on rarely, which keeps the loop simple.
func (s *UsageReportService) Schedule(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			settings, err := s.settings.Raw(ctx)
			if err != nil {
				continue
			}
			now := time.Now().UTC()
			atTarget := now.Hour()*60+now.Minute() == settings.UsageReportAtMinute
			if !atTarget {
				continue
			}
			// The interval is fixed at a day; this guard is what stops a second
			// run in the same minute-wide window rather than an interval check.
			if settings.UsageReportRunAt != nil && time.Since(*settings.UsageReportRunAt) < 23*time.Hour {
				continue
			}
			if _, err := s.Run(ctx); err != nil {
				log.Warn().Err(err).Msg("scheduled usage report failed")
			}
		case <-ctx.Done():
			return
		}
	}
}
