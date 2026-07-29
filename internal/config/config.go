// Package config holds the resolved runtime configuration.
//
// Values are gathered by the cmd layer (cobra flags, a config file and
// GOTRACKS_* environment variables via viper); this package only defines the
// shape and the invariants that do not depend on where a value came from.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// Config holds all runtime configuration.
type Config struct {
	Addr        string // HTTP listen address, e.g. ":8080"
	DatabaseURL string // sqlite:./tracks.db or postgres://...
	DBDebug     bool   // log every SQL statement
	LogLevel    string // zerolog level name

	JWTSecret       []byte        // signing key for access tokens
	AccessTokenTTL  time.Duration // lifetime of an access token
	RefreshTokenTTL time.Duration // lifetime of a refresh token
	AllowRegister   bool          // seeds the runtime setting on first run

	RateLimitRPS   float64 // per-client request rate
	RateLimitBurst int     // per-client burst

	// MetricsAddr is the listen address for the Prometheus metrics endpoint,
	// default ":9091". Empty disables it. It is a separate port from the
	// public API so per-account figures are not served there; the endpoint is
	// unauthenticated, so restrict who can reach the port (a private network, a
	// firewall, or an unpublished container port).
	MetricsAddr string

	// TLS certificate and key, both PEM files. Empty means plain HTTP, which is
	// the right choice when a reverse proxy already terminates TLS.
	TLSCert string
	TLSKey  string

	// PublicURL is the externally reachable base URL, used to build the links
	// in verification, password-reset, email-change and deletion mail. Required once mail is enabled:
	// the server has no other way to know how a browser reaches it, and
	// deriving it from a request Host header would let an attacker point a
	// reset link at their own site.
	PublicURL string

	// AllowedOrigins are the browser origins permitted to call the API. Empty
	// keeps the permissive "*" policy, which suits a same-origin deployment.
	AllowedOrigins []string

	// TrustedProxies lists the networks whose X-Forwarded-For header may be
	// believed. Empty (the default) means the header is never trusted and the
	// transport address is used, which is correct for a directly exposed server
	// but lumps every client behind a reverse proxy into one rate-limit bucket.
	TrustedProxies []netip.Prefix

	// Per-account limits. Zero or negative means unlimited, which is what a
	// single-user self-hosted instance wants.
	QuotaStorageBytes int64
	QuotaTodos        int
	QuotaProjects     int
	QuotaNotes        int
	QuotaContexts     int
	QuotaTags         int
	QuotaRecurring    int
	QuotaTagsPerTodo  int
	// LegalEnabled serves the legal pages and their admin screen. Off by
	// default: a private deployment has nobody to inform.
	LegalEnabled bool
	// Version is the build this binary reports, surfaced in the interface.
	Version string
	// AuditRetention is how long audit entries are kept. Zero keeps them
	// indefinitely, which an operator has to choose deliberately.
	AuditRetention time.Duration

	UploadDir      string // local mode: directory attachment files are stored under
	MaxUploadBytes int64  // per-file upload limit

	// Storage selects where attachments live. Type is "local" (an in-process
	// S3 server over UploadDir, the default) or "s3" (a real S3-compatible
	// endpoint, required for a high-availability deployment). In s3 mode the
	// endpoint and credentials come from the standard AWS environment variables
	// (AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, …), not from config.
	StorageType   string
	StorageBucket string

	// WebAuthn passkeys. RPID is the site domain (no scheme or port); RPOrigin
	// is the full origin, comma-separated for several. Both default to values
	// derived from PublicURL, so a typical single-origin deployment configures
	// only http.public-url; set these to override (a multi-origin dev setup, or
	// scoping the RP id to a parent domain).
	RPID     string
	RPOrigin string
	RPName   string
}

// HSTSEnabled reports whether Strict-Transport-Security should be sent. Only
// when this server terminates TLS: announcing it over plain HTTP would pin
// browsers to a scheme it may not answer on.
func (c *Config) HSTSEnabled() bool { return c.TLSEnabled() }

// TLSEnabled reports whether the server should serve HTTPS itself.
func (c *Config) TLSEnabled() bool {
	return c.TLSCert != "" && c.TLSKey != ""
}

// PasskeysEnabled reports whether WebAuthn is fully configured.
func (c *Config) PasskeysEnabled() bool {
	return c.RPID != "" && c.RPOrigin != ""
}

// WebAuthnFromPublicURL derives the relying-party id and origin from the public
// URL, so passkeys need no configuration beyond http.public-url.
//
// The RP id is the host with no port — WebAuthn scopes credentials to a domain,
// not a port. The origin is scheme://host[:port], exactly what a browser
// reports and what the library matches against. A URL with no host (a bare
// path, or an empty string) yields an error rather than a bogus RP.
func WebAuthnFromPublicURL(publicURL string) (rpID, origin string, err error) {
	u, err := url.Parse(strings.TrimSpace(publicURL))
	if err != nil {
		return "", "", fmt.Errorf("public url %q: %w", publicURL, err)
	}
	if u.Scheme == "" || u.Host == "" {
		return "", "", fmt.Errorf("public url %q needs a scheme and host to derive a passkey origin", publicURL)
	}
	return u.Hostname(), u.Scheme + "://" + u.Host, nil
}

// ParseTrustedProxies reads a comma-separated list of CIDRs. A bare address is
// accepted as a single-host network, since naming one reverse proxy by its
// address is the common case. An empty string yields no networks.
func ParseTrustedProxies(s string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, field := range strings.Split(s, ",") {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if prefix, err := netip.ParsePrefix(field); err == nil {
			out = append(out, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(field)
		if err != nil {
			return nil, fmt.Errorf("trusted proxy %q is neither a CIDR nor an address", field)
		}
		out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return out, nil
}

// GenerateSecret returns a random signing key, used when none is configured.
// Sessions issued with it stop working after a restart, so a real deployment
// should always set one explicitly.
func GenerateSecret() ([]byte, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	out := make([]byte, hex.EncodedLen(len(buf)))
	hex.Encode(out, buf)
	return out, nil
}
