package api

import (
	"net/http"
	"strconv"

	"github.com/jdel/gotracks/internal/domain"
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
}

// adminUser is a user plus admin-only annotations. It embeds the user so the
// JSON stays a strict superset of what the endpoint returned before.
type adminUser struct {
	*domain.User
	TwoFactorEnabled bool `json:"twoFactorEnabled"`
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
		writeServiceError(w, err)
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
			writeServiceError(w, err)
			return
		}
	}
	if req.UsageReportAtMinute != nil {
		if s, err = h.settings.SetUsageReportAtMinute(r.Context(), *req.UsageReportAtMinute); err != nil {
			writeServiceError(w, err)
			return
		}
	}
	if req.UsageReportTimeZone != nil {
		if s, err = h.settings.SetUsageReportTimeZone(r.Context(), *req.UsageReportTimeZone); err != nil {
			writeServiceError(w, err)
			return
		}
	}
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

// listUsers returns every account with admin-only annotations.
//
//	@Summary	List users
//	@Tags		admin
//	@Security	BearerAuth
//	@Success	200	{array}	adminUser
//	@Failure	403	{object}	errorBody
//	@Router		/api/v1/admin/users [get]
func (h *adminHandler) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.admin.ListUsers(r.Context())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	enabled := map[int64]bool{}
	if h.twoFactor != nil {
		if enabled, err = h.twoFactor.EnabledUsers(r.Context()); err != nil {
			writeServiceError(w, err)
			return
		}
	}
	out := make([]adminUser, 0, len(users))
	for _, u := range users {
		out = append(out, adminUser{User: u, TwoFactorEnabled: enabled[u.ID]})
	}
	writeJSON(w, http.StatusOK, out)
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
		writeServiceError(w, err)
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
		writeServiceError(w, err)
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
		writeServiceError(w, err)
		return
	}
	u, err := h.quotas.Usage(r.Context(), id)
	if err != nil {
		writeServiceError(w, err)
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
		writeServiceError(w, service.ErrTwoFactorNotEnabled)
		return
	}
	if err := h.twoFactor.Reset(r.Context(), id); err != nil {
		writeServiceError(w, err)
		return
	}
	// Removing a credential evicts the sessions issued under it, matching what
	// a password change does.
	if err := h.admin.RevokeSessions(r.Context(), id); err != nil {
		writeServiceError(w, err)
		return
	}
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
		writeServiceError(w, err)
		return
	}
	if err := h.email.SendInvitation(r.Context(), u); err != nil {
		writeServiceError(w, err)
		return
	}
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
		writeServiceError(w, err)
		return
	}
	if err := h.email.SendInvitation(r.Context(), u); err != nil {
		writeServiceError(w, err)
		return
	}
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
	u, err := h.admin.UpdateUser(r.Context(), id, req.Email, req.Password, req.IsAdmin)
	if err != nil {
		writeServiceError(w, err)
		return
	}
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
	if err := h.admin.DeleteUser(r.Context(), claimsFrom(r).UserID, id); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
