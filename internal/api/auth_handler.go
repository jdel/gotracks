package api

import (
	"encoding/json"
	"net/http"

	"github.com/jdel/gotracks/internal/auth"

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
	admin     *service.AdminService
	quotas    *service.QuotaService
	legal     *service.LegalService
	audit     *service.AuditService
}

// auditPublic starts an audit entry for a route with no session, naming the
// address the caller claimed rather than an account that may not exist.
func (h *authHandler) auditPublic(r *http.Request, action, email string) service.Entry {
	e := auditFrom(r, action)
	e.TargetEmail = auth.NormaliseEmail(email)
	return e
}

type registerRequest struct {
	Email string `json:"email"`
	// Locale is the language picked on the form. Optional: an absent or
	// unsupported value leaves the account on the default.
	Locale string `json:"locale"`
	// TimeZone is the browser's IANA zone, used before the account can sign in
	// and save preferences itself.
	TimeZone string `json:"timeZone"`
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

type emailChangeRequest struct {
	NewEmail string `json:"newEmail"`
}

type tokenRequest struct {
	Token string `json:"token"`
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

// acceptInvitationRequest is where an account is really created, so it is also
// where agreement is captured. AcceptLegal is required when the instance serves
// the documents: recorded agreement the client never actually asked for is not
// agreement.
type acceptInvitationRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
	AcceptLegal bool   `json:"acceptLegal"`
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

// register emails an invitation for a new account (the first becomes admin).
//
//	@Summary	Request account enrollment
//	@Tags		auth
//	@Param		body	body	registerRequest	true	"Email and optional locale"
//	@Success	204	"accepted"
//	@Failure	400		{object}	errorBody
//	@Failure	403		{object}	errorBody	"registration disabled"
//	@Router		/api/v1/auth/register [post]
func (h *authHandler) register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	outcome, err := h.email.Enroll(
		r.Context(), req.Email, req.Locale, req.TimeZone,
	)
	// The response is identical whatever happened — that is what stops anyone
	// testing which addresses are registered. The log is where the difference
	// is visible, because somebody working through a list of addresses is
	// exactly what an operator needs to see.
	entry := h.auditPublic(r, domain.AuditRegisterRequested, req.Email)
	switch {
	case err != nil:
		entry.Action = domain.AuditRegisterRejected
		entry.Outcome = domain.AuditFailure
		entry.Detail = err.Error()
	case outcome == service.EnrollTaken:
		entry.Action = domain.AuditRegisterRejected
		entry.Outcome = domain.AuditFailure
		entry.Detail = "the address already has an account; the caller was not told"
	case outcome == service.EnrollThrottled:
		entry.Action = domain.AuditRegisterRejected
		entry.Outcome = domain.AuditFailure
		entry.Detail = "the address was emailed too recently; no invitation was sent"
	}
	h.audit.Record(r.Context(), entry)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
		entry := h.auditPublic(r, domain.AuditLoginFailed, req.Email)
		entry.Outcome = domain.AuditFailure
		entry.Detail = err.Error()
		h.audit.Record(r.Context(), entry)
		writeServiceError(w, r, err)
		return
	}
	success := h.auditPublic(r, domain.AuditLoginSucceeded, u.Email)
	success.ActorID, success.ActorEmail = &u.ID, u.Email
	success.TargetEmail = ""
	h.audit.Record(r.Context(), success)

	if h.email != nil {
		if err := h.email.CheckVerified(u); err != nil {
			writeServiceError(w, r, err)
			return
		}
	}

	// A second factor is owed: answer 200 with a challenge and nothing else.
	// The password step did succeed, so an error status would be wrong.
	if h.twoFactor != nil {
		enabled, err := h.twoFactor.Enabled(r.Context(), u.ID)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		if enabled {
			challenge, err := h.twoFactor.Begin(r.Context(), u.ID)
			if err != nil {
				writeServiceError(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, authResponse{TwoFactor: challenge})
			return
		}
	}

	tokens, err := h.auth.IssueFor(r.Context(), u)
	if err != nil {
		writeServiceError(w, r, err)
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
		writeServiceError(w, r, service.ErrTwoFactorChallenge)
		return
	}
	u, err := h.twoFactor.Verify(r.Context(), req.ChallengeID, req.Code)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	tokens, err := h.auth.IssueFor(r.Context(), u)
	if err != nil {
		writeServiceError(w, r, err)
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
			writeServiceError(w, r, service.ErrPasskeyDisabled)
			return
		}
		if err := h.passkeys.FinishReauth(r.Context(), uid, req.PasskeySessionID, req.PasskeyResponse); err != nil {
			writeServiceError(w, r, err)
			return
		}
		tokens, err = h.auth.SetPassword(r.Context(), uid, req.NewPassword)
	} else {
		tokens, err = h.auth.ChangePassword(r.Context(), uid, req.CurrentPassword, req.NewPassword)
	}
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	h.audit.Record(r.Context(), auditFrom(r, domain.AuditPasswordChanged))
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
		writeServiceError(w, r, service.ErrPasskeyDisabled)
		return
	}
	options, sessionID, err := h.passkeys.BeginReauth(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeServiceError(w, r, err)
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
		writeServiceError(w, r, err)
		return
	}
	h.audit.Record(r.Context(), auditFrom(r, domain.AuditEmailVerified))
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

