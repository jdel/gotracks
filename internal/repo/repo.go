// Package repo defines storage interfaces and their bun-backed implementation.
// Handlers and services depend on these interfaces, never on a SQL dialect.
package repo

import (
	"context"
	"errors"
	"time"

	"github.com/jdel/gotracks/internal/domain"
)

// ErrNotFound is returned when a lookup matches no row.
var ErrNotFound = errors.New("repo: not found")

// ErrCapacity is returned when a bounded pending-state table is full.
var ErrCapacity = errors.New("repo: capacity reached")

// UserRepo stores user accounts.
type UserRepo interface {
	Create(ctx context.Context, u *domain.User) error
	Update(ctx context.Context, u *domain.User) error
	Delete(ctx context.Context, id int64) error
	ByEmail(ctx context.Context, email string) (*domain.User, error)
	ByID(ctx context.Context, id int64) (*domain.User, error)
	List(ctx context.Context) ([]*domain.User, error)
	// ListPage returns one filtered page of accounts, oldest first.
	ListPage(ctx context.Context, f UserFilter, offset, limit int) ([]*domain.User, error)
	Count(ctx context.Context) (int, error)
	// CountFiltered counts the accounts matching the same filter as ListPage,
	// so a page can report the total it belongs to.
	CountFiltered(ctx context.Context, f UserFilter) (int, error)
	CountAdmins(ctx context.Context) (int, error)
}

// UserFilter narrows the admin user list. Empty fields match everything; the
// tri-state strings are "on", "off" or "" like the usage report.
type UserFilter struct {
	Search    string
	Admin     string
	TwoFactor string
}

// PendingEnrollmentRepo stores public signups before mailbox proof.
type PendingEnrollmentRepo interface {
	// Replace stores at most one live token per email and never permits more
	// than max live rows globally.
	Replace(ctx context.Context, pending *domain.PendingEnrollment, max int) error
	ByTokenHash(ctx context.Context, tokenHash string) (*domain.PendingEnrollment, error)
	// Activate atomically consumes a live token and creates its user. The first
	// account to be activated becomes the sole administrator.
	Activate(ctx context.Context, tokenHash, passwordHash string) (*domain.PendingEnrollment, *domain.User, error)
	PurgeExpired(ctx context.Context, now time.Time) error
}

// SettingsRepo stores server-wide settings (a single row).
type SettingsRepo interface {
	Get(ctx context.Context, defaultAllowRegister bool) (*domain.InstanceSettings, error)
	Update(ctx context.Context, s *domain.InstanceSettings) error
}

// CredentialRepo stores WebAuthn passkeys.
type CredentialRepo interface {
	Create(ctx context.Context, c *domain.Credential) error
	ListForUser(ctx context.Context, userID int64) ([]*domain.Credential, error)
	ByCredentialID(ctx context.Context, credentialID string) (*domain.Credential, error)
	Update(ctx context.Context, c *domain.Credential) error
	Delete(ctx context.Context, userID, id int64) error
	DeleteForUser(ctx context.Context, userID int64) error
}

// TwoFactorRepo stores per-user second-factor configuration.
type TwoFactorRepo interface {
	// Get returns ErrNotFound when the user has never enrolled.
	Get(ctx context.Context, userID int64) (*domain.TwoFactor, error)
	Upsert(ctx context.Context, t *domain.TwoFactor) error
	// ConsumeStep advances the replay boundary only when step is newer than the
	// currently stored value. Concurrent reuse returns ErrNotFound.
	ConsumeStep(ctx context.Context, userID, step int64) error
	// EnabledUserIDs lists the users with 2FA on, so the admin screen can show
	// the flag without a query per row.
	EnabledUserIDs(ctx context.Context) ([]int64, error)
	// EnabledUserIDsIn lists which of the given users have 2FA on, so a paged
	// admin list only loads the flag for the page it shows.
	EnabledUserIDsIn(ctx context.Context, ids []int64) ([]int64, error)
	DeleteForUser(ctx context.Context, userID int64) error
}

// RecoveryCodeRepo stores single-use fallback codes.
type RecoveryCodeRepo interface {
	// ReplaceAll swaps a user's codes for a fresh set, so regenerating
	// invalidates every code issued before.
	ReplaceAll(ctx context.Context, userID int64, hashes []string) error
	// ByHash finds an unused code. Used codes report ErrNotFound.
	ByHash(ctx context.Context, userID int64, hash string) (*domain.RecoveryCode, error)
	// Consume marks a code used and reports ErrNotFound if it already was,
	// which is what makes a code single-use under concurrent attempts.
	Consume(ctx context.Context, id int64) error
	CountUnused(ctx context.Context, userID int64) (int, error)
	DeleteForUser(ctx context.Context, userID int64) error
}

