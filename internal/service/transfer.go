package service

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
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
	// Attachments describes the files carried alongside this JSON in the
	// archive. Metadata is listed even for a file that could not be read, so
	// the export says what existed rather than silently omitting it.
	Attachments []ExportAttachment `json:"attachments,omitempty"`
	// LegalAcceptedAt is when the account agreed to the terms. It is personal
	// data held about the account holder, so an export that leaves it out is
	// not the complete copy portability asks for.
	LegalAcceptedAt *time.Time `json:"legalAcceptedAt,omitempty"`
}

// ExportAttachment is one uploaded file, named by the action it belongs to
// rather than by a database id.
type ExportAttachment struct {
	Action      string    `json:"action"`
	FileName    string    `json:"fileName"`
	ContentType string    `json:"contentType,omitempty"`
	Size        int64     `json:"size"`
	CreatedAt   time.Time `json:"createdAt"`
	// Path locates the file inside the archive. Empty when the bytes could not
	// be read, which is what tells a reader the row outlived its file.
	Path string `json:"path,omitempty"`
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
	store       *repo.Store
	todos       *TodoService
	attachments *AttachmentService
}

// NewTransferService builds a TransferService.
func NewTransferService(store *repo.Store, todos *TodoService) *TransferService {
	return &TransferService{store: store, todos: todos}
}

// SetAttachments wires the attachment service so an export can carry the files
// themselves. Set separately to avoid a construction cycle; nil leaves the
// export to the JSON alone.
func (s *TransferService) SetAttachments(a *AttachmentService) { s.attachments = a }

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
	// Absent for accounts created before the documents were switched on.
	var acceptedAt *time.Time
	if row, err := s.store.Legal.AcceptanceForUser(ctx, userID); err == nil {
		at := row.AcceptedAt
		acceptedAt = &at
	} else if !errors.Is(err, repo.ErrNotFound) {
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
		out := ExportTodo{Description: t.Description, Context: contextNames[t.ContextID], State: t.State, Due: t.Due, ShowFrom: t.ShowFrom, CompletedAt: t.CompletedAt, Starred: t.Starred, Tags: t.Tags, CreatedAt: t.CreatedAt}
		if t.ProjectID != nil {
			out.Project = projectNames[*t.ProjectID]
		}
		outTodos = append(outTodos, out)
	}
	outRecurring := make([]ExportRecurring, 0, len(recurring))
	for _, r := range recurring {
		out := ExportRecurring{Description: r.Description, Context: contextNames[r.ContextID], State: r.State, Period: r.Period, EveryN: r.EveryN, Weekdays: r.Weekdays, DayOfMonth: r.DayOfMonth, MonthOfYear: r.MonthOfYear, ShowFromDays: r.ShowFromDays, StartFrom: r.StartFrom, EndDate: r.EndDate, LastSpawnedAt: r.LastSpawnedAt, CompletedAt: r.CompletedAt, CreatedAt: r.CreatedAt}
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
	return &Export{ExportedAt: time.Now(), Contexts: outContexts, Projects: outProjects, Todos: outTodos, Recurring: outRecurring, Notes: outNotes,
		LegalAcceptedAt: acceptedAt}, nil
}

// WriteJSON serializes an export as JSON.
func (e *Export) WriteJSON(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(e)
}

// exportJSONName is the archive member holding the structured export. Named so
// a person opening the zip knows which file to read first.
const exportJSONName = "export.json"

// WriteZip streams the whole export — the JSON plus every uploaded file — as a
// single archive.
//
// Portability is the other half of erasure: an account can already delete
// everything it owns, so it has to be able to take everything it owns. A JSON
// file that describes attachments without carrying them is not that.
//
// Written to the response as it is built rather than assembled in memory: an
// account at the default storage quota holds 500 MB of files, and buffering
// that per concurrent download is how a modest instance runs out of memory.
func (s *TransferService) WriteZip(ctx context.Context, w io.Writer, userID int64) error {
	data, err := s.Gather(ctx, userID)
	if err != nil {
		return err
	}

	var files []*domain.AttachmentWithTodo
	if s.attachments != nil {
		files, err = s.attachments.ListAll(ctx, userID)
		if err != nil {
			return err
		}
	}

	zw := zip.NewWriter(w)

	// Files first, and the manifest last, so it can describe what the archive
	// actually holds. A row whose file has gone is still listed — the export
	// should say what existed — but with no path, because a manifest promising
	// a member that is not there is worse than one that admits the gap.
	paths := archivePaths(files)
	data.Attachments = make([]ExportAttachment, 0, len(files))
	for i, f := range files {
		written, err := s.copyAttachment(ctx, zw, userID, f.ID, paths[i])
		if err != nil {
			return err
		}
		if !written {
			paths[i] = ""
		}
		data.Attachments = append(data.Attachments, ExportAttachment{
			Action:      f.TodoDescription,
			FileName:    f.FileName,
			ContentType: f.ContentType,
			Size:        f.Size,
			CreatedAt:   f.CreatedAt,
			Path:        paths[i],
		})
	}

	entry, err := zw.Create(exportJSONName)
	if err != nil {
		return err
	}
	if err := data.WriteJSON(entry); err != nil {
		return err
	}
	return zw.Close()
}

// copyAttachment writes one stored file into the archive, reporting whether it
// was there to write. A row whose file is gone is skipped rather than failing
// the export: one orphaned row must not cost the account every other file.
func (s *TransferService) copyAttachment(
	ctx context.Context, zw *zip.Writer, userID, id int64, path string,
) (bool, error) {
	_, file, err := s.attachments.Open(ctx, userID, id)
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	defer file.Close()

	entry, err := zw.Create(path)
	if err != nil {
		return false, err
	}
	if _, err := io.Copy(entry, file); err != nil {
		return false, err
	}
	return true, nil
}

// archivePaths assigns each attachment a unique, safe location in the archive.
//
// Filenames come from whoever uploaded them, so they are neither unique nor
// necessarily safe to write to a filesystem: two actions can both hold
// "notes.pdf", and a name is only ever as trustworthy as the client that sent
// it. Numbering the entries makes them unique, and stripping the name to a
// known-safe set keeps a hostile one from escaping the folder when somebody
// unpacks the archive.
func archivePaths(files []*domain.AttachmentWithTodo) []string {
	out := make([]string, len(files))
	for i, f := range files {
		out[i] = fmt.Sprintf("attachments/%d-%s", i+1, safeArchiveName(f.FileName))
	}
	return out
}

func safeArchiveName(name string) string {
	// Base first: a name carrying directories is not a filename, whatever the
	// upload validation allowed at the time it was stored.
	name = filepath.Base(strings.ReplaceAll(name, `\`, "/"))
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '-' || r == '_' || r == ' ':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	cleaned := strings.Trim(b.String(), " .")
	if cleaned == "" {
		return "file"
	}
	return cleaned
}
