package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/jdel/gotracks/internal/service"
)

// passkeyHandler serves WebAuthn enrolment and login.
//
// The browser talks to these endpoints with the raw structures from
// navigator.credentials, so no client library is involved.
type passkeyHandler struct {
	passkeys *service.PasskeyService
	auth     *service.AuthService
}

// enabled reports whether passkeys are configured on this instance.
func (h *passkeyHandler) enabled() bool { return h.passkeys != nil }

type passkeyBeginResponse struct {
	// Options is the PublicKeyCredentialCreationOptions / RequestOptions the
	// browser passes straight to navigator.credentials.
	Options   any    `json:"options"`
	SessionID string `json:"sessionId"`
}

type passkeyFinishRequest struct {
	SessionID string          `json:"sessionId"`
	Name      string          `json:"name"`
	Response  json.RawMessage `json:"response"`
}

type passkeyLoginBeginRequest struct {
	Email string `json:"email"`
}

// status reports whether passkeys are enabled.
//
//	@Summary	Passkey capability status
//	@Tags		passkeys
//	@Success	200	{object}	map[string]bool
//	@Router		/api/v1/auth/passkey/status [get]
func (h *passkeyHandler) status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": h.enabled()})
}

// list returns the caller's enrolled passkeys.
//
//	@Summary	List my passkeys
//	@Tags		passkeys
//	@Security	BearerAuth
//	@Success	200	{array}	domain.Credential
//	@Router		/api/v1/passkeys [get]
func (h *passkeyHandler) list(w http.ResponseWriter, r *http.Request) {
	creds, err := h.passkeys.List(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, creds)
}

// registerBegin starts passkey enrolment.
//
//	@Summary	Begin passkey enrolment
//	@Tags		passkeys
//	@Security	BearerAuth
//	@Success	200	{object}	map[string]interface{}
//	@Router		/api/v1/passkeys/register/begin [post]
func (h *passkeyHandler) registerBegin(w http.ResponseWriter, r *http.Request) {
	options, sessionID, err := h.passkeys.BeginRegistration(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, passkeyBeginResponse{Options: options, SessionID: sessionID})
}

// registerFinish completes passkey enrolment.
//
//	@Summary	Finish passkey enrolment
//	@Tags		passkeys
//	@Security	BearerAuth
//	@Param		body	body		passkeyFinishRequest	true	"Attestation"
//	@Success	201		{object}	domain.Credential
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/passkeys/register/finish [post]
func (h *passkeyHandler) registerFinish(w http.ResponseWriter, r *http.Request) {
	var req passkeyFinishRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	cred, err := h.passkeys.FinishRegistration(
		r.Context(), claimsFrom(r).UserID, req.SessionID, req.Name, req.Response)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, cred)
}

// delete removes one of the caller's passkeys.
//
//	@Summary	Delete a passkey
//	@Tags		passkeys
//	@Security	BearerAuth
//	@Param		id	path	int	true	"Passkey id"
//	@Success	204		"deleted"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/passkeys/{id} [delete]
func (h *passkeyHandler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.passkeys.Delete(r.Context(), claimsFrom(r).UserID, id); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// loginBegin starts a passkey assertion for sign-in.
//
//	@Summary	Begin passkey sign-in
//	@Tags		passkeys
//	@Param		body	body		passkeyLoginBeginRequest	true	"Email"
//	@Success	200		{object}	map[string]interface{}
//	@Router		/api/v1/auth/passkey/login/begin [post]
func (h *passkeyHandler) loginBegin(w http.ResponseWriter, r *http.Request) {
	var req passkeyLoginBeginRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	options, sessionID, err := h.passkeys.BeginLogin(r.Context(), req.Email)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, passkeyBeginResponse{Options: options, SessionID: sessionID})
}

// loginFinish completes a passkey sign-in and returns a session.
//
//	@Summary	Finish passkey sign-in
//	@Tags		passkeys
//	@Success	200	{object}	authResponse
//	@Failure	401	{object}	errorBody
//	@Router		/api/v1/auth/passkey/login/finish [post]
func (h *passkeyHandler) loginFinish(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read body")
		return
	}
	var req passkeyFinishRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	u, err := h.passkeys.FinishLogin(r.Context(), req.SessionID, req.Response)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	tokens, err := h.auth.IssueFor(r.Context(), u)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, authResponse{User: u, Tokens: tokens})
}