// LoginAttemptRepo tracks consecutive failed sign-ins per email address.
type LoginAttemptRepo interface {
	// Get returns ErrNotFound when the address has no recorded failures.
	Get(ctx context.Context, email string) (*domain.LoginAttempt, error)
	// RecordFailure increments the counter and returns the updated row.
	RecordFailure(ctx context.Context, email string, lockFor time.Duration, threshold int) (*domain.LoginAttempt, error)
	// Clear removes the record after a successful sign-in.
	Clear(ctx context.Context, email string) error
	// PurgeBefore drops stale rows so the table does not grow without bound.
	PurgeBefore(ctx context.Context, cutoff time.Time) error
}

// UsageReportRepo stores the periodic per-account usage report.
type UsageReportRepo interface {
	// Aggregate computes every account's consumption with a handful of grouped
	// queries rather than a few per account, which is what makes the report
	// viable for a whole instance.
	Aggregate(ctx context.Context) ([]*domain.UsageSnapshot, error)
	// Replace swaps the stored report for a freshly computed one.
	Replace(ctx context.Context, snapshots []*domain.UsageSnapshot) error
	// List returns the stored report in one query, worst offenders first.
	List(ctx context.Context, limit int) ([]*domain.UsageSnapshot, error)
	DeleteForUser(ctx context.Context, userID int64) error
}

// EphemeralRepo stores short-lived, token-addressed state shared by every
// instance, so a flow started on one can be finished on another.
type EphemeralRepo interface {
	Put(ctx context.Context, e *domain.Ephemeral) error
	// ReplaceForUser keeps one live entry for a flow/account pair.
	ReplaceForUser(ctx context.Context, e *domain.Ephemeral) error
	// Peek reads a live entry without consuming it.
	Peek(ctx context.Context, kind, id string) (*domain.Ephemeral, error)
	// Take consumes a single-use entry. Exactly one caller can succeed for a
	// given token, however many instances race for it.
	Take(ctx context.Context, kind, id string) (*domain.Ephemeral, error)
	// Attempt records a failed use and returns the entry. Once maxAttempts is
	// reached the entry is destroyed and ErrNotFound is returned thereafter.
	Attempt(ctx context.Context, kind, id string, maxAttempts int) (*domain.Ephemeral, error)
	// CountForUser bounds how much pending state one account can accumulate.
	CountForUser(ctx context.Context, kind string, userID int64) (int, error)
	DeleteForUser(ctx context.Context, userID int64) error
	PurgeExpired(ctx context.Context, now time.Time) error
}

// AuditRepo stores the append-only audit log.
//
// Append and read only, deliberately: there is no update and no delete, and
// nothing removes an account's entries when the account goes. A log its own
// subject can edit or erase is not evidence of anything.
type AuditRepo interface {
	Append(ctx context.Context, e *domain.AuditEvent) error
	// Search returns one page of matching events, newest first, and the total
	// number that matched. A limit of zero returns every match, for export.
	Search(ctx context.Context, f AuditFilter, offset, limit int) ([]*domain.AuditEvent, int, error)
	// PurgeBefore drops entries older than the cutoff and reports how many
	// went. The only delete: retention is about age, never about a row.
	PurgeBefore(ctx context.Context, cutoff time.Time) (int, error)
}

// LegalRepo stores administrator replacements for the shipped legal documents.
// Only overrides are kept: an absent row means the default is in force.
type LegalRepo interface {
	Documents(ctx context.Context) ([]*domain.LegalDocument, error)
	Put(ctx context.Context, doc *domain.LegalDocument) error
	// Delete drops a replacement, restoring the shipped text.
	Delete(ctx context.Context, locale, kind string) error

	// Accept records that an account agreed at registration.
	Accept(ctx context.Context, userID int64) error
	AcceptanceForUser(ctx context.Context, userID int64) (*domain.LegalAcceptance, error)
	DeleteForUser(ctx context.Context, userID int64) error
}

// PreferenceRepo stores per-user display settings.
type PreferenceRepo interface {
	Get(ctx context.Context, userID int64) (*domain.Preference, error)
	Upsert(ctx context.Context, p *domain.Preference) error
	Delete(ctx context.Context, userID int64) error
}

