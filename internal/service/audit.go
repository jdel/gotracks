package service

import (
	"context"
	"slices"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// AuditService records what happened and answers questions about it.
type AuditService struct {
	audit repo.AuditRepo
}

// NewAuditService builds the service.
func NewAuditService(a repo.AuditRepo) *AuditService { return &AuditService{audit: a} }

// Entry is one thing to record. Everything except the action is optional: a
// failed sign-in has no actor id, a self-service change has no separate target.
type Entry struct {
	Action      string
	Outcome     string
	ActorID     *int64
	ActorEmail  string
	TargetID    *int64
	TargetEmail string
	IP          string
	UserAgent   string
	Detail      string
	// Hash is a hex SHA-256 of an export's bytes, set only on export events.
	Hash string
}

// maxUserAgent bounds what a client can write into the log. User agents are
// caller-supplied and the table is never pruned, so an unbounded one is a way
// to grow the database from outside.
const maxUserAgent = 400

// Record writes an entry.
//
// It never returns an error, and callers deliberately do not check one: an
// audit write must not turn a successful password change into a failed
// request. A log that cannot be written is logged instead, which is the one
// failure mode where the operator has to find out from the process output.
func (s *AuditService) Record(ctx context.Context, e Entry) {
	if s == nil {
		return
	}
	if e.Outcome == "" {
		e.Outcome = domain.AuditSuccess
	}
	if len(e.UserAgent) > maxUserAgent {
		e.UserAgent = e.UserAgent[:maxUserAgent]
	}
	event := &domain.AuditEvent{
		OccurredAt:  time.Now(),
		Action:      e.Action,
		Outcome:     e.Outcome,
		ActorID:     e.ActorID,
		ActorEmail:  e.ActorEmail,
		TargetID:    e.TargetID,
		TargetEmail: e.TargetEmail,
		IP:          e.IP,
		UserAgent:   e.UserAgent,
		Detail:      e.Detail,
		Hash:        e.Hash,
	}
	// Detached from the request: a client that goes away mid-request must not
	// take the record of what it just did with it.
	if err := s.audit.Append(context.WithoutCancel(ctx), event); err != nil {
		log.Error().Err(err).
			Str("action", e.Action).
			Str("outcome", e.Outcome).
			Msg("could not write an audit entry")
	}
}

// Purge drops entries past the retention window, reporting how many went.
//
// A window of zero keeps everything, which is the honest escape hatch for an
// operator whose own obligations require it — but it is not the default,
// because "forever" is difficult to defend as no longer than necessary.
func (s *AuditService) Purge(ctx context.Context, retention time.Duration) (int, error) {
	if s == nil || retention <= 0 {
		return 0, nil
	}
	return s.audit.PurgeBefore(ctx, time.Now().Add(-retention))
}

// AuditPage is one page of the log with the total that matched the filter.
type AuditPage struct {
	Items []*domain.AuditEvent `json:"items"`
	Total int                  `json:"total"`
}

// MaxAuditPageSize bounds one request. The export path asks for everything that
// matched instead, which is a deliberate, separate choice.
const MaxAuditPageSize = 200

// Search returns one page of the log, newest first.
func (s *AuditService) Search(
	ctx context.Context, f repo.AuditFilter, page, pageSize int,
) (*AuditPage, error) {
	if err := validateAuditFilter(f); err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > MaxAuditPageSize {
		pageSize = 50
	}
	items, total, err := s.audit.Search(ctx, f, (page-1)*pageSize, pageSize)
	if err != nil {
		return nil, err
	}
	return &AuditPage{Items: items, Total: total}, nil
}

// All returns every event matching the filter, for export. Unpaged on purpose:
// an export of "the current filter" that silently stopped at one page would be
// worse than no export.
func (s *AuditService) All(ctx context.Context, f repo.AuditFilter) ([]*domain.AuditEvent, error) {
	if err := validateAuditFilter(f); err != nil {
		return nil, err
	}
	items, _, err := s.audit.Search(ctx, f, 0, 0)
	return items, err
}

// validateAuditFilter refuses an action or outcome the log cannot contain,
// rather than quietly returning nothing and letting the reader conclude the
// event never happened.
func validateAuditFilter(f repo.AuditFilter) error {
	if f.Action != "" && !slices.Contains(domain.AuditActions, f.Action) {
		return ErrValidation
	}
	if f.Outcome != "" && f.Outcome != domain.AuditSuccess && f.Outcome != domain.AuditFailure {
		return ErrValidation
	}
	if f.From != nil && f.To != nil && f.To.Before(*f.From) {
		return ErrValidation
	}
	return nil
}
