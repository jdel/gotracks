package service

import (
	"context"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// RecurringService manages recurrence patterns and spawns their todos.
type RecurringService struct {
	recurring repo.RecurringTodoRepo
	todos     repo.TodoRepo
	contexts  repo.ContextRepo
	projects  repo.ProjectRepo
	quotas    *QuotaService
}

// NewRecurringService builds a RecurringService.
func NewRecurringService(rec repo.RecurringTodoRepo, todos repo.TodoRepo, contexts repo.ContextRepo) *RecurringService {
	return &RecurringService{recurring: rec, todos: todos, contexts: contexts}
}

// SetQuotas enables the per-account recurrence limit.
func (s *RecurringService) SetQuotas(q *QuotaService) { s.quotas = q }

// SetProjects wires the project repo so "#project" names resolve here too.
func (s *RecurringService) SetProjects(p repo.ProjectRepo) { s.projects = p }

// applyNames fills ContextID/ProjectID from names, creating what is missing.
func (s *RecurringService) applyNames(ctx context.Context, userID int64, in *RecurringInput) error {
	resolver := nameResolver{contexts: s.contexts, projects: s.projects, quotas: s.quotas}
	return resolver.Apply(ctx, userID, &in.ContextID, in.ContextName, &in.ProjectID, in.ProjectName)
}

// RecurringInput carries create/update fields; nil means "leave unchanged".
type RecurringInput struct {
	ContextID *int64
	ProjectID *int64
	// Names are an alternative to ids; an unknown one is created.
	ContextName  *string
	ProjectName  *string
	Description  *string
	Notes        *string
	State        *string
	Period       *string
	EveryN       *int
	Weekdays     *string
	DayOfMonth   *int
	MonthOfYear  *int
	ShowFromDays *int
	StartFrom    *time.Time
	EndDate      *time.Time
	ClearEndDate bool
}

// List returns recurrence patterns for a user.
func (s *RecurringService) List(ctx context.Context, userID int64, state string) ([]*domain.RecurringTodo, error) {
	return s.recurring.List(ctx, userID, state)
}

// Get returns one pattern.
func (s *RecurringService) Get(ctx context.Context, userID, id int64) (*domain.RecurringTodo, error) {
	return s.recurring.ByID(ctx, userID, id)
}

// Create adds a pattern and immediately spawns its first todo if one is due.
// It runs under the account guard: the recurrence allowance, the action
// allowance for the first occurrence and any implicitly created context or
// project are all check-then-insert.
func (s *RecurringService) Create(ctx context.Context, userID int64, in RecurringInput) (*domain.RecurringTodo, error) {
	if err := validateRecurringInput(in, true); err != nil {
		return nil, err
	}
	var rec *domain.RecurringTodo
	err := s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		var err error
		rec, err = s.create(ctx, userID, in)
		return err
	})
	if err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *RecurringService) create(ctx context.Context, userID int64, in RecurringInput) (*domain.RecurringTodo, error) {
	if err := s.applyNames(ctx, userID, &in); err != nil {
		return nil, err
	}
	if in.ContextID == nil {
		return nil, ErrValidation
	}
	if _, err := s.contexts.ByID(ctx, userID, *in.ContextID); err != nil {
		return nil, ErrValidation
	}
	if err := checkProject(ctx, s.projects, userID, in.ProjectID); err != nil {
		return nil, err
	}
	if in.Period == nil || !validPeriod(*in.Period) {
		return nil, ErrValidation
	}
	if err := s.quotas.CheckRecurring(ctx, userID); err != nil {
		return nil, err
	}

	now := time.Now()
	rec := &domain.RecurringTodo{
		UserID:      userID,
		ContextID:   *in.ContextID,
		ProjectID:   in.ProjectID,
		Description: strings.TrimSpace(*in.Description),
		State:       domain.StateActive,
		Period:      *in.Period,
		EveryN:      1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if in.Notes != nil {
		rec.Notes = *in.Notes
	}
	if in.EveryN != nil && *in.EveryN > 0 {
		rec.EveryN = *in.EveryN
	}
	if in.Weekdays != nil {
		rec.Weekdays = *in.Weekdays
	}
	if in.DayOfMonth != nil {
		rec.DayOfMonth = *in.DayOfMonth
	}
	if in.MonthOfYear != nil {
		rec.MonthOfYear = *in.MonthOfYear
	}
	if in.ShowFromDays != nil && *in.ShowFromDays > 0 {
		rec.ShowFromDays = *in.ShowFromDays
	}
	rec.StartFrom = in.StartFrom
	rec.EndDate = in.EndDate

	// A pattern whose end date is already behind its first occurrence stores
	// no action, so it does not need an action slot. Every other new pattern
	// spawns immediately (active or deferred) after it is stored.
	after := startOfDay(now).AddDate(0, 0, -1)
	if !NextOccurrence(rec, after).IsZero() {
		if err := s.quotas.CheckTodo(ctx, userID); err != nil {
			return nil, err
		}
	}

	if err := s.recurring.Create(ctx, rec); err != nil {
		return nil, err
	}
	if _, err := s.spawnIfDue(ctx, rec, now); err != nil {
		return nil, err
	}
	return rec, nil
}

// Update applies a partial change to a pattern. It runs under the account
// guard because a name can create a context or project.
func (s *RecurringService) Update(ctx context.Context, userID, id int64, in RecurringInput) (*domain.RecurringTodo, error) {
	if err := validateRecurringInput(in, false); err != nil {
		return nil, err
	}
	var rec *domain.RecurringTodo
	err := s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		var err error
		rec, err = s.update(ctx, userID, id, in)
		return err
	})
	if err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *RecurringService) update(ctx context.Context, userID, id int64, in RecurringInput) (*domain.RecurringTodo, error) {
	rec, err := s.recurring.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if err := s.applyNames(ctx, userID, &in); err != nil {
		return nil, err
	}
	if in.ContextID != nil {
		if _, err := s.contexts.ByID(ctx, userID, *in.ContextID); err != nil {
			return nil, ErrValidation
		}
		rec.ContextID = *in.ContextID
	}
	if in.ProjectID != nil {
		if err := checkProject(ctx, s.projects, userID, in.ProjectID); err != nil {
			return nil, err
		}
		rec.ProjectID = in.ProjectID
	}
	if in.Description != nil {
		if strings.TrimSpace(*in.Description) == "" {
			return nil, ErrValidation
		}
		rec.Description = strings.TrimSpace(*in.Description)
	}
	if in.Notes != nil {
		rec.Notes = *in.Notes
	}
	if in.State != nil {
		if *in.State != domain.StateActive && *in.State != domain.StateCompleted {
			return nil, ErrValidation
		}
		rec.State = *in.State
		if *in.State == domain.StateCompleted {
			now := time.Now()
			rec.CompletedAt = &now
		} else {
			rec.CompletedAt = nil
		}
	}
	if in.Period != nil {
		if !validPeriod(*in.Period) {
			return nil, ErrValidation
		}
		rec.Period = *in.Period
	}
	if in.EveryN != nil && *in.EveryN > 0 {
		rec.EveryN = *in.EveryN
	}
	if in.Weekdays != nil {
		rec.Weekdays = *in.Weekdays
	}
	if in.DayOfMonth != nil {
		rec.DayOfMonth = *in.DayOfMonth
	}
	if in.MonthOfYear != nil {
		rec.MonthOfYear = *in.MonthOfYear
	}
	if in.ShowFromDays != nil {
		rec.ShowFromDays = *in.ShowFromDays
	}
	if in.StartFrom != nil {
		rec.StartFrom = in.StartFrom
	}
	if in.ClearEndDate {
		rec.EndDate = nil
	} else if in.EndDate != nil {
		rec.EndDate = in.EndDate
	}
	rec.UpdatedAt = time.Now()

	if err := s.recurring.Update(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Delete removes a pattern. Already-spawned todos are left alone.
func (s *RecurringService) Delete(ctx context.Context, userID, id int64) error {
	return s.recurring.Delete(ctx, userID, id)
}

// Sweep spawns the next todo for every active pattern that has no open instance.
// Called before listing todos, so recurrences appear without a background job.
//
// Every list request sweeps, so two of them racing would each see no open
// instance and each spawn one. The account guard makes "is one open?" and
// "create one" a single decision.
func (s *RecurringService) Sweep(ctx context.Context, userID int64, now time.Time) error {
	return s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		recs, err := s.recurring.List(ctx, userID, domain.StateActive)
		if err != nil {
			return err
		}
		for _, rec := range recs {
			if _, err := s.spawnIfDue(ctx, rec, now); err != nil {
				return err
			}
		}
		return nil
	})
}

