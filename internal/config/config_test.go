package config_test

import (
	"testing"

	"github.com/jdel/gotracks/internal/config"
)

func TestWeakSecret(t *testing.T) {
	cases := []struct {
		name   string
		secret string
		weak   bool
	}{
		{"single character", "x", true},
		{"below floor", "0123456789abcdef0123456789abcde", true}, // 31 bytes
		{"exactly at floor", "0123456789abcdef0123456789abcdef", false}, // 32 bytes
		{"openssl rand -hex 32 output", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", false}, // 64 bytes
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := config.WeakSecret(tc.secret); got != tc.weak {
				t.Fatalf("WeakSecret(%q) = %v, want %v", tc.secret, got, tc.weak)
			}
		})
	}
}

func TestParseTrustedProxies(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		want  []string
		fails bool
	}{
		{name: "empty", in: "", want: nil},
		{name: "single cidr", in: "10.0.0.0/8", want: []string{"10.0.0.0/8"}},
		{name: "bare address becomes a host route", in: "10.0.0.5", want: []string{"10.0.0.5/32"}},
		{name: "bare ipv6 address", in: "::1", want: []string{"::1/128"}},
		{
			name: "list with whitespace",
			in:   " 10.0.0.0/8 , 192.168.0.1 ,fd00::/8 ",
			want: []string{"10.0.0.0/8", "192.168.0.1/32", "fd00::/8"},
		},
		// A host-bits-set CIDR is a common copy-paste; mask it rather than reject.
		{name: "non-canonical cidr is masked", in: "10.1.2.3/8", want: []string{"10.0.0.0/8"}},
		{name: "trailing comma", in: "10.0.0.0/8,", want: []string{"10.0.0.0/8"}},
		{name: "garbage", in: "not-an-ip", fails: true},
		{name: "bad mask", in: "10.0.0.0/99", fails: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := config.ParseTrustedProxies(tc.in)
			if tc.fails {
				if err == nil {
					t.Fatalf("ParseTrustedProxies(%q) = %v, want an error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseTrustedProxies(%q): %v", tc.in, err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i, prefix := range got {
				if prefix.String() != tc.want[i] {
					t.Errorf("prefix %d = %q, want %q", i, prefix.String(), tc.want[i])
				}
			}
		})
	}
}

func TestWebAuthnFromPublicURL(t *testing.T) {
	cases := []struct {
		in         string
		id, origin string
		wantErr    bool
	}{
		{in: "https://tracks.example.com", id: "tracks.example.com", origin: "https://tracks.example.com"},
		{in: "https://tracks.example.com/", id: "tracks.example.com", origin: "https://tracks.example.com"},
		{in: "http://localhost:8080", id: "localhost", origin: "http://localhost:8080"},
		// The port scopes the origin but never the RP id — WebAuthn ids are domains.
		{in: "https://app.example.com:8443/tracks", id: "app.example.com", origin: "https://app.example.com:8443"},
		{in: "not a url", wantErr: true},
		{in: "", wantErr: true},
		{in: "/just/a/path", wantErr: true},
	}
	for _, c := range cases {
		id, origin, err := config.WebAuthnFromPublicURL(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("WebAuthnFromPublicURL(%q): want error, got id=%q origin=%q", c.in, id, origin)
			}
			continue
		}
		if err != nil {
			t.Errorf("WebAuthnFromPublicURL(%q): unexpected error %v", c.in, err)
			continue
		}
		if id != c.id || origin != c.origin {
			t.Errorf("WebAuthnFromPublicURL(%q) = (%q, %q), want (%q, %q)", c.in, id, origin, c.id, c.origin)
		}
	}
}