// requestEmailChange sends a verification link to a proposed new address. The
// current address stays active until the mailed token is redeemed.
//
//	@Summary	Request a change to my email address
//	@Tags		account
//	@Security	BearerAuth
//	@Param		body	body	emailChangeRequest	true	"Proposed new email address"
//	@Success	204	"verification email sent"
//	@Failure	400	{object}	errorBody
//	@Failure	409	{object}	errorBody
//	@Router		/api/v1/me/email-change [post]
func (h *authHandler) requestEmailChange(w http.ResponseWriter, r *http.Request) {
	var req emailChangeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := h.email.SendEmailChange(r.Context(), claimsFrom(r).UserID, req.NewEmail); err != nil {
		writeServiceError(w, r, err)
		return
	}
	change := auditFrom(r, domain.AuditEmailChangeRequested)
	change.TargetEmail = auth.NormaliseEmail(req.NewEmail)
	h.audit.Record(r.Context(), change)
	w.WriteHeader(http.StatusNoContent)
}

// confirmEmailChange replaces the address after the new mailbox is proven.
//
//	@Summary	Confirm a new email address
//	@Tags		auth
//	@Param		body	body	tokenRequest	true	"Mailed email-change token"
//	@Success	204	"email changed"
//	@Failure	400	{object}	errorBody
//	@Failure	409	{object}	errorBody
//	@Router		/api/v1/auth/email/change/confirm [post]
func (h *authHandler) confirmEmailChange(w http.ResponseWriter, r *http.Request) {
	var req tokenRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := h.email.ConfirmEmailChange(r.Context(), req.Token); err != nil {
		writeServiceError(w, r, err)
		return
	}
	h.audit.Record(r.Context(), auditFrom(r, domain.AuditEmailChanged))
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
	// Recorded for every address, known or not: the response is deliberately
	// identical either way, so the log is the only place the difference in
	// volume against one address becomes visible.
	h.audit.Record(r.Context(), h.auditPublic(r, domain.AuditPasswordResetRequested, req.Email))
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
		writeServiceError(w, r, err)
		return
	}
	// No session here — reaching the mailed link is the proof — so the entry
	// names nobody but records that a reset completed from this address.
	h.audit.Record(r.Context(), auditFrom(r, domain.AuditPasswordReset))
	w.WriteHeader(http.StatusNoContent)
}

