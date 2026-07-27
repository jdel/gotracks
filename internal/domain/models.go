// Package domain holds the core data models shared across layers.
package domain

import (
	"time"

	"github.com/uptrace/bun"
)

// ContextState / ProjectState / TodoState enumerate lifecycle states.
const (
	StateActive    = "active"
	StateHidden    = "hidden"
	StateCompleted = "completed"
	StateDeferred  = "deferred"
)

// User is an account with its own private GTD data.
type User struct {
	bun.BaseModel `bun:"table:users,alias:u"`

	ID int64 `bun:"id,pk,autoincrement" json:"id"`
	// Email is the account identity: unique, required, and stored lower-cased.
	// There is no separate username — one fewer thing to choose, to remember,
	// and to have to police for impersonation.
	Email    string `bun:"email,unique,notnull" json:"email"`
	Password string `bun:"password,notnull" json:"-"`
	// EmailVerifiedAt is nil until the address is proven. Nullable, so it can
	// be added to a populated table.
	EmailVerifiedAt *time.Time `bun:"email_verified_at" json:"emailVerifiedAt,omitempty"`
	IsAdmin         bool       `bun:"is_admin,notnull" json:"isAdmin"`
	CreatedAt       time.Time  `bun:"created_at,notnull" json:"createdAt"`
	UpdatedAt       time.Time  `bun:"updated_at,notnull" json:"updatedAt"`
}

// PendingEnrollment is a bounded, unverified public signup. It becomes a User
// only after the emailed token is redeemed and a password is chosen.
type PendingEnrollment struct {
	bun.BaseModel `bun:"table:pending_enrollments,alias:pe"`

	Email     string `bun:"email,pk" json:"-"`
	TokenHash string `bun:"token_hash,unique,notnull" json:"-"`
	Locale    string `bun:"locale,notnull" json:"-"`
	TimeZone  string `bun:"time_zone,notnull" json:"-"`

	ExpiresAt time.Time `bun:"expires_at,notnull" json:"-"`
	CreatedAt time.Time `bun:"created_at,notnull" json:"-"`
}

// RefreshToken is a persisted, rotatable refresh token (stored hashed).
type RefreshToken struct {
	bun.BaseModel `bun:"table:refresh_tokens,alias:rt"`

	ID        int64  `bun:"id,pk,autoincrement" json:"-"`
	UserID    int64  `bun:"user_id,notnull" json:"-"`
	TokenHash string `bun:"token_hash,unique,notnull" json:"-"`
	// SessionID is stable across the token's rotation, so the chain of refresh
	// tokens one sign-in produces reads as a single session a user can see and
	// revoke. The access token carries it, which is how the current session is
	// told apart from the others in the list.
	SessionID string    `bun:"session_id,notnull" json:"-"`
	ExpiresAt time.Time `bun:"expires_at,notnull" json:"-"`
	CreatedAt time.Time `bun:"created_at,notnull" json:"-"`
	// StartedAt is when the session began, preserved as the token rotates, so
	// the list shows sign-in time rather than the last refresh.
	StartedAt time.Time `bun:"started_at,notnull" json:"-"`
	// LastUsedAt advances on every refresh: the session's last activity.
	LastUsedAt time.Time `bun:"last_used_at,notnull" json:"-"`
	// IP and UserAgent are the most recent seen, so a user recognises the
	// device — or spots one they do not.
	IP        string `bun:"ip" json:"-"`
	UserAgent string `bun:"user_agent" json:"-"`
}

// Project groups actions toward an outcome.
type Project struct {
	bun.BaseModel `bun:"table:projects,alias:p"`

	ID               int64      `bun:"id,pk,autoincrement" json:"id"`
	UserID           int64      `bun:"user_id,notnull" json:"-"`
	Name             string     `bun:"name,notnull" json:"name"`
	Description      string     `bun:"description" json:"description"`
	State            string     `bun:"state,notnull" json:"state"`
	Position         int        `bun:"position,notnull" json:"position"`
	DefaultContextID *int64     `bun:"default_context_id" json:"defaultContextId,omitempty"`
	CompletedAt      *time.Time `bun:"completed_at" json:"completedAt,omitempty"`
	LastReviewed     *time.Time `bun:"last_reviewed" json:"lastReviewed,omitempty"`
	CreatedAt        time.Time  `bun:"created_at,notnull" json:"createdAt"`
	UpdatedAt        time.Time  `bun:"updated_at,notnull" json:"updatedAt"`
}

