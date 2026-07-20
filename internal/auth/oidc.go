package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// OIDCProvider performs the authorization-code flow against an OpenID Connect
// issuer. Endpoints are discovered from /.well-known/openid-configuration.
//
// This replaces Tracks' original OpenID 1.0/2.0 support, which is obsolete.
type OIDCProvider struct {
	clientID     string
	clientSecret string
	redirectURL  string

	authURL     string
	tokenURL    string
	userInfoURL string

	client *http.Client

	// states holds the CSRF state of in-flight sign-ins. It is an interface
	// because this package sits below storage: the server supplies a
	// database-backed implementation so a sign-in started on one instance can
	// be completed on another, which matters because the callback arrives via
	// a redirect from the identity provider and may land anywhere.
	states StateStore
}

// StateStore keeps OIDC CSRF states.
type StateStore interface {
	// Put records a state until expiresAt.
	Put(ctx context.Context, state string, expiresAt time.Time) error
	// Consume reports whether the state was live, and removes it. It must
	// succeed for at most one caller.
	Consume(ctx context.Context, state string) (bool, error)
}

// StateTTL is how long an unfinished sign-in stays valid.
const StateTTL = 10 * time.Minute

type discoveryDoc struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserInfoEndpoint      string `json:"userinfo_endpoint"`
}

// NewOIDCProvider discovers the issuer's endpoints and returns a provider.
func NewOIDCProvider(
	ctx context.Context,
	issuer, clientID, clientSecret, redirectURL string,
	states StateStore,
) (*OIDCProvider, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	wellKnown := strings.TrimSuffix(issuer, "/") + "/.well-known/openid-configuration"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wellKnown, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc discovery: unexpected status %d", res.StatusCode)
	}
	var doc discoveryDoc
	if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" {
		return nil, fmt.Errorf("oidc discovery: issuer is missing required endpoints")
	}

	p := &OIDCProvider{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURL:  redirectURL,
		authURL:      doc.AuthorizationEndpoint,
		tokenURL:     doc.TokenEndpoint,
		userInfoURL:  doc.UserInfoEndpoint,
		client:       client,
		states:       states,
	}
	return p, nil
}

// AuthURL returns the URL to redirect the browser to, plus the CSRF state.
func (p *OIDCProvider) AuthURL(ctx context.Context) (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	state := base64.RawURLEncoding.EncodeToString(buf)

	if err := p.states.Put(ctx, state, time.Now().Add(StateTTL)); err != nil {
		return "", err
	}

	q := url.Values{}
	q.Set("client_id", p.clientID)
	q.Set("redirect_uri", p.redirectURL)
	q.Set("response_type", "code")
	q.Set("scope", "openid email profile")
	q.Set("state", state)
	return p.authURL + "?" + q.Encode(), nil
}

// consumeState validates and removes a state value (single use).
func (p *OIDCProvider) consumeState(ctx context.Context, state string) bool {
	ok, err := p.states.Consume(ctx, state)
	return err == nil && ok
}

// OIDCUser is the identity returned by the provider.
type OIDCUser struct {
	Subject           string `json:"sub"`
	Email             string `json:"email"`
	PreferredUsername string `json:"preferred_username"`
	Name              string `json:"name"`
}

// Exchange swaps an authorization code for the caller's identity.
func (p *OIDCProvider) Exchange(ctx context.Context, code, state string) (*OIDCUser, error) {
	if !p.consumeState(ctx, state) {
		return nil, fmt.Errorf("oidc: invalid or expired state")
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", p.redirectURL)
	form.Set("client_id", p.clientID)
	form.Set("client_secret", p.clientSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc token exchange: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc token exchange: status %d", res.StatusCode)
	}

	var tokenRes struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokenRes); err != nil {
		return nil, err
	}

	// Prefer the userinfo endpoint; fall back to the id_token claims.
	if p.userInfoURL != "" && tokenRes.AccessToken != "" {
		if u, err := p.userInfo(ctx, tokenRes.AccessToken); err == nil {
			return u, nil
		}
	}
	return claimsFromIDToken(tokenRes.IDToken)
}

func (p *OIDCProvider) userInfo(ctx context.Context, accessToken string) (*OIDCUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.userInfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc userinfo: status %d", res.StatusCode)
	}
	u := new(OIDCUser)
	if err := json.NewDecoder(res.Body).Decode(u); err != nil {
		return nil, err
	}
	return u, nil
}

// claimsFromIDToken decodes the id_token payload without verifying its
// signature. Safe here only because the token came straight from the issuer's
// token endpoint over TLS, not from the browser.
func claimsFromIDToken(idToken string) (*OIDCUser, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("oidc: malformed id_token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("oidc: malformed id_token payload")
	}
	u := new(OIDCUser)
	if err := json.Unmarshal(payload, u); err != nil {
		return nil, err
	}
	if u.Subject == "" {
		return nil, fmt.Errorf("oidc: id_token has no subject")
	}
	return u, nil
}
