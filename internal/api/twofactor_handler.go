package api

import (
	"net/http"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// twoFactorHandler serves the authenticated /2fa endpoints: enrolment,
// recovery codes and turning the factor off.
type twoFactorHandler struct {
	twoFactor *service.TwoFactorService
	auth      *service.AuthService
	audit     *service.AuditService
}

type enrolFinishRequest struct {
	EnrolmentID string `json:"enrolmentId"`
	Code        string `json:"code"`
}

type passwordRequest struct {
	Password string `json:"password"`
}

type disableRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

type recoveryCodesResponse struct {
	RecoveryCodes []string `json:"recoveryCodes"`
}

// status reports whether the caller has two-factor enabled.
//
//	@Summary	Two-factor status
//	@Tags		twofactor
//	@Security	BearerAuth
//	@Success	200	{object}	map[string]bool
//	@Router		/api/v1/2fa [get]
func (h *twoFactorHandler) status(w http.ResponseWriter, r *http.Request) {
	status, err := h.twoFactor.Status(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// enrolBegin starts TOTP enrolment and returns the secret and QR.
//
//	@Summary	Begin two-factor enrolment
//	@Tags		twofactor
//	@Security	BearerAuth
//	@Success	200	{object}	map[string]interface{}
//	@Router		/api/v1/2fa/enrol/begin [post]
func (h *twoFactorHandler) enrolBegin(w http.ResponseWriter, r *http.Request) {
	enrolment, err := h.twoFactor.BeginEnrolment(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, enrolment)
}

// enrolFinish confirms enrolment with a code and returns recovery codes.
//
//	@Summary	Finish two-factor enrolment
//	@Tags		twofactor
//	@Security	BearerAuth
//	@Param		body	body		enrolFinishRequest	true	"Confirmation code"
//	@Success	200		{object}	map[string]interface{}
//	@Failure	401		{object}	errorBody
//	@Router		/api/v1/2fa/enrol/finish [post]
func (h *twoFactorHandler) enrolFinish(w http.ResponseWriter, r *http.Request) {
	var req enrolFinishRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	codes, err := h.twoFactor.FinishEnrolment(r.Context(), claimsFrom(r).UserID, req.EnrolmentID, req.Code)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	h.audit.Record(r.Context(), auditFrom(r, domain.AuditTwoFactorEnabled))
	writeJSON(w, http.StatusOK, recoveryCodesResponse{RecoveryCodes: codes})
}

// regenerate issues a fresh set of recovery codes.
//
//	@Summary	Regenerate recovery codes
//	@Tags		twofactor
//	@Security	BearerAuth
//	@Param		body	body		passwordRequest	true	"Current password"
//	@Success	200		{object}	map[string]interface{}
//	@Failure	401		{object}	errorBody
//	@Router		/api/v1/2fa/recovery/regenerate [post]
func (h *twoFactorHandler) regenerate(w http.ResponseWriter, r *http.Request) {
	var req passwordRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	uid := claimsFrom(r).UserID
	if !h.confirmPassword(w, r, uid, req.Password) {
		return
	}
	codes, err := h.twoFactor.RegenerateRecoveryCodes(r.Context(), uid)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, recoveryCodesResponse{RecoveryCodes: codes})
}

// disable turns two-factor off.
//
//	@Summary	Disable two-factor
//	@Tags		twofactor
//	@Security	BearerAuth
//	@Param		body	body	disableRequest	true	"Current password"
//	@Success	204		"disabled"
//	@Failure	401		{object}	errorBody
//	@Router		/api/v1/2fa/disable [post]
func (h *twoFactorHandler) disable(w http.ResponseWriter, r *http.Request) {
	var req disableRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	uid := claimsFrom(r).UserID
	if !h.confirmPassword(w, r, uid, req.Password) {
		return
	}
	if err := h.twoFactor.Disable(r.Context(), uid, req.Code); err != nil {
		writeServiceError(w, err)
		return
	}
	h.audit.Record(r.Context(), auditFrom(r, domain.AuditTwoFactorDisabled))
	writeJSON(w, http.StatusNoContent, nil)
}

// confirmPassword re-checks the account password before a change to the second
// factor. A stolen access token alone must not be enough to strip or rotate it.
func (h *twoFactorHandler) confirmPassword(w http.ResponseWriter, r *http.Request, userID int64, password string) bool {
	u, err := h.auth.Me(r.Context(), userID)
	if err != nil {
		writeServiceError(w, err)
		return false
	}
	if _, err := h.auth.AuthenticatePassword(r.Context(), u.Email, password); err != nil {
		writeServiceError(w, err)
		return false
	}
	return true
}