// Todo is a single next action.
type Todo struct {
	bun.BaseModel `bun:"table:todos,alias:t"`

	ID              int64      `bun:"id,pk,autoincrement" json:"id"`
	UserID          int64      `bun:"user_id,notnull" json:"-"`
	ContextID       int64      `bun:"context_id,notnull" json:"contextId"`
	ProjectID       *int64     `bun:"project_id" json:"projectId,omitempty"`
	RecurringTodoID *int64     `bun:"recurring_todo_id" json:"recurringTodoId,omitempty"`
	Description     string     `bun:"description,notnull" json:"description"`
	Notes           string     `bun:"notes" json:"notes"`
	Due             *time.Time `bun:"due" json:"due,omitempty"`
	ShowFrom        *time.Time `bun:"show_from" json:"showFrom,omitempty"`
	CompletedAt     *time.Time `bun:"completed_at" json:"completedAt,omitempty"`
	State           string     `bun:"state,notnull" json:"state"`
	Starred         bool       `bun:"starred,notnull" json:"starred"`
	Position        int        `bun:"position,notnull" json:"position"`
	CreatedAt       time.Time  `bun:"created_at,notnull" json:"createdAt"`
	UpdatedAt       time.Time  `bun:"updated_at,notnull" json:"updatedAt"`

	// Tags is populated on read; not a stored column.
	Tags []string `bun:"-" json:"tags"`
}

// Recurrence periods for RecurringTodo.
const (
	PeriodDaily   = "daily"
	PeriodWeekly  = "weekly"
	PeriodMonthly = "monthly"
	PeriodYearly  = "yearly"
)

// RecurringTodo is a pattern that spawns todos on a schedule.
type RecurringTodo struct {
	bun.BaseModel `bun:"table:recurring_todos,alias:rec"`

	ID          int64  `bun:"id,pk,autoincrement" json:"id"`
	UserID      int64  `bun:"user_id,notnull" json:"-"`
	ContextID   int64  `bun:"context_id,notnull" json:"contextId"`
	ProjectID   *int64 `bun:"project_id" json:"projectId,omitempty"`
	Description string `bun:"description,notnull" json:"description"`
	Notes       string `bun:"notes" json:"notes"`
	State       string `bun:"state,notnull" json:"state"`

	// Pattern. EveryN applies to the chosen period (every 2 weeks, every 3 months…).
	Period      string `bun:"period,notnull" json:"period"`
	EveryN      int    `bun:"every_n,notnull" json:"everyN"`
	Weekdays    string `bun:"weekdays" json:"weekdays"`         // weekly: "1,3,5" (Sunday=0)
	DayOfMonth  int    `bun:"day_of_month" json:"dayOfMonth"`   // monthly/yearly
	MonthOfYear int    `bun:"month_of_year" json:"monthOfYear"` // yearly (1-12)

	// ShowFromDays makes the spawned action appear this many days before it is due.
	ShowFromDays int `bun:"show_from_days,notnull" json:"showFromDays"`

	StartFrom     *time.Time `bun:"start_from" json:"startFrom,omitempty"`
	EndDate       *time.Time `bun:"end_date" json:"endDate,omitempty"`
	LastSpawnedAt *time.Time `bun:"last_spawned_at" json:"lastSpawnedAt,omitempty"`
	CompletedAt   *time.Time `bun:"completed_at" json:"completedAt,omitempty"`
	CreatedAt     time.Time  `bun:"created_at,notnull" json:"createdAt"`
	UpdatedAt     time.Time  `bun:"updated_at,notnull" json:"updatedAt"`
}

// Tag is a free-form label owned by a user.
type Tag struct {
	bun.BaseModel `bun:"table:tags,alias:tg"`

	ID     int64  `bun:"id,pk,autoincrement" json:"id"`
	UserID int64  `bun:"user_id,notnull" json:"-"`
	Name   string `bun:"name,notnull" json:"name"`
}

