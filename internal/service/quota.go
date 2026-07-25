package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/jdel/gotracks/internal/repo"
)

// ErrQuotaExceeded reports that an account has reached one of its limits.
var ErrQuotaExceeded = errors.New("account limit reached")

// QuotaError names the limit that was hit, so the message can say which one,
// what the ceiling is, and what the account holder can do about it.
//
// It satisfies errors.Is(err, ErrQuotaExceeded), so a caller that only cares
// about the kind of failure does not have to know about the type.
type QuotaError struct {
	// Resource is the plural noun for what ran out: "actions", "notes".
	Resource string
	// Limit is the ceiling as the user should read it: "200", "20 MB".
	Limit string
	// Remedy is the way out, phrased as a complete instruction.
	//
	// It only ever suggests something the account holder can do themselves.
	// Limits come from the --quota.* flags and are read once at startup, so
	// there is no "ask an administrator to raise it" — nobody can, short of
	// restarting the server with different flags.
	Remedy string
}

// Error reads as a sentence aimed at whoever hit the limit. A bare
// "action limit reached (200)" tells them the request failed but not which of
// their own actions would fix it, and every caller that surfaces this string
// would otherwise have to invent that guidance itself.
func (e *QuotaError) Error() string {
	return fmt.Sprintf("You have reached your limit of %s %s. %s", e.Limit, e.Resource, e.Remedy)
}

func (e *QuotaError) Is(target error) bool { return target == ErrQuotaExceeded }

// Quotas are the per-account limits. A zero or negative value means unlimited,
// which is what a single-user self-hosted instance wants.
type Quotas struct {
	StorageBytes int64
	Todos        int
	Projects     int
	Notes        int
	Contexts     int
	Tags         int
	Recurring    int
	// TagsPerTodo bounds one request rather than the account total. Tags are
	// created implicitly from an action's tag list, so without this a single
	// action can mint thousands of rows while costing one against the action
	// allowance — the amplifier the other limits do not catch.
	TagsPerTodo int
}

// QuotaService enforces per-account limits.
//
// Public multi-tenant means every signup is a potential source of unbounded
// growth; without these one account can fill the disk for everybody.
type QuotaService struct {
	quotas      Quotas
	todos       repo.TodoRepo
	projects    repo.ProjectRepo
	notes       repo.NoteRepo
	attachments repo.AttachmentRepo
	contexts    repo.ContextRepo
	tags        repo.TagRepo
	recurring   repo.RecurringTodoRepo
	guard       repo.UserGuard
}

// NewQuotaService builds the service.
func NewQuotaService(q Quotas, store *repo.Store) *QuotaService {
	return &QuotaService{
		quotas:      q,
		guard:       store.Guard,
		todos:       store.Todos,
		projects:    store.Projects,
		notes:       store.Notes,
		attachments: store.Attachments,
		contexts:    store.Contexts,
		tags:        store.Tags,
		recurring:   store.Recurring,
	}
}

// Guard runs fn with exclusive access to one account's quota-bounded work.
//
// Every Check* below reads current usage and its caller then inserts, so the
// two have to be held together or concurrent requests each pass the check and
// all insert. Callers wrap the whole check-and-create sequence, including any
// context or project created implicitly along the way.
//
// Guards never nest: an entry point that takes one must not call another that
// does. A nil service runs fn unserialized, which is what the tests that build
// services without quotas rely on.
func (s *QuotaService) Guard(ctx context.Context, userID int64, fn func(context.Context) error) error {
	if s == nil || s.guard == nil {
		return fn(ctx)
	}
	return s.guard.WithUser(ctx, userID, fn)
}

// checkCount is the shared shape: unlimited when the limit is not positive,
// otherwise refuse once the account is already at it.
func checkCount(limit, used int, resource, remedy string) error {
	if limit <= 0 || used < limit {
		return nil
	}
	return &QuotaError{Resource: resource, Limit: fmt.Sprintf("%d", limit), Remedy: remedy}
}

// CheckTodo reports whether another action may be created.
func (s *QuotaService) CheckTodo(ctx context.Context, userID int64) error {
	if s == nil || s.quotas.Todos <= 0 {
		return nil
	}
	used, err := s.todos.CountForUser(ctx, userID)
	if err != nil {
		return err
	}
	return checkCount(s.quotas.Todos, used, "actions", "Delete some completed actions to make room.")
}

// CheckProject reports whether another project may be created.
func (s *QuotaService) CheckProject(ctx context.Context, userID int64) error {
	if s == nil || s.quotas.Projects <= 0 {
		return nil
	}
	used, err := s.projects.CountForUser(ctx, userID)
	if err != nil {
		return err
	}
	return checkCount(s.quotas.Projects, used, "projects", "Delete a project you no longer need.")
}