// AttachmentRepo stores todo attachment metadata.
type AttachmentRepo interface {
	// TotalBytesForUser sums an account's stored files, for the storage quota.
	TotalBytesForUser(ctx context.Context, userID int64) (int64, error)
	Create(ctx context.Context, a *domain.Attachment) error
	ByID(ctx context.Context, userID, id int64) (*domain.Attachment, error)
	ListForTodo(ctx context.Context, userID, todoID int64) ([]*domain.Attachment, error)
	// ListForUser returns every attachment across all the user's todos, each
	// annotated with its todo's description and state, for the
	// attachments-overview page.
	ListForUser(ctx context.Context, userID int64) ([]*domain.AttachmentWithTodo, error)
	Delete(ctx context.Context, userID, id int64) error
	DeleteForTodo(ctx context.Context, userID, todoID int64) ([]*domain.Attachment, error)
	// DeleteForUser removes every attachment row of a user and returns them, so
	// the caller can delete the files they point at.
	DeleteForUser(ctx context.Context, userID int64) ([]*domain.Attachment, error)
}

// StatsRepo runs aggregate queries for the statistics dashboard.
type StatsRepo interface {
	CountByState(ctx context.Context, userID int64) (map[string]int, error)
	// AvgCompletionDays returns the mean days between creation and completion.
	AvgCompletionDays(ctx context.Context, userID int64) (float64, error)
	// CompletedSince returns completion timestamps after the given time.
	CompletedSince(ctx context.Context, userID int64, since time.Time) ([]time.Time, error)
	// CountPerContext returns open action counts keyed by context id.
	CountPerContext(ctx context.Context, userID int64) (map[int64]int, error)
	// OldestOpen returns the creation time of the oldest open action.
	OldestOpen(ctx context.Context, userID int64) (time.Time, error)
	CountProjectsByState(ctx context.Context, userID int64) (map[string]int, error)
}

// RefreshTokenRepo stores hashed refresh tokens.
type RefreshTokenRepo interface {
	Create(ctx context.Context, t *domain.RefreshToken) error
	ByHash(ctx context.Context, hash string) (*domain.RefreshToken, error)
	// Consume atomically removes a single-use token. A token already consumed
	// by another request returns ErrNotFound.
	Consume(ctx context.Context, hash string) error
	DeleteByHash(ctx context.Context, hash string) error
	DeleteForUser(ctx context.Context, userID int64) error
	// ListSessions returns a user's live sessions, newest activity first — one
	// row per session, since rotation leaves only the current token live.
	ListSessions(ctx context.Context, userID int64) ([]*domain.RefreshToken, error)
	// SessionLive reports whether a non-expired session with this id still
	// exists for the user. The access-token check uses it so revoking a session
	// invalidates its stateless access token immediately, not only at expiry.
	SessionLive(ctx context.Context, userID int64, sessionID string) (bool, error)
	// DeleteSession revokes one session by its stable id, scoped to the user so
	// nobody can revoke another account's session.
	DeleteSession(ctx context.Context, userID int64, sessionID string) error
	// DeleteOtherSessions revokes every session except the one to keep, for
	// "sign out everywhere else".
	DeleteOtherSessions(ctx context.Context, userID int64, keepSessionID string) error
}

// ContextRepo stores GTD contexts, always scoped by user.
type ContextRepo interface {
	Create(ctx context.Context, c *domain.Context) error
	Update(ctx context.Context, c *domain.Context) error
	Delete(ctx context.Context, userID, id int64) error
	ByID(ctx context.Context, userID, id int64) (*domain.Context, error)
	// ByName looks a context up case-insensitively, ignoring a leading "@".
	ByName(ctx context.Context, userID int64, name string) (*domain.Context, error)
	List(ctx context.Context, userID int64) ([]*domain.Context, error)
	CountForUser(ctx context.Context, userID int64) (int, error)
	MaxPosition(ctx context.Context, userID int64) (int, error)
	DeleteForUser(ctx context.Context, userID int64) error
}

// ProjectRepo stores projects, always scoped by user.
type ProjectRepo interface {
	Create(ctx context.Context, p *domain.Project) error
	Update(ctx context.Context, p *domain.Project) error
	Delete(ctx context.Context, userID, id int64) error
	ByID(ctx context.Context, userID, id int64) (*domain.Project, error)
	// ByName looks a project up case-insensitively, ignoring a leading "#".
	ByName(ctx context.Context, userID int64, name string) (*domain.Project, error)
	List(ctx context.Context, userID int64, state string) ([]*domain.Project, error)
	CountForUser(ctx context.Context, userID int64) (int, error)
	MaxPosition(ctx context.Context, userID int64) (int, error)
	DeleteForUser(ctx context.Context, userID int64) error
}

// TodoFilter narrows a todo listing.
type TodoFilter struct {
	State     string // "" = any
	ContextID *int64
	ProjectID *int64
	Starred   bool
	Tag       string
	// DueBefore limits to todos due strictly before this time.
	DueBefore *time.Time
}