// Tagging links a tag to a todo.
type Tagging struct {
	bun.BaseModel `bun:"table:taggings,alias:tgg"`

	ID     int64 `bun:"id,pk,autoincrement" json:"-"`
	TagID  int64 `bun:"tag_id,notnull" json:"-"`
	TodoID int64 `bun:"todo_id,notnull" json:"-"`
	UserID int64 `bun:"user_id,notnull" json:"-"`
}

// Note is a free-form note attached to a project.
type Note struct {
	bun.BaseModel `bun:"table:notes,alias:n"`

	ID        int64     `bun:"id,pk,autoincrement" json:"id"`
	UserID    int64     `bun:"user_id,notnull" json:"-"`
	ProjectID *int64    `bun:"project_id" json:"projectId,omitempty"`
	Body      string    `bun:"body,notnull" json:"body"`
	CreatedAt time.Time `bun:"created_at,notnull" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull" json:"updatedAt"`
}

// SettingsID is the primary key of the single instance-settings row.
const SettingsID int64 = 1

// InstanceSettings holds server-wide settings an admin can change at runtime,
// without a restart or an environment change. Exactly one row exists.
type InstanceSettings struct {
	bun.BaseModel `bun:"table:instance_settings,alias:iset"`

	ID            int64 `bun:"id,pk" json:"-"`
	AllowRegister bool  `bun:"allow_register,notnull" json:"allowRegister"`
	// UsageReportAtMinute is the local wall-clock time of day the report runs.
	UsageReportAtMinute int        `bun:"usage_report_at_minute" json:"usageReportAtMinute"`
	UsageReportTimeZone string     `bun:"usage_report_time_zone" json:"usageReportTimeZone"`
	UsageReportRunAt    *time.Time `bun:"usage_report_run_at" json:"usageReportRunAt,omitempty"`
	UpdatedAt           time.Time  `bun:"updated_at,notnull" json:"updatedAt"`
}

// Credential is a WebAuthn passkey enrolled by a user.
type Credential struct {
	bun.BaseModel `bun:"table:credentials,alias:cred"`

	ID     int64  `bun:"id,pk,autoincrement" json:"id"`
	UserID int64  `bun:"user_id,notnull" json:"-"`
	Name   string `bun:"name,notnull" json:"name"`
	// CredentialID is the raw WebAuthn credential id, base64url encoded.
	CredentialID string `bun:"credential_id,unique,notnull" json:"credentialId"`
	// PublicKey and Transport are stored as the library's serialized forms.
	PublicKey       string     `bun:"public_key,notnull" json:"-"`
	AttestationType string     `bun:"attestation_type" json:"-"`
	Transport       string     `bun:"transport" json:"-"`
	AAGUID          string     `bun:"aaguid" json:"-"`
	SignCount       uint32     `bun:"sign_count,notnull" json:"-"`
	BackupEligible  bool       `bun:"backup_eligible,notnull" json:"-"`
	BackupState     bool       `bun:"backup_state,notnull" json:"-"`
	CreatedAt       time.Time  `bun:"created_at,notnull" json:"createdAt"`
	LastUsedAt      *time.Time `bun:"last_used_at" json:"lastUsedAt,omitempty"`
}