// CheckNote reports whether another note may be created.
func (s *QuotaService) CheckNote(ctx context.Context, userID int64) error {
	if s == nil || s.quotas.Notes <= 0 {
		return nil
	}
	used, err := s.notes.CountForUser(ctx, userID)
	if err != nil {
		return err
	}
	return checkCount(s.quotas.Notes, used, "notes", "Delete some notes you no longer need.")
}

// CheckContext reports whether another context may be created.
func (s *QuotaService) CheckContext(ctx context.Context, userID int64) error {
	if s == nil || s.quotas.Contexts <= 0 {
		return nil
	}
	used, err := s.contexts.CountForUser(ctx, userID)
	if err != nil {
		return err
	}
	return checkCount(s.quotas.Contexts, used, "contexts", "Delete a context you no longer use.")
}

// CheckRecurring reports whether another recurrence may be created.
func (s *QuotaService) CheckRecurring(ctx context.Context, userID int64) error {
	if s == nil || s.quotas.Recurring <= 0 {
		return nil
	}
	used, err := s.recurring.CountForUser(ctx, userID)
	if err != nil {
		return err
	}
	return checkCount(s.quotas.Recurring, used, "recurring actions", "Delete a recurrence you no longer need.")
}

// CheckTags bounds both the tags carried by one request and the account total.
//
// The per-request cap matters most: tags are created as a side effect of an
// action's tag list, so one request could otherwise write thousands of rows.
func (s *QuotaService) CheckTags(ctx context.Context, userID int64, names []string) error {
	if s == nil {
		return nil
	}
	names = normalizeTags(names)
	if s.quotas.TagsPerTodo > 0 && len(names) > s.quotas.TagsPerTodo {
		return &QuotaError{
			Resource: "tags on one action",
			Limit:    fmt.Sprintf("%d", s.quotas.TagsPerTodo),
			Remedy:   "Use fewer tags on this action.",
		}
	}
	if s.quotas.Tags <= 0 {
		return nil
	}
	existing, err := s.tags.List(ctx, userID)
	if err != nil {
		return err
	}
	known := make(map[string]struct{}, len(existing))
	for _, tag := range existing {
		known[tag.Name] = struct{}{}
	}
	adding := 0
	for _, name := range names {
		if _, ok := known[name]; !ok {
			adding++
		}
	}
	if len(existing)+adding <= s.quotas.Tags {
		return nil
	}
	return &QuotaError{
		Resource: "tags",
		Limit:    fmt.Sprintf("%d", s.quotas.Tags),
		Remedy:   "Remove tags you no longer use.",
	}
}

// CheckStorage reports whether adding size bytes would exceed the allowance.
//
// Checked before the upload is read, so a file that cannot be kept is refused
// rather than streamed to disk and then deleted.
func (s *QuotaService) CheckStorage(ctx context.Context, userID, size int64) error {
	if s == nil || s.quotas.StorageBytes <= 0 {
		return nil
	}
	used, err := s.attachments.TotalBytesForUser(ctx, userID)
	if err != nil {
		return err
	}
	if used+size <= s.quotas.StorageBytes {
		return nil
	}
	return &QuotaError{
		Resource: "storage",
		Limit:    fmt.Sprintf("%d MB", s.quotas.StorageBytes/(1024*1024)),
		Remedy:   "Delete some attachments to free space.",
	}
}

// Usage is what an account has consumed, for showing in the UI.
type Usage struct {
	StorageBytes   int64 `json:"storageBytes"`
	StorageLimit   int64 `json:"storageLimit"`
	Todos          int   `json:"todos"`
	TodoLimit      int   `json:"todoLimit"`
	Projects       int   `json:"projects"`
	ProjectLimit   int   `json:"projectLimit"`
	Notes          int   `json:"notes"`
	NoteLimit      int   `json:"noteLimit"`
	Contexts       int   `json:"contexts"`
	ContextLimit   int   `json:"contextLimit"`
	Tags           int   `json:"tags"`
	TagLimit       int   `json:"tagLimit"`
	Recurring      int   `json:"recurring"`
	RecurringLimit int   `json:"recurringLimit"`
}

// Usage reports current consumption against the limits.
func (s *QuotaService) Usage(ctx context.Context, userID int64) (*Usage, error) {
	bytes, err := s.attachments.TotalBytesForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	todos, err := s.todos.CountForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	projects, err := s.projects.CountForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	notes, err := s.notes.CountForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	contexts, err := s.contexts.CountForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	tags, err := s.tags.CountForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	recurring, err := s.recurring.CountForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &Usage{
		StorageBytes: bytes, StorageLimit: s.quotas.StorageBytes,
		Todos: todos, TodoLimit: s.quotas.Todos,
		Projects: projects, ProjectLimit: s.quotas.Projects,
		Notes: notes, NoteLimit: s.quotas.Notes,
		Contexts: contexts, ContextLimit: s.quotas.Contexts,
		Tags: tags, TagLimit: s.quotas.Tags,
		Recurring: recurring, RecurringLimit: s.quotas.Recurring,
	}, nil
}
