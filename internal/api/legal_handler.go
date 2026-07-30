package api

import (
	"net/http"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/legal"
	"github.com/jdel/gotracks/internal/service"
)

// legalHandler serves the legal documents and the operator's editor.
type legalHandler struct {
	legal *service.LegalService
	prefs *service.PreferenceService
	audit *service.AuditService
}

// locale resolves the language to serve a document in: the signed-in account's
// preference when there is one, otherwise the requested query parameter.
//
// Falls back rather than failing — an unreadable document is worse than one in
// the wrong language.
func (h *legalHandler) locale(r *http.Request) string {
	if claims := claimsFrom(r); claims != nil && h.prefs != nil {
		if pref, err := h.prefs.Get(r.Context(), claims.UserID); err == nil && pref.Locale != "" {
			return pref.Locale
		}
	}
	return r.URL.Query().Get("locale")
}

// get returns every document as it currently stands.
//
// Public: the pages have to render before an account exists, because agreeing
// to them is part of creating one.
//
//	@Summary	Legal documents
//	@Tags		legal
//	@Param		locale	query	string	false	"Language to serve"
//	@Success	200		{array}	service.Document
//	@Router		/api/v1/legal [get]
func (h *legalHandler) get(w http.ResponseWriter, r *http.Request) {
	docs, err := h.legal.Documents(r.Context(), h.locale(r))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, docs)
}

type legalEditorBody struct {
	// Defaults is what the binary ships, so the editor can reset to it without
	// hard-coding the text twice.
	Defaults  map[string]map[string]string `json:"defaults"`
	Overrides map[string]map[string]string `json:"overrides"`
}

// editor returns the operator's editing state: the stored replacements and the
// shipped text they reset to.
//
//	@Summary	Legal editor state
//	@Tags		admin
//	@Security	BearerAuth
//	@Success	200	{object}	legalEditorBody
//	@Router		/api/v1/admin/legal [get]
func (h *legalHandler) editor(w http.ResponseWriter, r *http.Request) {
	overrides, err := h.legal.Overrides(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	defaults := map[string]map[string]string{}
	for _, locale := range service.SupportedLocales {
		defaults[locale] = map[string]string{}
		for _, kind := range legal.Kinds {
			defaults[locale][kind] = h.legal.Default(locale, kind)
		}
	}
	writeJSON(w, http.StatusOK, legalEditorBody{Defaults: defaults, Overrides: overrides})
}

type legalDocumentRequest struct {
	// Body replaces the shipped text. Empty resets to it.
	Body string `json:"body"`
}

// update replaces one document in one language, or resets it when the body is
// empty. Readers see the change immediately.
//
//	@Summary	Replace a legal document
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		locale	path	string					true	"Interface locale"
//	@Param		kind	path	string					true	"terms, privacy or cookies"
//	@Param		body	body	legalDocumentRequest	true	"Document; empty resets to the shipped text"
//	@Success	204
//	@Failure	400	{object}	errorBody
//	@Router		/api/v1/admin/legal/{locale}/{kind} [put]
func (h *legalHandler) update(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if !legal.ValidKind(kind) {
		writeError(w, http.StatusBadRequest, "unknown document")
		return
	}
	var req legalDocumentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	locale := r.PathValue("locale")
	if err := h.legal.Save(r.Context(), locale, kind, req.Body); err != nil {
		writeServiceError(w, r, err)
		return
	}
	entry := auditFrom(r, domain.AuditAdminLegalUpdated)
	entry.Detail = kind + " (" + locale + ") replaced"
	if req.Body == "" {
		entry.Detail = kind + " (" + locale + ") reset to the shipped text"
	}
	h.audit.Record(r.Context(), entry)
	w.WriteHeader(http.StatusNoContent)
}

// reset restores the shipped text for one document in one language.
//
//	@Summary	Restore a legal document to the shipped text
//	@Tags		admin
//	@Security	BearerAuth
//	@Param		locale	path	string	true	"Interface locale"
//	@Param		kind	path	string	true	"terms, privacy or cookies"
//	@Success	204
//	@Failure	400	{object}	errorBody
//	@Router		/api/v1/admin/legal/{locale}/{kind} [delete]
func (h *legalHandler) reset(w http.ResponseWriter, r *http.Request) {
	locale, kind := r.PathValue("locale"), r.PathValue("kind")
	if err := h.legal.Reset(r.Context(), locale, kind); err != nil {
		writeServiceError(w, r, err)
		return
	}
	entry := auditFrom(r, domain.AuditAdminLegalUpdated)
	entry.Detail = kind + " (" + locale + ") reset to the shipped text"
	h.audit.Record(r.Context(), entry)
	w.WriteHeader(http.StatusNoContent)
}