// UsageSnapshot is one account's consumption as of the last report run.
//
// Computed periodically rather than on demand: the live per-account endpoint
// runs seven counts, which is fine for one user and not for a whole instance.
// One row per account, replaced by each run.
//
// Only raw counts are stored. Percentages are derived at read time against the
// limits currently configured — an earlier version stored the percentage, which
// silently went stale the moment the quotas were changed.
type UsageSnapshot struct {
	bun.BaseModel `bun:"table:usage_snapshots,alias:us"`

	UserID int64  `bun:"user_id,pk" json:"userId"`
	Email  string `bun:"email,notnull" json:"email"`

	StorageBytes int64 `bun:"storage_bytes,notnull" json:"storageBytes"`
	Todos        int   `bun:"todos,notnull" json:"todos"`
	Projects     int   `bun:"projects,notnull" json:"projects"`
	Notes        int   `bun:"notes,notnull" json:"notes"`
	Contexts     int   `bun:"contexts,notnull" json:"contexts"`
	Tags         int   `bun:"tags,notnull" json:"tags"`
	Recurring    int   `bun:"recurring,notnull" json:"recurring"`

	// Admin and TwoFactor are carried so the report can be filtered the same
	// way the user list is, without joining back to it.
	IsAdmin          bool `bun:"is_admin,notnull" json:"isAdmin"`
	TwoFactorEnabled bool `bun:"two_factor_enabled,notnull" json:"twoFactorEnabled"`

	GeneratedAt time.Time `bun:"generated_at,notnull" json:"generatedAt"`
}

// Ephemeral is short-lived server-side state addressed by an unguessable
// token: a WebAuthn ceremony, a pending two-factor
// challenge or enrolment.
//
// These all used to live in per-process maps, which is correct for one instance
// and silently wrong for several: each is a multi-step flow whose halves can
// land on different replicas. Sharing them through the database is what lets
// the service run without sticky sessions.
type Ephemeral struct {
	bun.BaseModel `bun:"table:ephemeral,alias:eph"`

	// ID is the token handed to the client. It is the primary key, so two
	// instances consuming one token race on the same row.
	ID   string `bun:"id,pk" json:"-"`
	Kind string `bun:"kind,notnull" json:"-"`
	// UserID is zero for state that is not yet tied to an account.
	UserID int64 `bun:"user_id,notnull" json:"-"`
	// Payload is the flow's own JSON state; empty when the token alone is it.
	Payload []byte `bun:"payload" json:"-"`
	// Attempts counts failed uses, for flows that allow a few tries.
	Attempts  int       `bun:"attempts,notnull" json:"-"`
	ExpiresAt time.Time `bun:"expires_at,notnull" json:"-"`
	CreatedAt time.Time `bun:"created_at,notnull" json:"-"`
}

// LoginAttempt counts consecutive failures for one login name, so an account
// can be slowed down independently of the IP a guess arrives from.
//
// Kept in the database rather than memory: the per-IP limiter already covers
// bursts from one source, and what this defends against is a distributed
// attempt spread thin across many addresses, which memory-per-process would
// lose on restart and never share between replicas.
type LoginAttempt struct {
	bun.BaseModel `bun:"table:login_attempts,alias:la"`

	// Email is stored lower-cased so casing cannot reset the count.
	Email       string     `bun:"email,pk" json:"-"`
	Failures    int        `bun:"failures,notnull" json:"-"`
	LockedUntil *time.Time `bun:"locked_until" json:"-"`
	UpdatedAt   time.Time  `bun:"updated_at,notnull" json:"-"`
}

// TwoFactor is a user's second-factor configuration. One row per user, keyed by
// user id like Preference.
//
// Secret is stored as plain base32. Encrypting it under a key derived from the
// JWT secret was considered and rejected: that secret is generated at startup
// when unset, which is the default for a self-hosted run, so a restart would
// orphan every enrolled authenticator and lock out exactly the users who took
// the security advice. An attacker able to read this table can already read the
// argon2 password hashes sitting beside it.
type TwoFactor struct {
	bun.BaseModel `bun:"table:two_factor,alias:tf"`

	UserID int64 `bun:"user_id,pk" json:"-"`
	// Enabled is only set once a generated code has verified, proving the
	// user's authenticator actually works.
	Enabled bool   `bun:"enabled,notnull" json:"enabled"`
	Secret  string `bun:"secret" json:"-"`
	// LastStep is the most recent accepted TOTP timestep. A code is only
	// accepted when its step is strictly greater, which is what stops a code
	// being replayed inside the skew window.
	LastStep  int64      `bun:"last_step,notnull" json:"-"`
	EnabledAt *time.Time `bun:"enabled_at" json:"enabledAt,omitempty"`
	UpdatedAt time.Time  `bun:"updated_at,notnull" json:"updatedAt"`
}

