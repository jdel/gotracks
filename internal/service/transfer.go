package service

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// Export is the full portable snapshot of one user's data.
type Export struct {
	XMLName    xml.Name                `json:"-" yaml:"-" xml:"gotracks"`
	Version    int                     `json:"version" yaml:"version" xml:"version"`
	ExportedAt time.Time               `json:"exportedAt" yaml:"exportedAt" xml:"exportedAt"`
	Contexts   []*domain.Context       `json:"contexts" yaml:"contexts" xml:"contexts>context"`
	Projects   []*domain.Project       `json:"projects" yaml:"projects" xml:"projects>project"`
	Todos      []*domain.Todo          `json:"todos" yaml:"todos" xml:"todos>todo"`
	Recurring  []*domain.RecurringTodo `json:"recurring" yaml:"recurring" xml:"recurring>recurringTodo"`
	Notes      []*domain.Note          `json:"notes" yaml:"notes" xml:"notes>note"`
	Tags       []*domain.Tag           `json:"tags" yaml:"tags" xml:"tags>tag"`
}

// TransferService exports and imports a user's data.
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
	tags, err := s.store.Tags.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &Export{
		Version:    1,
		ExportedAt: time.Now(),
		Contexts:   contexts,
		Projects:   projects,
		Todos:      todos,
		Recurring:  recurring,
		Notes:      notes,
		Tags:       tags,
	}, nil
}

// WriteJSON serializes an export as JSON.
func (e *Export) WriteJSON(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(e)
}

// WriteYAML serializes an export as YAML.
func (e *Export) WriteYAML(w io.Writer) error {
	enc := yaml.NewEncoder(w)
	defer enc.Close()
	return enc.Encode(e)
}

// WriteXML serializes an export as XML.
func (e *Export) WriteXML(w io.Writer) error {
	if _, err := io.WriteString(w, xml.Header); err != nil {
		return err
	}
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	return enc.Encode(e)
}

// WriteCSV writes the actions as a flat CSV, the most useful table for a spreadsheet.
func (e *Export) WriteCSV(w io.Writer) error {
	cw := csv.NewWriter(w)
	defer cw.Flush()

	contextName := map[int64]string{}
	for _, c := range e.Contexts {
		contextName[c.ID] = c.Name
	}
	projectName := map[int64]string{}
	for _, p := range e.Projects {
		projectName[p.ID] = p.Name
	}

	if err := cw.Write([]string{
		"id", "description", "context", "project", "state", "starred",
		"due", "show_from", "completed_at", "tags", "notes", "created_at",
	}); err != nil {
		return err
	}
	for _, t := range e.Todos {
		project := ""
		if t.ProjectID != nil {
			project = projectName[*t.ProjectID]
		}
		row := []string{
			strconv.FormatInt(t.ID, 10),
			csvSafe(t.Description),
			csvSafe(contextName[t.ContextID]),
			csvSafe(project),
			t.State,
			strconv.FormatBool(t.Starred),
			formatTimePtr(t.Due),
			formatTimePtr(t.ShowFrom),
			formatTimePtr(t.CompletedAt),
			csvSafe(joinTags(t.Tags)),
			csvSafe(t.Notes),
			t.CreatedAt.Format(time.RFC3339),
		}
		if err := cw.Write(row); err != nil {
			return err
		}
	}
	return cw.Error()
}

