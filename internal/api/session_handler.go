package api

import (
	"net/http"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// sessionHandler serves the account's view of its own sign-ins.
type sessionHandler struct {
	auth  *service.AuthService
	audit *service.AuditService
}

// list returns the caller's active sessions, the current one marked.
//
//	@Summary	List my active sessions
//	@Tags		account
//	@Security	BearerAuth
//	@Success	200	{array}	service.Session
//	@Router		/api/v1/me/sessions [get]
func (h *sessionHandler) list(w http.ResponseWriter, r *http.Request) {
	claims := claimsFrom(r)
	sessions, err := h.auth.Sessions(r.Context(), claims.UserID, claims.SessionID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

// revoke ends one session by id.
//
//	@Summary	Revoke one of my sessions
//	@Tags		account
//	@Security	BearerAuth
//	@Param		id	path	string	true	"Session id"
//	@Success	204
//	@Router		/api/v1/me/sessions/{id} [delete]
func (h *sessionHandler) revoke(w http.ResponseWriter, r *http.Request) {
	claims := claimsFrom(r)
	sessionID := r.PathValue("id")
	if err := h.auth.RevokeSession(r.Context(), claims.UserID, sessionID); err != nil {
		writeServiceError(w, err)
		return
	}
	entry := auditFrom(r, domain.AuditSessionRevoked)
	if sessionID == claims.SessionID {
		entry.Detail = "the current session"
	}
	h.audit.Record(r.Context(), entry)
	w.WriteHeader(http.StatusNoContent)
}

// revokeOthers ends every session but the caller's own.
//
//	@Summary	Sign out everywhere else
//	@Tags		account
//	@Security	BearerAuth
//	@Success	204
//	@Router		/api/v1/me/sessions [delete]
func (h *sessionHandler) revokeOthers(w http.ResponseWriter, r *http.Request) {
	claims := claimsFrom(r)
	if err := h.auth.RevokeOtherSessions(r.Context(), claims.UserID, claims.SessionID); err != nil {
		writeServiceError(w, err)
		return
	}
	entry := auditFrom(r, domain.AuditSessionRevoked)
	entry.Detail = "signed out of all other sessions"
	h.audit.Record(r.Context(), entry)
	w.WriteHeader(http.StatusNoContent)
}
