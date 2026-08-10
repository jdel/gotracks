package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// adminHandler serves /admin/*. RequireAdmin gates every route.
type adminHandler struct {
	admin     *service.AdminService
	settings  *service.SettingsService
	twoFactor *service.TwoFactorService
	quotas    *service.QuotaService
	reports   *service.UsageReportService
	email     *service.EmailService
	audit     *service.AuditService
	logLevel  *service.LogLevelService
}

// maxLogOverrideMinutes bounds a runtime log-level override so a forgotten
// debug session cannot run unbounded.
const maxLogOverrideMinutes = 24 * 60

type logLevelRequest struct {
	Level           string `json:"level"`
	DurationMinutes int    `json:"durationMinutes"`
}

// getLogLevel reports the current level, the configured baseline, and when any
// active override reverts.
//
//	@Summary	Get the runtime log level
//	@Tags		admin
//	@Security	BearerAuth
//	@Success	200	{object}	service.LogLevelState
//	@Router		/api/v1/admin/log-level [get]
func (h *adminHandler) getLogLevel(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.logLevel.State())
}

// putLogLevel overrides the log level at runtime, reverting after the window.
//
//	@Summary	Override the runtime log level
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		body	body		logLevelRequest	true	"Level and duration"
//	@Success	200		{object}	service.LogLevelState
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/admin/log-level [put]
func (h *adminHandler) putLogLevel(w http.ResponseWriter, r *http.Request) {
	var req logLevelRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	level, err := zerolog.ParseLevel(req.Level)
	if err != nil || level == zerolog.NoLevel || level == zerolog.Disabled {
		writeError(w, http.StatusBadRequest, "unknown log level")
		return
	}
	if req.DurationMinutes < 0 || req.DurationMinutes > maxLogOverrideMinutes {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("duration must be between 0 and %d minutes", maxLogOverrideMinutes))
		return
	}

	// A request that would not change the level is a no-op: no override, and
	// nothing to record in the audit log.
	if level == zerolog.GlobalLevel() {
		writeJSON(w, http.StatusOK, h.logLevel.State())
		return
	}

	h.logLevel.Override(level, time.Duration(req.DurationMinutes)*time.Minute)

	entry := auditFrom(r, domain.AuditAdminLogLevelChanged)
	if req.DurationMinutes > 0 {
		entry.Detail = fmt.Sprintf("level %s for %d minutes", level, req.DurationMinutes)
	} else {
		entry.Detail = fmt.Sprintf("level %s (no auto-revert)", level)
	}
	h.audit.Record(r.Context(), entry)
	writeJSON(w, http.StatusOK, h.logLevel.State())
}

// auditTarget starts an entry naming the account an administrator acted on.
// Read before the action where the action destroys the account, since
// afterwards there is nothing left to name.
func (h *adminHandler) auditTarget(r *http.Request, action string, target *domain.User) service.Entry {
	e := auditFrom(r, action)
	if target != nil {
		id := target.ID
		e.TargetID, e.TargetEmail = &id, target.Email
	}
	return e
}

// adminUser is a user plus admin-only annotations. It embeds the user so the
// JSON stays a strict superset of what the endpoint returned before.
type adminUser struct {
	*domain.User
	TwoFactorEnabled bool `json:"twoFactorEnabled"`
	// DeletionRequested is live state (a mailed link that has not expired);
	// OverQuota is as fresh as the last usage report.
	DeletionRequested bool `json:"deletionRequested"`
	OverQuota         bool `json:"overQuota"`
}

// adminUserPage is one page of the admin user list with the filtered total.
type adminUserPage struct {
	Items    []adminUser `json:"items"`
	Total    int         `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"pageSize"`
}

type instanceSettingsRequest struct {
	AllowRegister *bool `json:"allowRegister"`
	// UsageReportAtMinute is a pointer so "absent" is distinct from midnight.
	UsageReportAtMinute *int    `json:"usageReportAtMinute"`
	UsageReportTimeZone *string `json:"usageReportTimeZone"`
}

