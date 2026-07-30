package api

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func idFor(t *testing.T, trusted []netip.Prefix, remoteAddr, inbound string) string {
	t.Helper()
	var got string
	h := RequestID(trusted)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = CorrelationID(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remoteAddr
	if inbound != "" {
		req.Header.Set("X-Request-ID", inbound)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	// The chosen id is also handed back to the client.
	if hdr := rec.Header().Get("X-Request-ID"); hdr != got {
		t.Fatalf("header id %q != context id %q", hdr, got)
	}
	return got
}

func TestRequestIDHonoursInboundFromTrustedProxy(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}

	// From a trusted proxy: a clean inbound id is reused.
	if got := idFor(t, trusted, "10.1.2.3:9999", "trace-abc-123"); got != "trace-abc-123" {
		t.Errorf("trusted inbound = %q, want it reused", got)
	}

	// From an untrusted peer: the inbound header is ignored, a fresh uuid minted.
	if got := idFor(t, trusted, "203.0.113.7:5000", "trace-abc-123"); got == "trace-abc-123" {
		t.Error("inbound id from an untrusted peer must not be believed")
	}

	// No trusted proxies configured: never believe the header.
	if got := idFor(t, nil, "10.1.2.3:9999", "trace-abc-123"); got == "trace-abc-123" {
		t.Error("with no trusted proxies, the header must be ignored")
	}
}

func TestRequestIDRejectsUnsafeInbound(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	for _, bad := range []string{
		"has space",
		"line\nbreak",
		string(make([]byte, 200)), // too long (also NUL bytes)
	} {
		if got := idFor(t, trusted, "10.0.0.1:1", bad); got == bad {
			t.Errorf("unsafe inbound id %q was believed", bad)
		}
	}
}
