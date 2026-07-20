package api

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jdel/gotracks/internal/service"
)

// metaHandler serves the public health and capability endpoints.
type metaHandler struct {
	settings  *service.SettingsService
	oidc      bool
	passkeys  bool
	twoFactor bool
}

// healthz is a public liveness probe.
//
//	@Summary	Health check
//	@Tags		meta
//	@Success	200	{object}	map[string]string
//	@Router		/healthz [get]
func (h *metaHandler) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// config reports which sign-in capabilities the instance offers, so the SPA
// knows what to show on the sign-in page.
//
//	@Summary	Public capabilities
//	@Tags		meta
//	@Success	200	{object}	map[string]bool
//	@Router		/api/v1/config [get]
func (h *metaHandler) config(w http.ResponseWriter, r *http.Request) {
	allowRegister, err := h.settings.AllowRegister(r.Context())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{
		"allowRegister": allowRegister,
		"oidc":          h.oidc,
		"passkeys":      h.passkeys,
		"twoFactor":     h.twoFactor,
	})
}

// preferenceHandler serves /preferences.
type preferenceHandler struct {
	prefs *service.PreferenceService
}

type preferenceRequest struct {
	DateFormat            *string `json:"dateFormat"`
	TimeZone              *string `json:"timeZone"`
	Locale                *string `json:"locale"`
	Theme                 *string `json:"theme"`
	WeekStart             *int    `json:"weekStart"`
	ReviewPeriod          *int    `json:"reviewPeriod"`
	AutoDeleteAttachments *bool   `json:"autoDeleteAttachments"`
}