// csvSafe neutralizes a value a spreadsheet would evaluate as a formula.
// The CSV export exists to be opened in Excel or LibreOffice, where a cell
// starting with one of these characters runs as code rather than showing text.
func csvSafe(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

func joinTags(tags []string) string {
	out := ""
	for i, t := range tags {
		if i > 0 {
			out += ","
		}
		out += t
	}
	return out
}

// ImportResult reports what an import created.
type ImportResult struct {
	Contexts  int `json:"contexts"`
	Projects  int `json:"projects"`
	Todos     int `json:"todos"`
	Recurring int `json:"recurring"`
	Notes     int `json:"notes"`
}

// Import loads a previously exported snapshot into a user's account.
// Everything is created fresh: ids from the file are remapped, so importing
// into an account that already has data merges rather than overwrites.
func (s *TransferService) Import(ctx context.Context, userID int64, data *Export) (*ImportResult, error) {
	res := &ImportResult{}
	now := time.Now()

	// Contexts first: todos reference them.
	contextIDs := map[int64]int64{}
	for _, c := range data.Contexts {
		fresh := &domain.Context{
			UserID:    userID,
			Name:      c.Name,
			Position:  c.Position,
			State:     orDefault(c.State, domain.StateActive),
			CreatedAt: orNow(c.CreatedAt, now),
			UpdatedAt: now,
		}
		if err := s.store.Contexts.Create(ctx, fresh); err != nil {
			return nil, err
		}
		contextIDs[c.ID] = fresh.ID
		res.Contexts++
	}

	projectIDs := map[int64]int64{}
	for _, p := range data.Projects {
		fresh := &domain.Project{
			UserID:      userID,
			Name:        p.Name,
			Description: p.Description,
			State:       orDefault(p.State, domain.StateActive),
			Position:    p.Position,
			CompletedAt: p.CompletedAt,
			CreatedAt:   orNow(p.CreatedAt, now),
			UpdatedAt:   now,
		}
		if p.DefaultContextID != nil {
			if mapped, ok := contextIDs[*p.DefaultContextID]; ok {
				fresh.DefaultContextID = &mapped
			}
		}
		if err := s.store.Projects.Create(ctx, fresh); err != nil {
			return nil, err
		}
		projectIDs[p.ID] = fresh.ID
		res.Projects++
	}

	for _, r := range data.Recurring {
		mappedContext, ok := contextIDs[r.ContextID]
		if !ok {
			// A pattern without its context cannot be recreated meaningfully.
			continue
		}
		fresh := &domain.RecurringTodo{
			UserID:        userID,
			ContextID:     mappedContext,
			Description:   r.Description,
			Notes:         r.Notes,
			State:         orDefault(r.State, domain.StateActive),
			Period:        r.Period,
			EveryN:        max(r.EveryN, 1),
			Weekdays:      r.Weekdays,
			DayOfMonth:    r.DayOfMonth,
			MonthOfYear:   r.MonthOfYear,
			ShowFromDays:  r.ShowFromDays,
			StartFrom:     r.StartFrom,
			EndDate:       r.EndDate,
			LastSpawnedAt: r.LastSpawnedAt,
			CreatedAt:     orNow(r.CreatedAt, now),
			UpdatedAt:     now,
		}
		if r.ProjectID != nil {
			if mapped, ok := projectIDs[*r.ProjectID]; ok {
				fresh.ProjectID = &mapped
			}
		}
		if err := s.store.Recurring.Create(ctx, fresh); err != nil {
			return nil, err
		}
		res.Recurring++
	}

	for _, t := range data.Todos {
		mappedContext, ok := contextIDs[t.ContextID]
		if !ok {
			continue
		}
		fresh := &domain.Todo{
			UserID:      userID,
			ContextID:   mappedContext,
			Description: t.Description,
			Notes:       t.Notes,
			Due:         t.Due,
			ShowFrom:    t.ShowFrom,
			CompletedAt: t.CompletedAt,
			State:       orDefault(t.State, domain.StateActive),
			Starred:     t.Starred,
			Position:    t.Position,
			CreatedAt:   orNow(t.CreatedAt, now),
			UpdatedAt:   now,
		}
		if t.ProjectID != nil {
			if mapped, ok := projectIDs[*t.ProjectID]; ok {
				fresh.ProjectID = &mapped
			}
		}
		if err := s.store.Todos.Create(ctx, fresh); err != nil {
			return nil, err
		}
		if len(t.Tags) > 0 {
			if err := s.store.Tags.SetForTodo(ctx, userID, fresh.ID, normalizeTags(t.Tags)); err != nil {
				return nil, err
			}
		}
		res.Todos++
	}

	for _, n := range data.Notes {
		fresh := &domain.Note{
			UserID:    userID,
			Body:      n.Body,
			CreatedAt: orNow(n.CreatedAt, now),
			UpdatedAt: now,
		}
		if n.ProjectID != nil {
			if mapped, ok := projectIDs[*n.ProjectID]; ok {
				fresh.ProjectID = &mapped
			}
		}
		if err := s.store.Notes.Create(ctx, fresh); err != nil {
			return nil, err
		}
		res.Notes++
	}

	return res, nil
}

// ParseImport decodes an export from JSON or YAML (format is auto-detected by
// trying JSON first, since valid JSON is also valid YAML but not vice versa).
//
// Unknown documents decode into an empty Export rather than failing, so the
// result is validated: an import that would create nothing is rejected instead
// of silently reporting success.
func ParseImport(data []byte) (*Export, error) {
	var out Export
	if err := json.Unmarshal(data, &out); err != nil {
		if err := yaml.Unmarshal(data, &out); err != nil {
			return nil, fmt.Errorf("import: not valid JSON or YAML: %w", err)
		}
	}
	if out.Version == 0 && out.isEmpty() {
		return nil, fmt.Errorf("import: not a gotracks export (no version and no data)")
	}
	return &out, nil
}

// isEmpty reports whether the snapshot carries nothing importable.
func (e *Export) isEmpty() bool {
	return len(e.Contexts) == 0 && len(e.Projects) == 0 && len(e.Todos) == 0 &&
		len(e.Recurring) == 0 && len(e.Notes) == 0 && len(e.Tags) == 0
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func orNow(t, now time.Time) time.Time {
	if t.IsZero() {
		return now
	}
	return t
}
