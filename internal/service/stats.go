package service

import (
	"context"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// timeNow is a seam so tests can pin "today" to a month-end date.
var timeNow = time.Now

// StatsService computes the statistics dashboard.
type StatsService struct {
	stats    repo.StatsRepo
	contexts repo.ContextRepo
}

// NewStatsService builds a StatsService.
func NewStatsService(stats repo.StatsRepo, contexts repo.ContextRepo) *StatsService {
	return &StatsService{stats: stats, contexts: contexts}
}

// ContextCount pairs a context name with its open-action count.
type ContextCount struct {
	ContextID int64  `json:"contextId"`
	Name      string `json:"name"`
	Open      int    `json:"open"`
}

// MonthCount is the number of actions completed in a calendar month.
type MonthCount struct {
	Month string `json:"month"` // YYYY-MM
	Count int    `json:"count"`
}

// Stats is the dashboard payload.
type Stats struct {
	TotalActions      int            `json:"totalActions"`
	Active            int            `json:"active"`
	Deferred          int            `json:"deferred"`
	Completed         int            `json:"completed"`
	CompletionRate    float64        `json:"completionRate"`
	AvgCompletionDays float64        `json:"avgCompletionDays"`
	CompletedLast30   int            `json:"completedLast30"`
	CompletedLast365  int            `json:"completedLast365"`
	PerMonth          []MonthCount   `json:"perMonth"`
	PerContext        []ContextCount `json:"perContext"`
	OldestOpenDays    int            `json:"oldestOpenDays"`
	ProjectsActive    int            `json:"projectsActive"`
	ProjectsCompleted int            `json:"projectsCompleted"`
	ProjectsHidden    int            `json:"projectsHidden"`
}

// Compute gathers all dashboard figures for a user.
func (s *StatsService) Compute(ctx context.Context, userID int64) (*Stats, error) {
	now := timeNow()

	byState, err := s.stats.CountByState(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := &Stats{
		Active:    byState[domain.StateActive],
		Deferred:  byState[domain.StateDeferred],
		Completed: byState[domain.StateCompleted],
	}
	for _, n := range byState {
		out.TotalActions += n
	}
	if out.TotalActions > 0 {
		out.CompletionRate = float64(out.Completed) / float64(out.TotalActions) * 100
	}

	if out.AvgCompletionDays, err = s.stats.AvgCompletionDays(ctx, userID); err != nil {
		return nil, err
	}

	// One year of completions drives both the 30-day figure and the monthly series.
	yearAgo := now.AddDate(-1, 0, 0)
	completions, err := s.stats.CompletedSince(ctx, userID, yearAgo)
	if err != nil {
		return nil, err
	}
	thirtyDaysAgo := now.AddDate(0, 0, -30)
	perMonth := map[string]int{}
	for _, t := range completions {
		out.CompletedLast365++
		if t.After(thirtyDaysAgo) {
			out.CompletedLast30++
		}
		perMonth[t.Format("2006-01")]++
	}
	// Emit all 12 months in order, including empty ones, so charts are continuous.
	// Step from the first of the current month: AddDate normalizes day overflow,
	// so stepping from a 29th-31st would land past short months (Mar 31 minus one
	// month is Feb 31, i.e. Mar 3) and duplicate some months while skipping others.
	year, month, _ := now.Date()
	first := time.Date(year, month, 1, 0, 0, 0, 0, now.Location())
	for i := 11; i >= 0; i-- {
		key := first.AddDate(0, -i, 0).Format("2006-01")
		out.PerMonth = append(out.PerMonth, MonthCount{Month: key, Count: perMonth[key]})
	}

	perContext, err := s.stats.CountPerContext(ctx, userID)
	if err != nil {
		return nil, err
	}
	contexts, err := s.contexts.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	out.PerContext = []ContextCount{}
	for _, c := range contexts {
		out.PerContext = append(out.PerContext, ContextCount{
			ContextID: c.ID, Name: c.Name, Open: perContext[c.ID],
		})
	}

	oldest, err := s.stats.OldestOpen(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !oldest.IsZero() {
		out.OldestOpenDays = int(now.Sub(oldest).Hours() / 24)
	}

	projects, err := s.stats.CountProjectsByState(ctx, userID)
	if err != nil {
		return nil, err
	}
	out.ProjectsActive = projects[domain.StateActive]
	out.ProjectsCompleted = projects[domain.StateCompleted]
	out.ProjectsHidden = projects[domain.StateHidden]

	return out, nil
}
