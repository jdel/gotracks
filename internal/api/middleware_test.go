package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/config"
)

// X-Forwarded-For is set by the client. Keying the limiter on it would let one
// socket mint a fresh bucket per request, leaving login unprotected.
func TestRateLimiterIgnoresSpoofedForwardedFor(t *testing.T) {
	rl := NewRateLimiter(1, 2) // 1 rps, burst 2
	h := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	limited := false
	for i := 0; i < 50; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
		req.RemoteAddr = "203.0.113.7:40000" // one real client throughout
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("10.0.%d.%d", i/250, i%250))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("50 rapid requests from one socket were never limited: XFF spoofing bypasses the limiter")
	}
}

// Distinct clients must still get their own budget.
func TestRateLimiterSeparatesRealClients(t *testing.T) {
	rl := NewRateLimiter(1, 2)
	h := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/todos", nil)
		req.RemoteAddr = fmt.Sprintf("198.51.100.%d:40000", i)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d from a distinct address was limited: %d", i, rec.Code)
		}
	}
}

// resolved runs a request through RealIP and reports the address it settled on.
func resolved(t *testing.T, remoteAddr, xff string, trusted []netip.Prefix) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	var got string
	RealIP(trusted)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = clientIP(r)
		if key := clientKey(r); key != got {
			t.Errorf("clientKey = %q but clientIP = %q; they must agree", key, got)
		}
	})).ServeHTTP(httptest.NewRecorder(), req)
	return got
}

func mustPrefixes(t *testing.T, s string) []netip.Prefix {
	t.Helper()
	p, err := config.ParseTrustedProxies(s)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestRealIPResolution(t *testing.T) {
	proxy := mustPrefixes(t, "10.0.0.0/8")

	cases := []struct {
		name       string
		remoteAddr string
		xff        string
		trusted    []netip.Prefix
		want       string
	}{{
		// The default: no proxy configured, so the header means nothing.
		name:       "no trusted proxies ignores the header",
		remoteAddr: "203.0.113.7:40000",
		xff:        "10.1.2.3, 172.16.0.1",
		trusted:    nil,
		want:       "203.0.113.7",
	}, {
		// A direct caller cannot promote itself by inventing a header.
		name:       "untrusted peer ignores the header",
		remoteAddr: "203.0.113.7:40000",
		xff:        "10.1.2.3",
		trusted:    proxy,
		want:       "203.0.113.7",
	}, {
		name:       "trusted proxy forwards the client address",
		remoteAddr: "10.0.0.5:40000",
		xff:        "203.0.113.7",
		trusted:    proxy,
		want:       "203.0.113.7",
	}, {
		// Only the rightmost non-proxy hop was appended by a proxy we trust;
		// the entries to its left are whatever the client sent.
		name:       "spoofed prefix through a trusted proxy is discarded",
		remoteAddr: "10.0.0.5:40000",
		xff:        "1.2.3.4, 198.51.100.9",
		trusted:    proxy,
		want:       "198.51.100.9",
	}, {
		name:       "chained trusted proxies are skipped",
		remoteAddr: "10.0.0.5:40000",
		xff:        "198.51.100.9, 10.0.0.9, 10.0.0.7",
		trusted:    proxy,
		want:       "198.51.100.9",
	}, {
		name:       "proxy appending a port is understood",
		remoteAddr: "10.0.0.5:40000",
		xff:        "198.51.100.9:51234",
		trusted:    proxy,
		want:       "198.51.100.9",
	}, {
		name:       "malformed hop falls back to the peer",
		remoteAddr: "10.0.0.5:40000",
		xff:        "198.51.100.9, not-an-ip",
		trusted:    proxy,
		want:       "10.0.0.5",
	}, {
		name:       "trusted proxy with no header falls back to the peer",
		remoteAddr: "10.0.0.5:40000",
		xff:        "",
		trusted:    proxy,
		want:       "10.0.0.5",
	}, {
		// Every hop trusted means no client address was ever recorded.
		name:       "all hops trusted falls back to the peer",
		remoteAddr: "10.0.0.5:40000",
		xff:        "10.0.0.9",
		trusted:    proxy,
		want:       "10.0.0.5",
	}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolved(t, tc.remoteAddr, tc.xff, tc.trusted); got != tc.want {
				t.Errorf("resolved = %q, want %q", got, tc.want)
			}
		})
	}
}

// The point of the setting: behind a proxy every client must keep its own
// budget instead of sharing the proxy's single bucket.
func TestRateLimiterSeparatesClientsBehindTrustedProxy(t *testing.T) {
	rl := NewRateLimiter(1, 2)
	h := RealIP(mustPrefixes(t, "10.0.0.0/8"))(rl.Middleware(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})))

	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/todos", nil)
		req.RemoteAddr = "10.0.0.5:40000" // always the same proxy
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d from a distinct client behind the proxy was limited: %d", i, rec.Code)
		}
	}
}

// ...but one client behind that proxy is still limited.
func TestRateLimiterLimitsOneClientBehindTrustedProxy(t *testing.T) {
	rl := NewRateLimiter(1, 2)
	h := RealIP(mustPrefixes(t, "10.0.0.0/8"))(rl.Middleware(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})))

	limited := false
	for i := 0; i < 50; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
		req.RemoteAddr = "10.0.0.5:40000"
		req.Header.Set("X-Forwarded-For", "198.51.100.9")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("50 rapid requests from one client behind the proxy were never limited")
	}
}

func TestSecurityHeadersAreSet(t *testing.T) {
	h := SecurityHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	for header, want := range map[string]string{
		"X-Content-Type-Options":     "nosniff",
		"Referrer-Policy":            "strict-origin-when-cross-origin",
		"X-Frame-Options":            "DENY",
		"Cross-Origin-Opener-Policy": "same-origin",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	csp := rec.Header().Get("Content-Security-Policy")
	for _, directive := range []string{"default-src 'self'", "frame-ancestors 'none'", "object-src 'none'"} {
		if !strings.Contains(csp, directive) {
			t.Errorf("CSP is missing %q: %s", directive, csp)
		}
	}
}

// HSTS is only safe once this server terminates TLS; over plain HTTP it would
// pin browsers to a scheme that may not answer.
func TestHSTSOnlyWithTLS(t *testing.T) {
	for _, tls := range []bool{false, true} {
		rec := httptest.NewRecorder()
		SecurityHeaders(tls)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).
			ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		got := rec.Header().Get("Strict-Transport-Security")
		if tls && got == "" {
			t.Error("HSTS missing when TLS is on")
		}
		if !tls && got != "" {
			t.Errorf("HSTS sent without TLS: %q", got)
		}
	}
}

func TestCORSAllowlist(t *testing.T) {
	cases := []struct {
		name    string
		allowed []string
		origin  string
		want    string
	}{
		{"unset stays permissive", nil, "https://evil.example", "*"},
		{"allowed origin is echoed", []string{"https://tracks.example.com"}, "https://tracks.example.com", "https://tracks.example.com"},
		{"other origins get nothing", []string{"https://tracks.example.com"}, "https://evil.example", ""},
		{"trailing slash tolerated", []string{"https://tracks.example.com/"}, "https://tracks.example.com", "https://tracks.example.com"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/todos", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rec := httptest.NewRecorder()
			CORS(tc.allowed)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(rec, req)
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != tc.want {
				t.Errorf("Allow-Origin = %q, want %q", got, tc.want)
			}
		})
	}
}
