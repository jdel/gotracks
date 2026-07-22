package service

import (
	"context"
	"encoding/json"
	"io"
	"time"

	"github.com/jdel/gotracks/internal/repo"
)

// Export is a portable copy of a user's data. It deliberately contains no
// database identifiers: references are represented by the names a person sees
// in the application, so the file is useful outside gotracks without exposing
// internal implementation details.
type Export struct {
	ExportedAt time.Time         `json:"exportedAt"`
	Contexts   []ExportContext   `json:"contexts"`
	Projects   []ExportProject   `json:"projects"`
	Todos      []ExportTodo      `json:"todos"`
	Recurring  []ExportRecurring `json:"recurring"`
	Notes      []ExportNote      `json:"notes"`
}

// ExportContext is a context represented only by its user-visible fields.
type ExportContext struct {
	Name  string `json:"name"`
	State string `json:"state"`
}

// ExportProject is a project with named rather than database-ID references.
type ExportProject struct {
	Name           string     `json:"name"`
	Description    string     `json:"description"`
	State          string     `json:"state"`
	DefaultContext string     `json:"defaultContext,omitempty"`
	CompletedAt    *time.Time `json:"completedAt,omitempty"`
	LastReviewed   *time.Time `json:"lastReviewed,omitempty"`
}

// ExportTodo is an action with named context and project references.
type ExportTodo struct {
	Description string     `json:"description"`
	Context     string     `json:"context"`
	Project     string     `json:"project,omitempty"`
	Notes       string     `json:"notes"`
	State       string     `json:"state"`
	Due         *time.Time `json:"due,omitempty"`
	ShowFrom    *time.Time `json:"showFrom,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	Starred     bool       `json:"starred"`
	Tags        []string   `json:"tags"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// ExportRecurring is a recurring action with named context and project references.
type ExportRecurring struct {
	Description   string     `json:"description"`
	Context       string     `json:"context"`
	Project       string     `json:"project,omitempty"`
	Notes         string     `json:"notes"`
	State         string     `json:"state"`
	Period        string     `json:"period"`
	EveryN        int        `json:"everyN"`
	Weekdays      string     `json:"weekdays"`
	DayOfMonth    int        `json:"dayOfMonth"`
	MonthOfYear   int        `json:"monthOfYear"`
	ShowFromDays  int        `json:"showFromDays"`
	StartFrom     *time.Time `json:"startFrom,omitempty"`
	EndDate       *time.Time `json:"endDate,omitempty"`
	LastSpawnedAt *time.Time `json:"lastSpawnedAt,omitempty"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

// ExportNote is a note with an optional user-visible project name.
type ExportNote struct {
	Body      string    `json:"body"`
	Project   string    `json:"project,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// TransferService exports a user's data.
type TransferService struct {
	store *repo.Store
	todos *TodoService
}

// NewTransferService builds a TransferService.
func NewTransferService(store *repo.Store, todos *TodoService) *TransferService {
	return &TransferService{store: store, todos: todos}
}

// Gather collects everything belonging to a user.
func (s *TransferService) Gather(ctx context.Context, userID int64) (*Export, error) {
	contexts, err := s.store.Contexts.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	projects, err := s.store.Projects.List(ctx, userID, "")
	if err != nil {
		return nil, err
	}
	todos, err := s.store.Todos.List(ctx, userID, repo.TodoFilter{})
	if err != nil {
		return nil, err
	}
	if err := s.todos.attachTags(ctx, userID, todos); err != nil {
		return nil, err
	}
	recurring, err := s.store.Recurring.List(ctx, userID, "")
	if err != nil {
		return nil, err
	}
	notes, err := s.store.Notes.List(ctx, userID, nil)
	if err != nil {
		return nil, err
	}
	contextNames := make(map[int64]string, len(contexts))
	outContexts := make([]ExportContext, 0, len(contexts))
	for _, c := range contexts {
		contextNames[c.ID] = c.Name
		outContexts = append(outContexts, ExportContext{Name: c.Name, State: c.State})
	}
	projectNames := make(map[int64]string, len(projects))
	outProjects := make([]ExportProject, 0, len(projects))
	for _, p := range projects {
		projectNames[p.ID] = p.Name
		out := ExportProject{Name: p.Name, Description: p.Description, State: p.State, CompletedAt: p.CompletedAt, LastReviewed: p.LastReviewed}
		if p.DefaultContextID != nil {
			out.DefaultContext = contextNames[*p.DefaultContextID]
		}
		outProjects = append(outProjects, out)
	}
	outTodos := make([]ExportTodo, 0, len(todos))
	for _, t := range todos {
		out := ExportTodo{Description: t.Description, Context: contextNames[t.ContextID], Notes: t.Notes, State: t.State, Due: t.Due, ShowFrom: t.ShowFrom, CompletedAt: t.CompletedAt, Starred: t.Starred, Tags: t.Tags, CreatedAt: t.CreatedAt}
		if t.ProjectID != nil {
			out.Project = projectNames[*t.ProjectID]
		}
		outTodos = append(outTodos, out)
	}
	outRecurring := make([]ExportRecurring, 0, len(recurring))
	for _, r := range recurring {
		out := ExportRecurring{Description: r.Description, Context: contextNames[r.ContextID], Notes: r.Notes, State: r.State, Period: r.Period, EveryN: r.EveryN, Weekdays: r.Weekdays, DayOfMonth: r.DayOfMonth, MonthOfYear: r.MonthOfYear, ShowFromDays: r.ShowFromDays, StartFrom: r.StartFrom, EndDate: r.EndDate, LastSpawnedAt: r.LastSpawnedAt, CompletedAt: r.CompletedAt, CreatedAt: r.CreatedAt}
		if r.ProjectID != nil {
			out.Project = projectNames[*r.ProjectID]
		}
		outRecurring = append(outRecurring, out)
	}
	outNotes := make([]ExportNote, 0, len(notes))
	for _, n := range notes {
		out := ExportNote{Body: n.Body, CreatedAt: n.CreatedAt}
		if n.ProjectID != nil {
			out.Project = projectNames[*n.ProjectID]
		}
		outNotes = append(outNotes, out)
	}
	return &Export{ExportedAt: time.Now(), Contexts: outContexts, Projects: outProjects, Todos: outTodos, Recurring: outRecurring, Notes: outNotes}, nil
}

// WriteJSON serializes an export as JSON.
func (e *Export) WriteJSON(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(e)
}