// getSettings returns the instance settings.
//
//	@Summary	Get instance settings
//	@Tags		admin
//	@Security	BearerAuth
//	@Success	200	{object}	domain.InstanceSettings
//	@Failure	403	{object}	errorBody
//	@Router		/api/v1/admin/settings [get]
func (h *adminHandler) getSettings(w http.ResponseWriter, r *http.Request) {
	s, err := h.settings.Get(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// updateSettings changes the instance settings.
//
//	@Summary	Update instance settings
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		body	body		instanceSettingsRequest	true	"Settings"
//	@Success	200		{object}	domain.InstanceSettings
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/admin/settings [put]
func (h *adminHandler) updateSettings(w http.ResponseWriter, r *http.Request) {
	var req instanceSettingsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	// Each field is optional so one can be changed without restating the
	// other, but at least one must be present or the call means nothing.
	if req.AllowRegister == nil && req.UsageReportAtMinute == nil && req.UsageReportTimeZone == nil {
		writeError(w, http.StatusBadRequest, "nothing to change")
		return
	}

	var (
		s   *domain.InstanceSettings
		err error
	)
	if req.AllowRegister != nil {
		if s, err = h.settings.SetAllowRegister(r.Context(), *req.AllowRegister); err != nil {
			writeServiceError(w, r, err)
			return
		}
	}
	if req.UsageReportAtMinute != nil {
		if s, err = h.settings.SetUsageReportAtMinute(r.Context(), *req.UsageReportAtMinute); err != nil {
			writeServiceError(w, r, err)
			return
		}
	}
	if req.UsageReportTimeZone != nil {
		if s, err = h.settings.SetUsageReportTimeZone(r.Context(), *req.UsageReportTimeZone); err != nil {
			writeServiceError(w, r, err)
			return
		}
	}
	entry := auditFrom(r, domain.AuditAdminSettingsUpdated)
	if req.AllowRegister != nil {
		// The one instance-wide setting with a security consequence: it decides
		// whether strangers can create accounts at all.
		entry.Detail = fmt.Sprintf("public registration %v", *req.AllowRegister)
	}
	h.audit.Record(r.Context(), entry)
	writeJSON(w, http.StatusOK, s)
}

type createUserRequest struct {
	Email   string `json:"email"`
	IsAdmin bool   `json:"isAdmin"`
}

type updateUserRequest struct {
	Email    *string `json:"email"`
	Password *string `json:"password"`
	IsAdmin  *bool   `json:"isAdmin"`
}

// listUsers returns one filtered page of accounts with admin-only annotations.
//
//	@Summary	List users
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		q			query	string	false	"Search by email"
//	@Param		admin		query	string	false	"Filter admins: on|off"
//	@Param		twoFactor	query	string	false	"Filter 2FA: on|off"
//	@Param		sort		query	string	false	"Sort column: email|created|verified"
//	@Param		dir			query	string	false	"Sort direction: asc|desc"
//	@Param		page		query	int		false	"1-based page"
//	@Param		pageSize	query	int		false	"Rows per page"
//	@Success	200	{object}	adminUserPage
//	@Failure	403	{object}	errorBody
//	@Router		/api/v1/admin/users [get]
func (h *adminHandler) listUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	atoi := func(name string) int {
		n, _ := strconv.Atoi(q.Get(name))
		return n
	}
	result, err := h.admin.ListUsers(r.Context(), repo.UserFilter{
		Search:    q.Get("q"),
		Admin:     q.Get("admin"),
		TwoFactor: q.Get("twoFactor"),
		SortBy:    q.Get("sort"),
		SortDesc:  q.Get("dir") == "desc",
	}, service.Page{Number: atoi("page"), Size: atoi("pageSize")})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}

	ids := make([]int64, len(result.Users))
	for i, u := range result.Users {
		ids[i] = u.ID
	}
	enabled := map[int64]bool{}
	if h.twoFactor != nil {
		if enabled, err = h.twoFactor.EnabledFor(r.Context(), ids); err != nil {
			writeServiceError(w, r, err)
			return
		}
	}

	states, err := h.admin.StatesFor(r.Context(), ids)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}

	items := make([]adminUser, 0, len(result.Users))
	for _, u := range result.Users {
		items = append(items, adminUser{
			User:              u,
			TwoFactorEnabled:  enabled[u.ID],
			DeletionRequested: states[u.ID].DeletionRequested,
			OverQuota:         states[u.ID].OverQuota,
		})
	}
	writeJSON(w, http.StatusOK, adminUserPage{
		Items: items, Total: result.Total, Page: result.Page, PageSize: result.Size,
	})
}

