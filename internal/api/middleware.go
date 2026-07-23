package api

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"golang.org/x/time/rate"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
)

type ctxKey int

const (
	ctxKeyRequestID ctxKey = iota
	ctxKeyClaims
	ctxKeyClientIP
)

// Middleware is a standard net/http middleware.
type Middleware func(http.Handler) http.Handler

type currentUserLookup func(context.Context, int64) (*domain.User, error)

// Chain applies middlewares so the first listed runs outermost.
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// statusRecorder captures the response status for logging.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// RequestID assigns a unique ID to each request, exposed via header and context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.NewString()
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), ctxKeyRequestID, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Logger logs each request with method, path, status and duration.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		id, _ := r.Context().Value(ctxKeyRequestID).(string)
		log.Info().
			Str("id", id).
			Str("method", r.Method).
			Str("path", r.URL.Path).
			Int("status", rec.status).
			Dur("dur", time.Since(start)).
			Str("remote", clientIP(r)).
			Msg("request")
	})
}

// Recover turns a panic into a 500 instead of crashing the server.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Error().Interface("err", v).Str("path", r.URL.Path).Msg("panic recovered")
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// CORS answers cross-origin preflights.
//
// allowedOrigins is the configured public origin list. When it is empty the
// policy stays "*", which suits a same-origin SPA and the dev proxy; a
// deployment that names its origin gets that origin echoed back instead, and
// nothing else. Credentials are never allowed either way — auth is a Bearer
// header, so there is nothing a browser would attach automatically.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[strings.TrimRight(strings.TrimSpace(o), "/")] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimRight(r.Header.Get("Origin"), "/")
			switch {
			case len(allowed) == 0:
				w.Header().Set("Access-Control-Allow-Origin", "*")
			case origin != "" && allowed[origin]:
				w.Header().Set("Access-Control-Allow-Origin", origin)
				// The response varies by Origin, so caches must not reuse it
				// across origins.
				w.Header().Add("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders sets the response headers that harden the browser side.
//
// The content policy is deliberately tight: the SPA is served entirely from
// this binary, so nothing legitimate loads from another origin. That matters
// here more than usual because the access and refresh tokens live in
// localStorage, which means any injected script would be an account takeover.
//
// hsts is only set when the deployment terminates TLS itself — sending it over
// plain HTTP would pin browsers to a scheme this server may not answer on.
func SecurityHeaders(hsts bool) func(http.Handler) http.Handler {
	const csp = "default-src 'self'; " +
		// Tailwind injects styles at runtime, so inline styles must be allowed.
		"style-src 'self' 'unsafe-inline'; " +
		// Server-rendered QR codes arrive as data: URIs.
		"img-src 'self' data:; " +
		"font-src 'self' data:; " +
		"connect-src 'self'; " +
		"object-src 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'; " +
		"frame-ancestors 'none'"

	// The Swagger UI at /doc ships its own bundle and initialises through an
	// inline script, which the strict app policy would block. Scope a slightly
	// looser policy to that path only, leaving the SPA locked down.
	const docsCSP = "default-src 'self'; " +
		"script-src 'self' 'unsafe-inline'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"font-src 'self' data:; " +
		"object-src 'none'; " +
		"frame-ancestors 'none'"

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			if strings.HasPrefix(r.URL.Path, "/doc") {
				h.Set("Content-Security-Policy", docsCSP)
			} else {
				h.Set("Content-Security-Policy", csp)
			}
			// Stops a browser second-guessing the type of an uploaded file.
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			// frame-ancestors covers modern browsers; this covers the rest.
			h.Set("X-Frame-Options", "DENY")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			if hsts {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimiter limits requests per client IP using a token bucket.
type RateLimiter struct {
	mu       sync.Mutex
	clients  map[string]*rate.Limiter
	rps      rate.Limit
	burst    int
	lastSeen map[string]time.Time
}

// AbuseLimiter combines per-client and process-wide budgets for a costly
// public route. Distributed callers can evade the first budget but not the
// second.
type AbuseLimiter struct {
	clients *RateLimiter
	global  *rate.Limiter
}

func NewAbuseLimiter(clientRPS float64, clientBurst int, globalRPS float64, globalBurst int) *AbuseLimiter {
	return &AbuseLimiter{
		clients: NewRateLimiter(clientRPS, clientBurst),
		global:  rate.NewLimiter(rate.Limit(globalRPS), globalBurst),
	}
}

func (l *AbuseLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.global.Allow() || !l.clients.limiter(clientKey(r)).Allow() {
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// NewRateLimiter builds a per-IP rate limiter and starts a cleanup loop.
func NewRateLimiter(rps float64, burst int) *RateLimiter {
	rl := &RateLimiter{
		clients:  make(map[string]*rate.Limiter),
		lastSeen: make(map[string]time.Time),
		rps:      rate.Limit(rps),
		burst:    burst,
	}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) limiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	l, ok := rl.clients[ip]
	if !ok {
		l = rate.NewLimiter(rl.rps, rl.burst)
		rl.clients[ip] = l
	}
	rl.lastSeen[ip] = time.Now()
	return l
}

func (rl *RateLimiter) cleanup() {
	for range time.Tick(time.Minute) {
		rl.mu.Lock()
		for ip, seen := range rl.lastSeen {
			if time.Since(seen) > 3*time.Minute {
				delete(rl.clients, ip)
				delete(rl.lastSeen, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware returns the rate-limiting middleware.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.limiter(clientKey(r)).Allow() {
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAuth validates the Bearer access token and stores claims in context.
func RequireAuth(tm *auth.TokenManager, currentUser currentUserLookup) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(header, "Bearer ")
			if !ok || token == "" {
				writeError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			claims, err := tm.ParseAccessToken(token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			user, err := currentUser(r.Context(), claims.UserID)
			if err != nil || user == nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			// Authorization comes from current account state, never from the
			// potentially stale role embedded in the access token.
			claims.IsAdmin = user.IsAdmin

			ctx := context.WithValue(r.Context(), ctxKeyClaims, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAdmin rejects authenticated users who are not administrators.
// It must be applied inside RequireAuth so claims are present.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := claimsFrom(r)
		if claims == nil || !claims.IsAdmin {
			writeError(w, http.StatusForbidden, "admin privileges required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// claimsFrom returns the authenticated claims stored by RequireAuth.
func claimsFrom(r *http.Request) *auth.Claims {
	c, _ := r.Context().Value(ctxKeyClaims).(*auth.Claims)
	return c
}

// RealIP resolves the client address once per request and stores it for the
// logger and the rate limiter to share, so both agree on who the caller is.
//
// X-Forwarded-For is believed only when the peer is itself one of the
// configured trusted proxies. Trusting it unconditionally would let any client
// mint a fresh rate-limit bucket per request and forge the logged address;
// ignoring it entirely puts every client behind a reverse proxy in one bucket.
func RealIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), ctxKeyClientIP, resolveClientIP(r, trusted))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// resolveClientIP walks X-Forwarded-For right to left, skipping addresses that
// are themselves trusted proxies, and returns the first one that is not: that
// entry was appended by the outermost proxy we trust, so everything left of it
// is client-supplied and must not be believed. Anything unexpected falls back
// to the transport address, which cannot be forged.
func resolveClientIP(r *http.Request, trusted []netip.Prefix) string {
	peer := peerHost(r)
	if len(trusted) == 0 {
		return peer
	}
	addr, err := netip.ParseAddr(peer)
	if err != nil || !trustedContains(trusted, addr) {
		return peer
	}
	for _, header := range r.Header.Values("X-Forwarded-For") {
		fields := strings.Split(header, ",")
		for i := len(fields) - 1; i >= 0; i-- {
			hop, err := parseForwardedAddr(strings.TrimSpace(fields[i]))
			if err != nil {
				// A malformed hop means the chain cannot be reasoned about
				// past this point; stop rather than skip over it.
				return peer
			}
			if !trustedContains(trusted, hop) {
				return hop.String()
			}
		}
	}
	return peer
}

// parseForwardedAddr accepts both "1.2.3.4" and the "1.2.3.4:1234" form some
// proxies emit, and unmaps IPv4-in-IPv6 so comparisons are like for like.
func parseForwardedAddr(s string) (netip.Addr, error) {
	if addr, err := netip.ParseAddr(s); err == nil {
		return addr.Unmap(), nil
	}
	ap, err := netip.ParseAddrPort(s)
	if err != nil {
		return netip.Addr{}, err
	}
	return ap.Addr().Unmap(), nil
}

func trustedContains(trusted []netip.Prefix, addr netip.Addr) bool {
	addr = addr.Unmap()
	for _, prefix := range trusted {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// peerHost is the transport address the request actually arrived from.
func peerHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// clientIP returns the address resolved by RealIP, falling back to the peer
// address when that middleware is not installed.
func clientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(ctxKeyClientIP).(string); ok {
		return ip
	}
	return peerHost(r)
}

// clientKey is the key rate limiting buckets by. It is the resolved client
// address: the transport address, or the forwarded one when the request came
// through a configured trusted proxy.
func clientKey(r *http.Request) string {
	return clientIP(r)
}
