package api

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/service"
)

// oidcHandler serves the single sign-on endpoints. It is only registered when
// OIDC is fully configured.
type oidcHandler struct {
	provider *auth.OIDCProvider
	auth     *service.AuthService
}

// status tells the frontend whether to show the SSO button.
//
//	@Summary	OIDC capability status
//	@Tags		oidc
//	@Success	200	{object}	map[string]bool
//	@Router		/api/v1/auth/oidc/status [get]
func (h *oidcHandler) status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": h.provider != nil})
}

// start redirects the browser to the identity provider.
//
//	@Summary	Begin OIDC sign-in
//	@Tags		oidc
//	@Success	302	"redirect to the identity provider"
//	@Router		/api/v1/auth/oidc/start [get]
func (h *oidcHandler) start(w http.ResponseWriter, r *http.Request) {
	target, err := h.provider.AuthURL(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start sign-in")
		return
	}
	http.Redirect(w, r, target, http.StatusFound)
}

// callback completes the flow and hands the tokens to the SPA via the fragment,
// which keeps them out of server logs and the Referer header.
//
//	@Summary	OIDC redirect callback
//	@Tags		oidc
//	@Param		code	query	string	true	"Authorization code"
//	@Param		state	query	string	true	"CSRF state"
//	@Success	302		"redirect to the app with tokens in the fragment"
//	@Router		/api/v1/auth/oidc/callback [get]
func (h *oidcHandler) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if errMsg := q.Get("error"); errMsg != "" {
		http.Redirect(w, r, "/login?error="+url.QueryEscape(errMsg), http.StatusFound)
		return
	}
	code, state := q.Get("code"), q.Get("state")
	if code == "" || state == "" {
		writeError(w, http.StatusBadRequest, "missing code or state")
		return
	}

	id, err := h.provider.Exchange(r.Context(), code, state)
	if err != nil {
		http.Redirect(w, r, "/login?error="+url.QueryEscape("sso failed"), http.StatusFound)
		return
	}
	_, tokens, err := h.auth.LoginOIDC(r.Context(), id)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	http.Redirect(w, r, fmt.Sprintf("/login#access=%s&refresh=%s",
		url.QueryEscape(tokens.AccessToken), url.QueryEscape(tokens.RefreshToken)),
		http.StatusFound)
}
