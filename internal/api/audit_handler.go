package api

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// auditHandler serves the administrator's view of the log.
type auditHandler struct {
	audit *service.AuditService
}

// auditFrom starts an entry from the request, filling in what only the HTTP
// layer knows: who is signed in, where they came from, and what they are
// using. Services stay free of request plumbing.
func auditFrom(r *http.Request, action string) service.Entry {
	e := service.Entry{
		Action:    action,
		Outcome:   domain.AuditSuccess,
		IP:        clientIP(r),
		UserAgent: r.UserAgent(),
	}
	if u := userFrom(r); u != nil {
		id := u.ID
		e.ActorID = &id
		e.ActorEmail = u.Email
	}
	return e
}

// auditFilterFrom reads the filter out of the query string. An unparseable date
// is treated as absent rather than refused: a filter is a view, and half a view
// beats an error page.
func auditFilterFrom(r *http.Request) repo.AuditFilter {
	q := r.URL.Query()
	f := repo.AuditFilter{
		Actor:   q.Get("actor"),
		Action:  q.Get("action"),
		Outcome: q.Get("outcome"),
	}
	if from, err := time.Parse(time.RFC3339, q.Get("from")); err == nil {
		f.From = &from
	}
	if to, err := time.Parse(time.RFC3339, q.Get("to")); err == nil {
		f.To = &to
	}
	return f
}

// list returns one page of the audit log.
//
//	@Summary	Search the audit log
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		from	query	string	false	"Earliest occurrence, RFC 3339"
//	@Param		to		query	string	false	"Latest occurrence, RFC 3339"
//	@Param		actor	query	string	false	"Match an address as actor or target"
//	@Param		action	query	string	false	"Exact action"
//	@Param		outcome	query	string	false	"success or failure"
//	@Param		page	query	int		false	"1-based page"
//	@Param		pageSize query	int		false	"Rows per page"
//	@Success	200	{object}	service.AuditPage
//	@Failure	400	{object}	errorBody
//	@Router		/api/v1/admin/audit [get]
func (h *auditHandler) list(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	filter := auditFilterFrom(r)
	result, err := h.audit.Search(r.Context(), filter, page, size)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	// Reading everyone else's history is itself an administrative act, so it
	// leaves a trace like any other. Recorded after the search so a refused
	// filter does not produce one.
	entry := auditFrom(r, domain.AuditAdminAuditSearched)
	entry.Detail = describeAuditFilter(filter)
	h.audit.Record(r.Context(), entry)
	writeJSON(w, http.StatusOK, result)
}

// auditColumns is the export layout, shared by both formats so a CSV and a JSON
// of the same search describe the same thing in the same order.
var auditColumns = []string{
	"occurredAt", "action", "outcome",
	"actorEmail", "targetEmail", "ip", "userAgent", "detail", "hash",
}

func auditRow(e *domain.AuditEvent) []string {
	return []string{
		e.OccurredAt.UTC().Format(time.RFC3339),
		e.Action, e.Outcome,
		e.ActorEmail, e.TargetEmail, e.IP, e.UserAgent, e.Detail, e.Hash,
	}
}

// export streams every event matching the current filter as JSON or CSV.
//
// The whole match rather than the visible page: an export that stopped at
// fifty rows without saying so would be worse than none.
//
//	@Summary	Export the filtered audit log
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		format	query	string	false	"json or csv"
//	@Success	200	{file}	binary
//	@Failure	400	{object}	errorBody
//	@Router		/api/v1/admin/audit/export [get]
func (h *auditHandler) export(w http.ResponseWriter, r *http.Request) {
	filter := auditFilterFrom(r)
	events, err := h.audit.All(r.Context(), filter)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	format := r.URL.Query().Get("format")
	if format != "csv" {
		format = "json"
	}
	stamp := time.Now().Format("2006-01-02")

	contentType := "application/json"
	if format == "csv" {
		contentType = "text/csv; charset=utf-8"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename=%q", "gotracks-audit-"+stamp+"."+format))

	// The fingerprint is of the whole export the server produces, not of
	// whatever a client happened to receive. The hasher comes first and the
	// response is wrapped so its errors never stop generation: a client that
	// disconnects mid-transfer must not truncate the hash or hide that the
	// export was released. sink also remembers whether any write to the client
	// failed, so the entry can say the delivery was cut short.
	hasher := sha256.New()
	client := &sink{w: w}
	out := io.MultiWriter(hasher, client)
	if format == "csv" {
		cw := csv.NewWriter(out)
		_ = cw.Write(auditColumns)
		for _, e := range events {
			_ = cw.Write(auditRow(e))
		}
		cw.Flush()
	} else {
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		_ = enc.Encode(events)
	}

	// Recorded after the bytes are produced, because that is when the hash
	// exists. An export takes a copy of other people's history out of the
	// service — the single most consequential thing this screen can do — so
	// the entry names who, with what filter, how much, and the fingerprint.
	// Detached from the request context in Record, so an aborted transfer still
	// leaves the trace.
	entry := auditFrom(r, domain.AuditAdminAuditExported)
	entry.Hash = hex.EncodeToString(hasher.Sum(nil))
	entry.Detail = fmt.Sprintf("%s, %d entries: %s", format, len(events), describeAuditFilter(filter))
	if client.failed {
		// The server released the data — that is the accountable fact and why
		// the outcome stays success — but the client did not receive all of it.
		entry.Detail += "; delivery interrupted"
	}
	h.audit.Record(r.Context(), entry)
}

// sink forwards to the response but never returns an error, so a client that
// goes away mid-export cannot stop the server generating (and hashing) the rest
// of it. It records that a write failed so the entry can note the truncation.
type sink struct {
	w      io.Writer
	failed bool
}

func (s *sink) Write(p []byte) (int, error) {
	if _, err := s.w.Write(p); err != nil {
		s.failed = true
	}
	return len(p), nil
}

// describeAuditFilter renders a filter for the log, so a recorded read says
// what was looked at rather than merely that somebody looked.
func describeAuditFilter(f repo.AuditFilter) string {
	var parts []string
	if f.From != nil {
		parts = append(parts, "from "+f.From.UTC().Format(time.RFC3339))
	}
	if f.To != nil {
		parts = append(parts, "to "+f.To.UTC().Format(time.RFC3339))
	}
	if f.Actor != "" {
		parts = append(parts, "person "+f.Actor)
	}
	if f.Action != "" {
		parts = append(parts, "action "+f.Action)
	}
	if f.Outcome != "" {
		parts = append(parts, "outcome "+f.Outcome)
	}
	if len(parts) == 0 {
		return "no filter"
	}
	return strings.Join(parts, ", ")
}

// actions lists every action the log can hold, so the filter offers exactly
// what exists rather than a hand-copied list that drifts.
//
//	@Summary	Audit action vocabulary
//	@Tags		admin
//	@Security	BearerAuth
//	@Success	200	{array}	string
//	@Router		/api/v1/admin/audit/actions [get]
func (h *auditHandler) actions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, domain.AuditActions)
}