// TodoRepo stores todos, always scoped by user.
type TodoRepo interface {
	Create(ctx context.Context, t *domain.Todo) error
	Update(ctx context.Context, t *domain.Todo) error
	Delete(ctx context.Context, userID, id int64) error
	ByID(ctx context.Context, userID, id int64) (*domain.Todo, error)
	List(ctx context.Context, userID int64, f TodoFilter) ([]*domain.Todo, error)
	MaxPosition(ctx context.Context, userID, contextID int64) (int, error)
	// ActivateDue flips deferred todos whose show_from has passed to active.
	ActivateDue(ctx context.Context, userID int64, now time.Time) error
	// CountByProject returns the number of todos per project for the user.
	CountByProject(ctx context.Context, userID int64, state string) (map[int64]int, error)
	// CountInContext counts the todos held by one context.
	CountInContext(ctx context.Context, userID, contextID int64) (int, error)
	// CountForUser counts every todo an account owns, for quota checks.
	CountForUser(ctx context.Context, userID int64) (int, error)
	// DetachProject clears the project of every todo pointing at it.
	DetachProject(ctx context.Context, userID, projectID int64) error
	DeleteForUser(ctx context.Context, userID int64) error
}

// TagRepo stores tags and their links to todos.
type TagRepo interface {
	List(ctx context.Context, userID int64) ([]*domain.Tag, error)
	CountForUser(ctx context.Context, userID int64) (int, error)
	EnsureAll(ctx context.Context, userID int64, names []string) ([]*domain.Tag, error)
	SetForTodo(ctx context.Context, userID, todoID int64, names []string) error
	ForTodos(ctx context.Context, userID int64, todoIDs []int64) (map[int64][]string, error)
	DeleteForTodo(ctx context.Context, userID, todoID int64) error
	// DeleteForUser removes a user's tags along with their taggings.
	DeleteForUser(ctx context.Context, userID int64) error
}

// RecurringTodoRepo stores recurrence patterns.
type RecurringTodoRepo interface {
	Create(ctx context.Context, r *domain.RecurringTodo) error
	Update(ctx context.Context, r *domain.RecurringTodo) error
	Delete(ctx context.Context, userID, id int64) error
	ByID(ctx context.Context, userID, id int64) (*domain.RecurringTodo, error)
	List(ctx context.Context, userID int64, state string) ([]*domain.RecurringTodo, error)
	// HasOpenInstance reports whether an uncompleted todo already exists for the pattern.
	HasOpenInstance(ctx context.Context, userID, recurringID int64) (bool, error)
	// CountInContext counts the patterns that spawn into one context.
	CountInContext(ctx context.Context, userID, contextID int64) (int, error)
	CountForUser(ctx context.Context, userID int64) (int, error)
	// DeleteForContext removes every pattern anchored to one context.
	DeleteForContext(ctx context.Context, userID, contextID int64) error
	// DetachProject clears the project of every pattern pointing at it.
	DetachProject(ctx context.Context, userID, projectID int64) error
	DeleteForUser(ctx context.Context, userID int64) error
}

// NoteRepo stores project notes.
type NoteRepo interface {
	Create(ctx context.Context, n *domain.Note) error
	Update(ctx context.Context, n *domain.Note) error
	Delete(ctx context.Context, userID, id int64) error
	ByID(ctx context.Context, userID, id int64) (*domain.Note, error)
	List(ctx context.Context, userID int64, projectID *int64) ([]*domain.Note, error)
	CountForUser(ctx context.Context, userID int64) (int, error)
	// DetachProject clears the project of every note pointing at it.
	DetachProject(ctx context.Context, userID, projectID int64) error
	// DeleteForProject removes every note attached to a project, for the
	// "delete its notes too" branch of a project delete.
	DeleteForProject(ctx context.Context, userID, projectID int64) error
	DeleteForUser(ctx context.Context, userID int64) error
}

// Store aggregates all repositories.
type Store struct {
	Users         UserRepo
	Enrollments   PendingEnrollmentRepo
	RefreshTokens RefreshTokenRepo
	Contexts      ContextRepo
	Projects      ProjectRepo
	Todos         TodoRepo
	Tags          TagRepo
	Notes         NoteRepo
	Recurring     RecurringTodoRepo
	Preferences   PreferenceRepo
	Attachments   AttachmentRepo
	Stats         StatsRepo
	Settings      SettingsRepo
	Credentials   CredentialRepo
	TwoFactor     TwoFactorRepo
	LoginAttempts LoginAttemptRepo
	Ephemeral     EphemeralRepo
	UsageReports  UsageReportRepo
	RecoveryCodes RecoveryCodeRepo
	Legal         LegalRepo
	Audit         AuditRepo
	// Guard serializes the quota-bounded writes of one account.
	Guard UserGuard
}