// acceptInvitation sets the first password, verifies the invited address and
// returns the initial authenticated session.
//
//	@Summary	Accept a user invitation
//	@Tags		auth
//	@Param		body	body	acceptInvitationRequest	true	"Invitation token, password and consent"
//	@Success	200	{object}	authResponse
//	@Failure	400	{object}	errorBody
//	@Router		/api/v1/auth/invitation/accept [post]
func (h *authHandler) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	var req acceptInvitationRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	// Checked before the token is spent: a refusal here has to leave the
	// invitation usable, or a client that forgot the field burns the link.
	if h.legal != nil && !req.AcceptLegal {
		writeError(w, http.StatusBadRequest,
			"the terms, privacy policy and cookie policy must be accepted")
		return
	}

	u, err := h.email.AcceptInvitation(r.Context(), req.Token, req.NewPassword)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if h.legal != nil {
		if err := h.legal.Accept(r.Context(), u.ID); err != nil {
			writeServiceError(w, r, err)
			return
		}
		accepted := auditFrom(r, domain.AuditLegalAccepted)
		accepted.ActorID, accepted.ActorEmail = &u.ID, u.Email
		h.audit.Record(r.Context(), accepted)
	}
	created := auditFrom(r, domain.AuditRegisterCompleted)
	created.ActorID, created.ActorEmail = &u.ID, u.Email
	h.audit.Record(r.Context(), created)
	tokens, err := h.auth.IssueFor(r.Context(), u)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, authResponse{User: u, Tokens: tokens})
}

// requestAccountDeletion sends a final-confirmation link to the authenticated
// account's stored address. The request accepts no destination or account ID,
// so a caller cannot redirect another user's destructive link.
//
//	@Summary	Request deletion of my account
//	@Tags		account
//	@Security	BearerAuth
//	@Success	204	"confirmation email sent"
//	@Failure	401	{object}	errorBody
//	@Router		/api/v1/me/deletion [post]
func (h *authHandler) requestAccountDeletion(w http.ResponseWriter, r *http.Request) {
	userID := claimsFrom(r).UserID
	if err := h.admin.CanDeleteOwnAccount(r.Context(), userID); err != nil {
		writeServiceError(w, r, err)
		return
	}
	if err := h.email.SendAccountDeletion(r.Context(), userID); err != nil {
		writeServiceError(w, r, err)
		return
	}
	h.audit.Record(r.Context(), auditFrom(r, domain.AuditAccountDeletionRequested))
	w.WriteHeader(http.StatusNoContent)
}

// confirmAccountDeletion permanently deletes the account authorized by a
// single-use emailed token. No active session is needed on the landing page.
//
//	@Summary	Confirm permanent account deletion
//	@Tags		auth
//	@Param		body	body	tokenRequest	true	"Mailed deletion token"
//	@Success	204	"account deleted"
//	@Failure	400	{object}	errorBody
//	@Failure	409	{object}	errorBody	"last administrator"
//	@Router		/api/v1/auth/account/deletion/confirm [post]
func (h *authHandler) confirmAccountDeletion(w http.ResponseWriter, r *http.Request) {
	var req tokenRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	userID, err := h.email.RedeemAccountDeletion(r.Context(), req.Token)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	// Read before the account goes: afterwards there is nobody to name, and an
	// erasure nobody can evidence is the one deletion worth recording most.
	var email string
	if u, err := h.admin.GetUser(r.Context(), userID); err == nil {
		email = u.Email
	}
	if err := h.admin.DeleteOwnAccount(r.Context(), userID); err != nil {
		writeServiceError(w, r, err)
		return
	}
	deleted := auditFrom(r, domain.AuditAccountDeleted)
	deleted.ActorID, deleted.ActorEmail = &userID, email
	deleted.Detail = "self-service deletion confirmed by email"
	h.audit.Record(r.Context(), deleted)
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
		writeServiceError(w, r, err)
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
		writeServiceError(w, r, err)
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
		writeServiceError(w, r, err)
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
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