// RecoveryCode is a single-use fallback for a lost authenticator.
//
// Hashed with SHA-256 rather than argon2: the codes are 80 random bits, so
// there is no dictionary to stretch against, and a salted hash could not be
// looked up by value — verification would mean running argon2 once per stored
// code on an unauthenticated endpoint, which is a denial-of-service amplifier.
type RecoveryCode struct {
	bun.BaseModel `bun:"table:recovery_codes,alias:rc"`

	ID        int64      `bun:"id,pk,autoincrement" json:"-"`
	UserID    int64      `bun:"user_id,notnull" json:"-"`
	CodeHash  string     `bun:"code_hash,notnull" json:"-"`
	UsedAt    *time.Time `bun:"used_at" json:"usedAt,omitempty"`
	CreatedAt time.Time  `bun:"created_at,notnull" json:"createdAt"`
}

// Preference holds a user's display settings. One row per user.
type Preference struct {
	bun.BaseModel `bun:"table:preferences,alias:pref"`

	UserID       int64  `bun:"user_id,pk" json:"-"`
	DateFormat   string `bun:"date_format,notnull" json:"dateFormat"`
	TimeZone     string `bun:"time_zone,notnull" json:"timeZone"`
	Locale       string `bun:"locale,notnull" json:"locale"`
	Theme        string `bun:"theme,notnull" json:"theme"`          // light | dark | system
	WeekStart    int    `bun:"week_start,notnull" json:"weekStart"` // 0 = Sunday
	ReviewPeriod int    `bun:"review_period,notnull" json:"reviewPeriod"`
	// AutoDeleteAttachments is a pointer because older databases can contain
	// NULL in this column. Nil reads as off, same as false.
	AutoDeleteAttachments *bool     `bun:"auto_delete_attachments" json:"autoDeleteAttachments"`
	UpdatedAt             time.Time `bun:"updated_at,notnull" json:"updatedAt"`
}

// AutoDelete reports the effective auto-delete-attachments setting.
func (p *Preference) AutoDelete() bool {
	return p.AutoDeleteAttachments != nil && *p.AutoDeleteAttachments
}

// Attachment is a file attached to a todo. Bytes live on disk; this is metadata.
type Attachment struct {
	bun.BaseModel `bun:"table:attachments,alias:att"`

	ID          int64     `bun:"id,pk,autoincrement" json:"id"`
	UserID      int64     `bun:"user_id,notnull" json:"-"`
	TodoID      int64     `bun:"todo_id,notnull" json:"todoId"`
	FileName    string    `bun:"file_name,notnull" json:"fileName"`
	ContentType string    `bun:"content_type" json:"contentType"`
	Size        int64     `bun:"size,notnull" json:"size"`
	StoredName  string    `bun:"stored_name,notnull" json:"-"`
	CreatedAt   time.Time `bun:"created_at,notnull" json:"createdAt"`
}

// AttachmentWithTodo is an attachment plus enough about the action it belongs
// to for a listing to show which action it is attached to without a second
// round trip per row. Scan target only, not a real table.
type AttachmentWithTodo struct {
	ID              int64     `bun:"id" json:"id"`
	TodoID          int64     `bun:"todo_id" json:"todoId"`
	FileName        string    `bun:"file_name" json:"fileName"`
	ContentType     string    `bun:"content_type" json:"contentType"`
	Size            int64     `bun:"size" json:"size"`
	CreatedAt       time.Time `bun:"created_at" json:"createdAt"`
	TodoDescription string    `bun:"todo_description" json:"todoDescription"`
	TodoState       string    `bun:"todo_state" json:"todoState"`
}

// Context is where/how an action is performed (e.g. @home, @calls).
type Context struct {
	bun.BaseModel `bun:"table:contexts,alias:c"`

	ID        int64     `bun:"id,pk,autoincrement" json:"id"`
	UserID    int64     `bun:"user_id,notnull" json:"-"`
	Name      string    `bun:"name,notnull" json:"name"`
	Position  int       `bun:"position,notnull" json:"position"`
	State     string    `bun:"state,notnull" json:"state"`
	CreatedAt time.Time `bun:"created_at,notnull" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull" json:"updatedAt"`
}
