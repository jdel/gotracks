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
	tags      repo.TagRepo
	quotas    *QuotaService
}

// NewRecurringService builds a RecurringService.
func NewRecurringService(rec repo.RecurringTodoRepo, todos repo.TodoRepo, contexts repo.ContextRepo) *RecurringService {
	return &RecurringService{recurring: rec, todos: todos, contexts: contexts}
}

// SetTags wires the tag repo. Without it a pattern simply has no tags — the
// spawn path checks, so an instance still gets created either way.
func (s *RecurringService) SetTags(t repo.TagRepo) { s.tags = t }

// SetQuotas enables the per-account recurrence limit.
func (s *RecurringService) SetQuotas(q *QuotaService) { s.quotas = q }

// SetProjects wires the project repo so "#project" names resolve here too.
func (s *RecurringService) SetProjects(p repo.ProjectRepo) { s.projects = p }

// applyNames fills ContextID/ProjectID from names, creating what is missing.
func (s *RecurringService) applyNames(ctx context.Context, userID int64, in *RecurringInput) error {
	resolver := nameResolver{contexts: s.contexts, projects: s.projects, quotas: s.quotas}
	projectName := in.ProjectName
	if in.ClearProject {
		projectName = nil
	}
	return resolver.Apply(ctx, userID, &in.ContextID, in.ContextName, &in.ProjectID, projectName)
}

// RecurringInput carries create/update fields; nil means "leave unchanged".
type RecurringInput struct {
	ContextID *int64
	ProjectID *int64
	// Names are an alternative to ids; an unknown one is created.
	ContextName  *string
	ProjectName  *string
	Description  *string
	State        *string
	Period       *string
	EveryN       *int
	Weekdays     *string
	DayOfMonth   *int
	MonthOfYear  *int
	ShowFromDays *int
	StartFrom    *time.Time
	EndDate      *time.Time
	// The two ends of the window clear the same way a nil pointer cannot: it is
	// also what "leave unchanged" looks like on update.
	ClearStartFrom bool
	ClearEndDate   bool
	// ClearProject detaches a pattern from its project. A nil ProjectID cannot
	// mean that: it is also what "leave unchanged" looks like on update.
	ClearProject bool
	// Tags replaces the whole set when HasTags is true, matching how an action
	// carries them: an absent field leaves them alone, an empty one clears them.
	Tags    []string
	HasTags bool
}

// List returns recurrence patterns for a user.
func (s *RecurringService) List(ctx context.Context, userID int64, state string) ([]*domain.RecurringTodo, error) {
	recs, err := s.recurring.List(ctx, userID, state)
	if err != nil {
		return nil, err
	}
	return recs, s.attachTags(ctx, userID, recs)
}

// Get returns one pattern.
func (s *RecurringService) Get(ctx context.Context, userID, id int64) (*domain.RecurringTodo, error) {
	rec, err := s.recurring.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return rec, s.attachTags(ctx, userID, []*domain.RecurringTodo{rec})
}

// attachTags fills in the Tags of patterns already read, in one query.
func (s *RecurringService) attachTags(ctx context.Context, userID int64, recs []*domain.RecurringTodo) error {
	for _, rec := range recs {
		rec.Tags = []string{}
	}
	if s.tags == nil || len(recs) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(recs))
	for _, rec := range recs {
		ids = append(ids, rec.ID)
	}
	byPattern, err := s.tags.ForRecurring(ctx, userID, ids)
	if err != nil {
		return err
	}
	for _, rec := range recs {
		if names, ok := byPattern[rec.ID]; ok {
			rec.Tags = names
		}
	}
	return nil
}

// saveTags replaces a pattern's tag set, under the same per-action tag quota an
// action's tags are checked against.
func (s *RecurringService) saveTags(ctx context.Context, userID int64, rec *domain.RecurringTodo, names []string) error {
	if s.tags == nil {
		return nil
	}
	clean := normalizeTags(names)
	if err := s.quotas.CheckTags(ctx, userID, clean); err != nil {
		return err
	}
	if err := s.tags.SetForRecurring(ctx, userID, rec.ID, clean); err != nil {
		return err
	}
	rec.Tags = clean
	return nil
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
	if endsBeforeStart(rec.StartFrom, rec.EndDate) {
		return nil, ErrValidation
	}

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
	// After the insert, which is where the id comes from, and before the first
	// spawn, which copies them onto the action it creates.
	if in.HasTags {
		if err := s.saveTags(ctx, userID, rec, in.Tags); err != nil {
			return nil, err
		}
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
	if in.ClearProject {
		rec.ProjectID = nil
	} else if in.ProjectID != nil {
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
	if in.ClearStartFrom {
		rec.StartFrom = nil
	} else if in.StartFrom != nil {
		rec.StartFrom = in.StartFrom
	}
	if in.ClearEndDate {
		rec.EndDate = nil
	} else if in.EndDate != nil {
		rec.EndDate = in.EndDate
	}
	// Checked on the merged pattern, not on the input: moving either end alone
	// can invert a window whose other end was already stored.
	if endsBeforeStart(rec.StartFrom, rec.EndDate) {
		return nil, ErrValidation
	}
	rec.UpdatedAt = time.Now()

	if err := s.recurring.Update(ctx, rec); err != nil {
		return nil, err
	}
	if in.HasTags {
		if err := s.saveTags(ctx, userID, rec, in.Tags); err != nil {
			return nil, err
		}
		return rec, nil
	}
	return rec, s.attachTags(ctx, userID, []*domain.RecurringTodo{rec})
}

// Delete removes a pattern. Already-spawned todos are left alone.
func (s *RecurringService) Delete(ctx context.Context, userID, id int64) error {
	if err := s.recurring.Delete(ctx, userID, id); err != nil {
		return err
	}
	// The links go with it, or the next pattern to be given this id inherits
	// somebody else's tags.
	if s.tags == nil {
		return nil
	}
	return s.tags.DeleteForRecurring(ctx, userID, id)
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
	// The instance inherits the pattern's tags. Without this, tagging a
	// recurrence would be decorative: the tag would live on the rule and never
	// reach anything that appears in a list.
	if s.tags != nil {
		names, err := s.tags.ForRecurring(ctx, rec.UserID, []int64{rec.ID})
		if err != nil {
			return false, err
		}
		if len(names[rec.ID]) > 0 {
			if err := s.tags.SetForTodo(ctx, rec.UserID, todo.ID, names[rec.ID]); err != nil {
				return false, err
			}
			todo.Tags = names[rec.ID]
		}
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
	if in.Weekdays != nil && !validWeekdays(*in.Weekdays) {
		return ErrValidation
	}
	return nil
}

// endsBeforeStart reports a window that closes before it opens. Such a pattern
// can never spawn anything, so it is refused rather than stored as a rule with
// no occurrences — the client checks the same thing so the dates never snap
// back after a round-trip, and a client is not a place to enforce anything.
func endsBeforeStart(start, end *time.Time) bool {
	return start != nil && end != nil && end.Before(*start)
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
