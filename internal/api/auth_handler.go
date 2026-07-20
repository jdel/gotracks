package api

import (
	"encoding/json"
	"net/http"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// authHandler serves the /auth endpoints.
//
// It owns the order of the sign-in steps: password first, then a second factor
// when the account has one. The services stay independent of each other and the
// handler sequences them, as the passkey handler already does.
type authHandler struct {
	auth      *service.AuthService
	twoFactor *service.TwoFactorService
	passkeys  *service.PasskeyService
	email     *service.EmailService
	quotas    *service.QuotaService
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	// Locale is the language picked on the form. Optional: an absent or
	// unsupported value leaves the account on the default.
	Locale string `json:"locale"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

// authResponse carries either a finished session or a pending second-factor
// challenge, never both. When a challenge is returned the user object is
// omitted deliberately: nothing about the account may be revealed until the
// second factor is proven.
type authResponse struct {
	User      *domain.User       `json:"user,omitempty"`
	Tokens    *service.TokenPair `json:"tokens,omitempty"`
	TwoFactor *service.Challenge `json:"twoFactor,omitempty"`
}

// changePasswordRequest carries the new password plus one proof of identity:
// either the current password, or a completed passkey assertion.
type emailRequest struct {
	Email string `json:"email"`
}

type tokenRequest struct {
	Token string `json:"token"`
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

type changePasswordRequest struct {
	NewPassword     string `json:"newPassword"`
	CurrentPassword string `json:"currentPassword"`
	// PasskeySessionID and PasskeyResponse are the alternative proof. The
	// response is left raw: it is the browser's credential object, which does
	// not survive a strict decode.
	PasskeySessionID string          `json:"passkeySessionId"`
	PasskeyResponse  json.RawMessage `json:"passkeyResponse"`
}

type twoFactorVerifyRequest struct {
	ChallengeID string `json:"challengeId"`
	Code        string `json:"code"`
}

// register creates a new account (the first ever becomes admin).
//
//	@Summary	Register a new account
//	@Tags		auth
//	@Param		body	body		registerRequest	true	"Email, password and optional locale"
//	@Success	201		{object}	authResponse
//	@Failure	400		{object}	errorBody
//	@Failure	403		{object}	errorBody	"registration disabled"
//	@Router		/api/v1/auth/register [post]
func (h *authHandler) register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	u, tokens, err := h.auth.Register(r.Context(), req.Email, req.Password, req.Locale)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if h.email != nil {
		// The very first account is the administrator, created before there is
		// anything to send it mail with; verifying it automatically is what
		// stops a fresh deployment locking itself out.
		if u.IsAdmin || !h.email.VerificationRequired() {
			if err := h.email.MarkVerified(r.Context(), u); err != nil {
				writeServiceError(w, err)
				return
			}
		} else if err := h.email.SendVerification(r.Context(), u); err != nil {
			writeServiceError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusCreated, authResponse{User: u, Tokens: tokens})
}

// login verifies a password and returns a session or a second-factor challenge.
//
//	@Summary	Sign in with email and password
//	@Tags		auth
//	@Param		body	body		loginRequest	true	"Credentials"
//	@Success	200		{object}	authResponse
//	@Failure	401		{object}	errorBody
//	@Router		/api/v1/auth/login [post]
func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	u, err := h.auth.AuthenticatePassword(r.Context(), req.Email, req.Password)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	if h.email != nil {
		if err := h.email.CheckVerified(u); err != nil {
			writeServiceError(w, err)
			return
		}
	}

	// A second factor is owed: answer 200 with a challenge and nothing else.
	// The password step did succeed, so an error status would be wrong.
	if h.twoFactor != nil {
		enabled, err := h.twoFactor.Enabled(r.Context(), u.ID)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		if enabled {
			challenge, err := h.twoFactor.Begin(r.Context(), u.ID)
			if err != nil {
				writeServiceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, authResponse{TwoFactor: challenge})
			return
		}
	}

	tokens, err := h.auth.IssueFor(r.Context(), u)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, authResponse{User: u, Tokens: tokens})
}

// verifyTwoFactor completes a sign-in that stopped at the second factor. It is
// public: the caller has no access token yet.
//
//	@Summary	Complete a two-factor sign-in
//	@Tags		auth
//	@Param		body	body		twoFactorVerifyRequest	true	"Challenge id and code"
//	@Success	200		{object}	authResponse
//	@Failure	401		{object}	errorBody
//	@Router		/api/v1/auth/2fa/verify [post]
func (h *authHandler) verifyTwoFactor(w http.ResponseWriter, r *http.Request) {
	var req twoFactorVerifyRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if h.twoFactor == nil {
		writeServiceError(w, service.ErrTwoFactorChallenge)
		return
	}
	u, err := h.twoFactor.Verify(r.Context(), req.ChallengeID, req.Code)
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

// changePassword replaces the caller's password, proven by the current password
// or a passkey assertion.
//
//	@Summary	Change my password
//	@Tags		account
//	@Security	BearerAuth
//	@Param		body	body		changePasswordRequest	true	"New password plus proof of identity"
//	@Success	200		{object}	service.TokenPair
//	@Failure	401		{object}	errorBody
//	@Router		/api/v1/me/password [post]
//
// changePassword lets a signed-in user replace their own password. The current
// one is required: an access token alone must not be enough to take over the
// account it was issued for.
func (h *authHandler) changePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	uid := claimsFrom(r).UserID

	var tokens *service.TokenPair
	var err error
	if len(req.PasskeyResponse) > 0 {
		// Passkey proof: verify the assertion, then set the password without a
		// current-password check.
		if h.passkeys == nil {
			writeServiceError(w, service.ErrPasskeyDisabled)
			return
		}
		if err := h.passkeys.FinishReauth(r.Context(), uid, req.PasskeySessionID, req.PasskeyResponse); err != nil {
			writeServiceError(w, err)
			return
		}
		tokens, err = h.auth.SetPassword(r.Context(), uid, req.NewPassword)
	} else {
		tokens, err = h.auth.ChangePassword(r.Context(), uid, req.CurrentPassword, req.NewPassword)
	}
	if err != nil {
		writeServiceError(w, err)
		return
	}
	// The change revoked every session, so hand back a usable pair.
	writeJSON(w, http.StatusOK, tokens)
}

// reauthPasskeyBegin starts the assertion used in place of typing the current
// password.
//
//	@Summary	Begin a passkey re-authentication
//	@Tags		account
//	@Security	BearerAuth
//	@Success	200	{object}	map[string]interface{}
//	@Router		/api/v1/me/reauth/passkey/begin [post]
func (h *authHandler) reauthPasskeyBegin(w http.ResponseWriter, r *http.Request) {
	if h.passkeys == nil {
		writeServiceError(w, service.ErrPasskeyDisabled)
		return
	}
	options, sessionID, err := h.passkeys.BeginReauth(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"options": options, "sessionId": sessionID})
}

// verifyEmail completes address verification from a mailed link.
//
//	@Summary	Verify an email address
//	@Tags		auth
//	@Param		body	body	tokenRequest	true	"Mailed token"
//	@Success	204		"verified"
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/auth/email/verify [post]
func (h *authHandler) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var req tokenRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := h.email.Verify(r.Context(), req.Token); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resendVerification and forgotPassword both answer 204 whatever happened.
// Any other behaviour would turn them into a way of asking which addresses
// have accounts.
// resendVerification re-sends a verification link. Always answers 204.
//
//	@Summary	Resend the verification email
//	@Tags		auth
//	@Param		body	body	emailRequest	true	"Email address"
//	@Success	204		"accepted"
//	@Router		/api/v1/auth/email/resend [post]
func (h *authHandler) resendVerification(w http.ResponseWriter, r *http.Request) {
	var req emailRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	h.email.ResendVerification(r.Context(), req.Email)
	w.WriteHeader(http.StatusNoContent)
}

// forgotPassword mails a reset link. Always answers 204.
//
//	@Summary	Request a password-reset email
//	@Tags		auth
//	@Param		body	body	emailRequest	true	"Email address"
//	@Success	204		"accepted"
//	@Router		/api/v1/auth/password/forgot [post]
func (h *authHandler) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var req emailRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	h.email.RequestReset(r.Context(), req.Email)
	w.WriteHeader(http.StatusNoContent)
}

// resetPassword sets a new password from a mailed link. No current password is
// asked for: reaching the link is the proof.
//
//	@Summary	Reset a password from a mailed link
//	@Tags		auth
//	@Param		body	body	resetPasswordRequest	true	"Token and new password"
//	@Success	204		"password changed"
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/auth/password/reset [post]
func (h *authHandler) resetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := h.email.ResetPassword(r.Context(), req.Token, req.NewPassword); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// refresh rotates a refresh token into a fresh session.
//
//	@Summary	Rotate a refresh token
//	@Tags		auth
//	@Param		body	body		refreshRequest	true	"Refresh token"
//	@Success	200		{object}	service.TokenPair
//	@Failure	401		{object}	errorBody
//	@Router		/api/v1/auth/refresh [post]
func (h *authHandler) refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	tokens, err := h.auth.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tokens)
}

// me returns the authenticated account.
//
//	@Summary	Get the current account
//	@Tags		account
//	@Security	BearerAuth
//	@Success	200	{object}	domain.User
//	@Failure	401	{object}	errorBody
//	@Router		/api/v1/me [get]
func (h *authHandler) me(w http.ResponseWriter, r *http.Request) {
	u, err := h.auth.Me(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// usage reports the caller's own consumption against their limits.
//
//	@Summary	Get my quota usage
//	@Tags		account
//	@Security	BearerAuth
//	@Success	200	{object}	service.Usage
//	@Failure	404	{object}	errorBody	"quotas not configured"
//	@Router		/api/v1/usage [get]
func (h *authHandler) usage(w http.ResponseWriter, r *http.Request) {
	if h.quotas == nil {
		writeError(w, http.StatusNotFound, "quotas are not configured")
		return
	}
	u, err := h.quotas.Usage(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// logout revokes a single refresh token.
//
//	@Summary	Sign out (revoke a refresh token)
//	@Tags		auth
//	@Param		body	body	refreshRequest	true	"Refresh token"
//	@Success	204		"signed out"
//	@Router		/api/v1/auth/logout [post]
func (h *authHandler) logout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := h.auth.Logout(r.Context(), req.RefreshToken); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