// get returns the caller's preferences.
//
//	@Summary	Get preferences
//	@Tags		preferences
//	@Security	BearerAuth
//	@Success	200	{object}	domain.Preference
//	@Router		/api/v1/preferences [get]
func (h *preferenceHandler) get(w http.ResponseWriter, r *http.Request) {
	p, err := h.prefs.Get(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// update changes the caller's preferences.
//
//	@Summary	Update preferences
//	@Tags		preferences
//	@Security	BearerAuth
//	@Param		body	body		preferenceRequest	true	"Preferences"
//	@Success	200		{object}	domain.Preference
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/preferences [put]
func (h *preferenceHandler) update(w http.ResponseWriter, r *http.Request) {
	var req preferenceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.prefs.Update(r.Context(), claimsFrom(r).UserID, service.PreferenceInput{
		DateFormat:            req.DateFormat,
		TimeZone:              req.TimeZone,
		Locale:                req.Locale,
		Theme:                 req.Theme,
		WeekStart:             req.WeekStart,
		ReviewPeriod:          req.ReviewPeriod,
		AutoDeleteAttachments: req.AutoDeleteAttachments,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// statsHandler serves /stats.
type statsHandler struct {
	stats *service.StatsService
}

// get returns the caller's dashboard statistics.
//
//	@Summary	Get statistics
//	@Tags		stats
//	@Security	BearerAuth
//	@Success	200	{object}	service.Stats
//	@Router		/api/v1/stats [get]
func (h *statsHandler) get(w http.ResponseWriter, r *http.Request) {
	s, err := h.stats.Compute(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// transferHandler serves /export and /import.
type transferHandler struct {
	transfer *service.TransferService
}

// export streams all of the caller's data in the requested format.
//
//	@Summary	Export my data
//	@Tags		transfer
//	@Security	BearerAuth
//	@Produce	json,application/yaml,application/xml,text/csv
//	@Param		format	query	string	false	"json (default), yaml, xml or csv"
//	@Success	200		{file}	binary
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/export [get]
func (h *transferHandler) export(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	data, err := h.transfer.Gather(r.Context(), uid)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}
	stamp := time.Now().Format("2006-01-02")
	filename := fmt.Sprintf("gotracks-%s.%s", stamp, format)

	switch format {
	case "json":
		w.Header().Set("Content-Type", "application/json")
	case "yaml", "yml":
		w.Header().Set("Content-Type", "application/yaml")
	case "xml":
		w.Header().Set("Content-Type", "application/xml")
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
	default:
		writeError(w, http.StatusBadRequest, "format must be json, yaml, xml or csv")
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

	var writeErr error
	switch format {
	case "json":
		writeErr = data.WriteJSON(w)
	case "yaml", "yml":
		writeErr = data.WriteYAML(w)
	case "xml":
		writeErr = data.WriteXML(w)
	case "csv":
		writeErr = data.WriteCSV(w)
	}
	if writeErr != nil {
		// Headers are already sent; log via the service error path only.
		writeServiceError(w, writeErr)
	}
}

// importData merges an uploaded export into the caller's account.
//
//	@Summary	Import data
//	@Tags		transfer
//	@Security	BearerAuth
//	@Success	200		{object}	service.ImportResult
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/import [post]
func (h *transferHandler) importData(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read body")
		return
	}
	parsed, err := service.ParseImport(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := h.transfer.Import(r.Context(), uid, parsed)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// attachmentHandler serves /todos/{id}/attachments and /attachments/{id}.
type attachmentHandler struct {
	attachments *service.AttachmentService
}

// listAll returns every attachment the caller owns.
//
//	@Summary	List all attachments
//	@Tags		attachments
//	@Security	BearerAuth
//	@Success	200	{array}	domain.AttachmentWithTodo
//	@Router		/api/v1/attachments [get]
func (h *attachmentHandler) listAll(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	as, err := h.attachments.ListAll(r.Context(), uid)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, as)
}

// list returns a todo's attachments.
//
//	@Summary	List an action's attachments
//	@Tags		attachments
//	@Security	BearerAuth
//	@Param		id	path	int	true	"Action id"
//	@Success	200	{array}	domain.Attachment
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/todos/{id}/attachments [get]
func (h *attachmentHandler) list(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	as, err := h.attachments.List(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, as)
}

// upload stores a file against a todo.
//
//	@Summary	Upload an attachment
//	@Tags		attachments
//	@Security	BearerAuth
//	@Accept		multipart/form-data
//	@Param		id		path		int		true	"Action id"
//	@Param		file	formData	file	true	"File to attach"
//	@Success	201		{object}	domain.Attachment
//	@Failure	413		{object}	errorBody	"file too large"
//	@Router		/api/v1/todos/{id}/attachments [post]
func (h *attachmentHandler) upload(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	todoID, ok := pathID(w, r)
	if !ok {
		return
	}
	// FormFile parses the whole multipart body, spooling it to disk, before the
	// service ever sees a byte. Cap it first (limit plus multipart overhead) so
	// an oversized upload cannot fill the disk on its way to being rejected.
	r.Body = http.MaxBytesReader(w, r.Body, h.attachments.MaxBytes()+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "expected a multipart field named \"file\"")
		return
	}
	defer file.Close()

	a, err := h.attachments.Save(
		r.Context(), uid, todoID, header.Filename, header.Header.Get("Content-Type"), file,
	)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

// download streams an attachment's bytes.
//
//	@Summary	Download an attachment
//	@Tags		attachments
//	@Security	BearerAuth
//	@Produce	application/octet-stream
//	@Param		id	path	int	true	"Attachment id"
//	@Success	200	{file}	binary
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/attachments/{id} [get]
func (h *attachmentHandler) download(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	a, f, err := h.attachments.Open(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	defer f.Close()

	if a.ContentType != "" {
		w.Header().Set("Content-Type", a.ContentType)
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", a.FileName))
	http.ServeContent(w, r, a.FileName, a.CreatedAt, f)
}

// delete removes an attachment and its file.
//
//	@Summary	Delete an attachment
//	@Tags		attachments
//	@Security	BearerAuth
//	@Param		id	path	int	true	"Attachment id"
//	@Success	204		"deleted"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/attachments/{id} [delete]
func (h *attachmentHandler) delete(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.attachments.Delete(r.Context(), uid, id); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
