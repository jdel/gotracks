package domain

import (
	"time"

	"github.com/uptrace/bun"
)

// Audit outcomes.
const (
	AuditSuccess = "success"
	AuditFailure = "failure"
)

// Audit actions. Grouped by prefix so the filter can offer them sensibly, and
// named for what happened rather than for the endpoint that happened to serve
// it — an endpoint can be renamed, a recorded fact cannot.
const (
	AuditRegisterRequested = "account.register.requested"
	AuditRegisterRejected  = "account.register.rejected"
	AuditRegisterCompleted = "account.register.completed"

	AuditLoginSucceeded = "account.login.succeeded"
	AuditLoginFailed    = "account.login.failed"

	AuditPasswordResetRequested = "account.password.reset_requested"
	AuditPasswordReset          = "account.password.reset"
	AuditPasswordChanged        = "account.password.changed"

	AuditEmailChangeRequested = "account.email.change_requested"
	AuditEmailChanged         = "account.email.changed"
	AuditEmailVerified        = "account.email.verified"

	AuditTwoFactorEnabled  = "account.2fa.enabled"
	AuditTwoFactorDisabled = "account.2fa.disabled"
	AuditPasskeyAdded      = "account.passkey.added"
	AuditPasskeyRemoved    = "account.passkey.removed"

	AuditAccountDeletionRequested = "account.deletion_requested"
	AuditAccountDeleted           = "account.deleted"
	AuditLegalAccepted            = "account.legal_accepted"
	AuditSessionRevoked           = "account.session_revoked"

	AuditAdminUserCreated      = "admin.user.created"
	AuditAdminUserUpdated      = "admin.user.updated"
	AuditAdminUserDeleted      = "admin.user.deleted"
	AuditAdminTwoFactorReset   = "admin.user.2fa_reset"
	AuditAdminInvitationResent = "admin.user.invitation_resent"
	AuditAdminSettingsUpdated  = "admin.settings.updated"
	AuditAdminLogLevelChanged  = "admin.log_level.changed"
	AuditAdminLegalUpdated     = "admin.legal.updated"

	// Reading the log is itself an administrative act on everyone else's
	// history, so it leaves a trace like any other.
	AuditAdminAuditSearched = "admin.audit.searched"
	AuditAdminAuditExported = "admin.audit.exported"
)

// AuditActions lists every action, for the filter in the admin screen.
var AuditActions = []string{
	AuditRegisterRequested, AuditRegisterRejected, AuditRegisterCompleted,
	AuditLoginSucceeded, AuditLoginFailed,
	AuditPasswordResetRequested, AuditPasswordReset, AuditPasswordChanged,
	AuditEmailChangeRequested, AuditEmailChanged, AuditEmailVerified,
	AuditTwoFactorEnabled, AuditTwoFactorDisabled,
	AuditPasskeyAdded, AuditPasskeyRemoved,
	AuditAccountDeletionRequested, AuditAccountDeleted, AuditLegalAccepted,
	AuditSessionRevoked,
	AuditAdminUserCreated, AuditAdminUserUpdated, AuditAdminUserDeleted,
	AuditAdminTwoFactorReset, AuditAdminInvitationResent,
	AuditAdminSettingsUpdated, AuditAdminLogLevelChanged, AuditAdminLegalUpdated,
	AuditAdminAuditSearched, AuditAdminAuditExported,
}

// AuditEvent is one recorded thing that happened.
//
// Append-only by construction: the repository offers no update and no delete,
// and the account purge deliberately leaves these rows alone. A log that the
// subject of an entry can erase is not a log.
//
// Addresses are stored as they were at the time rather than as a foreign key.
// An account can be deleted while its history has to remain readable, and
// "user 41" means nothing once user 41 is gone.
//
// Never holds a secret: no password, hash, token, recovery code or session id.
// What it does hold — who, what, when, from where, with which browser — is kept
// under legitimate interest in running the service securely, which is a
// different basis from the account data itself and survives its erasure.
type AuditEvent struct {
	bun.BaseModel `bun:"table:audit_events,alias:audit"`

	ID         int64     `bun:"id,pk,autoincrement" json:"id"`
	OccurredAt time.Time `bun:"occurred_at,notnull" json:"occurredAt"`
	Action     string    `bun:"action,notnull" json:"action"`
	Outcome    string    `bun:"outcome,notnull" json:"outcome"`

	// ActorID is who did it, nil when nobody was signed in — a stranger
	// registering, or a failed sign-in.
	ActorID    *int64 `bun:"actor_id" json:"actorId,omitempty"`
	ActorEmail string `bun:"actor_email" json:"actorEmail,omitempty"`

	// TargetID and TargetEmail are who it was done to, when that differs from
	// the actor: an administrator deleting somebody else's account.
	TargetID    *int64 `bun:"target_id" json:"targetId,omitempty"`
	TargetEmail string `bun:"target_email" json:"targetEmail,omitempty"`

	IP        string `bun:"ip" json:"ip,omitempty"`
	UserAgent string `bun:"user_agent" json:"userAgent,omitempty"`
	// Detail is a short human-readable note: which field changed, why a
	// registration was refused. Never a credential.
	Detail string `bun:"detail" json:"detail,omitempty"`
	// Hash is a SHA-256, hex-encoded, of the exact bytes an export produced.
	// Set only on an export event, so a copy of the file can be proven genuine
	// without the log keeping a second copy of everyone's history at rest.
	Hash string `bun:"hash" json:"hash,omitempty"`
}