// SpawnNext creates the following occurrence after a recurring todo is
// completed, under the same guard as Sweep and for the same reason.
func (s *RecurringService) SpawnNext(ctx context.Context, userID, recurringID int64, now time.Time) error {
	return s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		rec, err := s.recurring.ByID(ctx, userID, recurringID)
		if err != nil {
			return err
		}
		if rec.State != domain.StateActive {
			return nil
		}
		_, err = s.spawnIfDue(ctx, rec, now)
		return err
	})
}

// spawnIfDue creates the next todo for a pattern when none is open and the
// occurrence is within the visible horizon (its show-from date has arrived).
//
// Callers hold the account guard: "no instance is open" and the insert that
// answers it have to be one decision, or two sweeps both spawn.
func (s *RecurringService) spawnIfDue(ctx context.Context, rec *domain.RecurringTodo, now time.Time) (bool, error) {
	open, err := s.recurring.HasOpenInstance(ctx, rec.UserID, rec.ID)
	if err != nil || open {
		return false, err
	}

	// Base the next occurrence on the last spawned date so a pattern never
	// repeats a date it already produced. For a pattern that has never spawned,
	// start the search yesterday so an occurrence falling today still counts.
	after := startOfDay(now).AddDate(0, 0, -1)
	if rec.LastSpawnedAt != nil {
		after = *rec.LastSpawnedAt
	}

	due := NextOccurrence(rec, after)
	if due.IsZero() {
		// Pattern exhausted: mark it completed so it stops being swept.
		rec.State = domain.StateCompleted
		rec.CompletedAt = &now
		rec.UpdatedAt = now
		return false, s.recurring.Update(ctx, rec)
	}
	if err := s.quotas.CheckTodo(ctx, rec.UserID); err != nil {
		return false, err
	}

	// The instance is always created so the next occurrence is visible somewhere.
	// If it should not be worked on yet, it lands in the tickler as deferred and
	// the normal ActivateDue sweep promotes it when its date arrives.
	showFrom := due.AddDate(0, 0, -rec.ShowFromDays)
	state := domain.StateActive
	var showFromPtr *time.Time
	if startOfDay(now).Before(startOfDay(showFrom)) {
		state = domain.StateDeferred
		sf := showFrom
		showFromPtr = &sf
	}

	max, err := s.todos.MaxPosition(ctx, rec.UserID, rec.ContextID)
	if err != nil {
		return false, err
	}
	dueCopy := due
	todo := &domain.Todo{
		UserID:          rec.UserID,
		ContextID:       rec.ContextID,
		ProjectID:       rec.ProjectID,
		RecurringTodoID: &rec.ID,
		Description:     rec.Description,
		Notes:           rec.Notes,
		Due:             &dueCopy,
		ShowFrom:        showFromPtr,
		State:           state,
		Position:        max + 1,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.todos.Create(ctx, todo); err != nil {
		return false, err
	}

	rec.LastSpawnedAt = &dueCopy
	rec.UpdatedAt = now
	if err := s.recurring.Update(ctx, rec); err != nil {
		return false, err
	}
	return true, nil
}

func validPeriod(p string) bool {
	switch p {
	case domain.PeriodDaily, domain.PeriodWeekly, domain.PeriodMonthly, domain.PeriodYearly:
		return true
	}
	return false
}

func validateRecurringInput(in RecurringInput, creating bool) error {
	if creating && in.Description == nil {
		return ErrValidation
	}
	if in.Description != nil {
		if err := validateRequired(*in.Description, MaxDescriptionCharacters); err != nil {
			return err
		}
	}
	if err := validateOptional(in.Notes, MaxNotesCharacters); err != nil {
		return err
	}
	if in.Weekdays != nil && !validWeekdays(*in.Weekdays) {
		return ErrValidation
	}
	return nil
}

func validWeekdays(value string) bool {
	if value == "" {
		return true
	}
	seen := make(map[string]struct{}, 7)
	for _, day := range strings.Split(value, ",") {
		day = strings.TrimSpace(day)
		if len(day) != 1 || day[0] < '0' || day[0] > '6' {
			return false
		}
		if _, exists := seen[day]; exists {
			return false
		}
		seen[day] = struct{}{}
	}
	return true
}
