package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// writeJSON encodes v as JSON with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error().Err(err).Msg("encode response")
	}
}

// errorBody is the JSON shape of an error response.
type errorBody struct {
	Error string `json:"error"`
}

// writeError maps common service/repo errors to status codes.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorBody{Error: msg})
}

// writeServiceError translates a service-layer error into an HTTP response.
func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, repo.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, service.ErrValidation):
		writeError(w, http.StatusBadRequest, "invalid input")
	case errors.Is(err, service.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "invalid credentials")
	case errors.Is(err, service.ErrEmailTaken):
		writeError(w, http.StatusConflict, "that email address is already registered")
	case errors.Is(err, service.ErrRegisterDisabled):
		writeError(w, http.StatusForbidden, "registration disabled")
	case errors.Is(err, service.ErrEnrollmentCapacity):
		writeError(w, http.StatusServiceUnavailable, "registration is temporarily unavailable")
	case errors.Is(err, service.ErrInvalidRefresh):
		writeError(w, http.StatusUnauthorized, "invalid refresh token")
	case errors.Is(err, service.ErrLastAdmin):
		writeError(w, http.StatusConflict, "cannot remove the last admin")
	case errors.Is(err, service.ErrSelfDelete):
		writeError(w, http.StatusConflict, "cannot delete your own account")
	case errors.Is(err, service.ErrContextInUse):
		writeError(w, http.StatusConflict, "context still holds actions; move or delete them first")
	case errors.Is(err, service.ErrNotDue):
		writeError(w, http.StatusConflict, "this occurrence is not due yet")
	case errors.Is(err, service.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, service.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "file too large")
	case errors.Is(err, service.ErrPasskeyDisabled):
		writeError(w, http.StatusNotFound, "passkeys are not configured")
	case errors.Is(err, service.ErrPasskeySession):
		writeError(w, http.StatusBadRequest, "passkey session expired, please try again")
	case errors.Is(err, service.ErrQuotaExceeded):
		// 409 rather than 507: the account is at its own limit, not the
		// server out of space.
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, service.ErrEmailToken):
		writeError(w, http.StatusBadRequest, "this link is no longer valid; request a new one")
	case errors.Is(err, service.ErrEmailUnverified):
		writeError(w, http.StatusForbidden, "confirm your email address before signing in")
	case errors.Is(err, service.ErrEmailVerified):
		writeError(w, http.StatusConflict, "this account is already active")
	case errors.Is(err, service.ErrAccountLocked):
		writeError(w, http.StatusTooManyRequests,
			"too many failed sign-in attempts; try again in a few minutes")
	case errors.Is(err, auth.ErrInvalidEmail):
		writeError(w, http.StatusBadRequest, "enter a valid email address")
	case errors.Is(err, auth.ErrWeakPassword):
		writeError(w, http.StatusBadRequest,
			"password must be at least 10 characters and include an uppercase letter, a lowercase letter, a number and a symbol")
	case errors.Is(err, service.ErrTwoFactorChallenge):
		writeError(w, http.StatusBadRequest, "two-factor challenge expired, please sign in again")
	case errors.Is(err, service.ErrTwoFactorCode):
		// Identical for a wrong TOTP code and a wrong recovery code, so the
		// response cannot be used to probe which factors an account has.
		writeError(w, http.StatusUnauthorized, "invalid code")
	case errors.Is(err, service.ErrTwoFactorEnabled):
		writeError(w, http.StatusConflict, "two-factor is already enabled")
	case errors.Is(err, service.ErrTwoFactorNotEnabled):
		writeError(w, http.StatusConflict, "two-factor is not enabled")
	case errors.Is(err, service.ErrNoPasskeys):
		// Deliberately identical whether or not the account exists, so this
		// endpoint cannot be used to enumerate logins.
		writeError(w, http.StatusNotFound, "no passkey enrolled for this account")
	default:
		log.Error().Err(err).Msg("unhandled service error")
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

// decodeJSON reads a JSON body into dst, capping size.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}