// usageReport returns the stored instance-wide report.
//
// It is served from the periodically rebuilt table, so this is one query
// however many accounts exist — unlike the per-account endpoint, which runs
// seven counts and is meant for one user at a time.
// usageReport returns the stored instance-wide usage report.
//
//	@Summary	Get the instance usage report
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		q			query	string	false	"Search"
//	@Param		page		query	int		false	"Page"
//	@Param		pageSize	query	int		false	"Page size"
//	@Success	200	{object}	service.Report
//	@Router		/api/v1/admin/reports/usage [get]
func (h *adminHandler) usageReport(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	atoi := func(name string) int {
		n, _ := strconv.Atoi(q.Get(name))
		return n
	}
	report, err := h.reports.Latest(r.Context(), service.ReportQuery{
		Search:    q.Get("q"),
		Admin:     q.Get("admin"),
		TwoFactor: q.Get("twoFactor"),
		SortBy:    q.Get("sort"),
		SortDesc:  q.Get("dir") != "asc",
		Page:      atoi("page"),
		PageSize:  atoi("pageSize"),
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// runUsageReport rebuilds the report now, rather than waiting for the schedule.
// runUsageReport rebuilds the usage report now.
//
//	@Summary	Rebuild the usage report
//	@Tags		admin
//	@Security	BearerAuth
//	@Success	200	{object}	map[string]int
//	@Router		/api/v1/admin/reports/usage/run [post]
func (h *adminHandler) runUsageReport(w http.ResponseWriter, r *http.Request) {
	n, err := h.reports.Run(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"accounts": n})
}

// usage reports one account's consumption against its limits.
//
// Deliberately its own endpoint rather than a field on the user list: it is
// several counts per account, so folding it into the list would mean running
// them for every row on every load, to show numbers that are only looked at
// one user at a time.
// usage reports one account's consumption against its limits.
//
//	@Summary	Get a user's quota usage
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		id	path		int	true	"User id"
//	@Success	200	{object}	service.Usage
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/admin/users/{id}/usage [get]
func (h *adminHandler) usage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if h.quotas == nil {
		writeError(w, http.StatusNotFound, "quotas are not configured")
		return
	}
	// Confirm the account exists, so a bad id is a 404 rather than zeroes.
	if _, err := h.admin.GetUser(r.Context(), id); err != nil {
		writeServiceError(w, r, err)
		return
	}
	u, err := h.quotas.Usage(r.Context(), id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// resetTwoFactor unlocks an account whose owner lost both their authenticator
// and their recovery codes. With no email fallback, an admin is the only route
// back in. It only ever removes the factor; it never reveals a secret.
// resetTwoFactor removes an account's second factor.
//
//	@Summary	Reset a user's two-factor
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		id	path	int	true	"User id"
//	@Success	204		"reset"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/admin/users/{id}/2fa/reset [post]
func (h *adminHandler) resetTwoFactor(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if h.twoFactor == nil {
		writeServiceError(w, r, service.ErrTwoFactorNotEnabled)
		return
	}
	if err := h.twoFactor.Reset(r.Context(), id); err != nil {
		writeServiceError(w, r, err)
		return
	}
	// Removing a credential evicts the sessions issued under it, matching what
	// a password change does.
	if err := h.admin.RevokeSessions(r.Context(), id); err != nil {
		writeServiceError(w, r, err)
		return
	}
	target, _ := h.admin.GetUser(r.Context(), id)
	h.audit.Record(r.Context(), h.auditTarget(r, domain.AuditAdminTwoFactorReset, target))
	w.WriteHeader(http.StatusNoContent)
}

// createUser adds an account.
//
//	@Summary	Create a user
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		body	body		createUserRequest	true	"User"
//	@Success	201		{object}	domain.User
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/admin/users [post]
func (h *adminHandler) createUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	u, err := h.admin.CreateUser(r.Context(), req.Email, req.IsAdmin)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if err := h.email.SendInvitation(r.Context(), u); err != nil {
		writeServiceError(w, r, err)
		return
	}
	entry := h.auditTarget(r, domain.AuditAdminUserCreated, u)
	if req.IsAdmin {
		entry.Detail = "created as an administrator"
	}
	h.audit.Record(r.Context(), entry)
	writeJSON(w, http.StatusCreated, u)
}

// resendInvitation sends a fresh invitation to an unverified account.
//
//	@Summary	Resend a user invitation
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		id	path	int	true	"User id"
//	@Success	204	"sent"
//	@Failure	409	{object}	errorBody
//	@Router		/api/v1/admin/users/{id}/invitation [post]
func (h *adminHandler) resendInvitation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	u, err := h.admin.GetUser(r.Context(), id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if err := h.email.SendInvitation(r.Context(), u); err != nil {
		writeServiceError(w, r, err)
		return
	}
	h.audit.Record(r.Context(), h.auditTarget(r, domain.AuditAdminInvitationResent, u))
	w.WriteHeader(http.StatusNoContent)
}

// updateUser changes an account's email, password or admin flag.
//
//	@Summary	Update a user
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		id		path		int					true	"User id"
//	@Param		body	body		updateUserRequest	true	"Fields to change"
//	@Success	200		{object}	domain.User
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/admin/users/{id} [put]
func (h *adminHandler) updateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req updateUserRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	// Read first so the entry can say what actually changed rather than that
	// something did.
	before, _ := h.admin.GetUser(r.Context(), id)
	u, err := h.admin.UpdateUser(r.Context(), claimsFrom(r).UserID, id, req.Email, req.Password, req.IsAdmin)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	entry := h.auditTarget(r, domain.AuditAdminUserUpdated, u)
	entry.Detail = describeUserChange(before, u, req.Password != nil && *req.Password != "")
	h.audit.Record(r.Context(), entry)
	writeJSON(w, http.StatusOK, u)
}

// deleteUser removes an account and everything it owns.
//
//	@Summary	Delete a user
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		id	path	int	true	"User id"
//	@Success	204		"deleted"
//	@Failure	409		{object}	errorBody	"last admin or self-delete"
//	@Router		/api/v1/admin/users/{id} [delete]
func (h *adminHandler) deleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// Named before the deletion, because afterwards there is no account left to
	// read an address from — and who was deleted is the whole point of the
	// entry.
	target, _ := h.admin.GetUser(r.Context(), id)
	if err := h.admin.DeleteUser(r.Context(), claimsFrom(r).UserID, id); err != nil {
		writeServiceError(w, r, err)
		return
	}
	h.audit.Record(r.Context(), h.auditTarget(r, domain.AuditAdminUserDeleted, target))
	w.WriteHeader(http.StatusNoContent)
}

// describeUserChange summarises an administrator's edit for the log.
//
// Says which fields moved and, for the one that matters, which way: granting
// administrator rights is the change most worth being able to point at later.
// Never records the password itself, only that one was set.
func describeUserChange(before, after *domain.User, passwordSet bool) string {
	if after == nil {
		return ""
	}
	var changes []string
	if before != nil && before.Email != after.Email {
		changes = append(changes, "address "+before.Email+" → "+after.Email)
	}
	if before != nil && before.IsAdmin != after.IsAdmin {
		if after.IsAdmin {
			changes = append(changes, "granted administrator")
		} else {
			changes = append(changes, "revoked administrator")
		}
	}
	if passwordSet {
		changes = append(changes, "password reset by an administrator")
	}
	return strings.Join(changes, "; ")
}
