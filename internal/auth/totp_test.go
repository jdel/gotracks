package auth

import (
	"strings"
	"testing"
	"time"
)

func testSecret(t *testing.T) string {
	t.Helper()
	key, err := NewTOTPSecret("gotracks", "alice")
	if err != nil {
		t.Fatal(err)
	}
	return key.Secret()
}

func TestValidateTOTPAcceptsCurrentCode(t *testing.T) {
	secret := testSecret(t)
	now := time.Now()
	code, err := GenerateTOTP(secret, now)
	if err != nil {
		t.Fatal(err)
	}
	step, ok := ValidateTOTP(secret, code, now)
	if !ok {
		t.Fatal("current code rejected")
	}
	if want := TOTPStep(now); step != want {
		t.Fatalf("step = %d, want %d", step, want)
	}
}

// One period of clock drift either way is tolerated; two is not.
func TestValidateTOTPSkewWindow(t *testing.T) {
	secret := testSecret(t)
	now := time.Now()

	cases := []struct {
		name   string
		offset time.Duration
		want   bool
	}{
		{"one period behind", -TOTPPeriod * time.Second, true},
		{"current", 0, true},
		{"one period ahead", TOTPPeriod * time.Second, true},
		{"two periods behind", -2 * TOTPPeriod * time.Second, false},
		{"two periods ahead", 2 * TOTPPeriod * time.Second, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, err := GenerateTOTP(secret, now.Add(tc.offset))
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := ValidateTOTP(secret, code, now); ok != tc.want {
				t.Fatalf("accepted = %v, want %v", ok, tc.want)
			}
		})
	}
}

// The step a code belongs to must be reported accurately, since replay
// prevention compares it against the last accepted step.
func TestValidateTOTPReportsMatchingStep(t *testing.T) {
	secret := testSecret(t)
	now := time.Now()
	earlier := now.Add(-TOTPPeriod * time.Second)

	code, err := GenerateTOTP(secret, earlier)
	if err != nil {
		t.Fatal(err)
	}
	step, ok := ValidateTOTP(secret, code, now)
	if !ok {
		t.Fatal("code from the previous period rejected")
	}
	if want := TOTPStep(earlier); step != want {
		t.Fatalf("step = %d, want %d (the step the code belongs to, not the current one)", step, want)
	}
}

func TestValidateTOTPRejectsGarbage(t *testing.T) {
	secret := testSecret(t)
	for _, code := range []string{"", "000000", "abcdef", "12345", "1234567"} {
		if _, ok := ValidateTOTP(secret, code, time.Now()); ok {
			t.Errorf("code %q was accepted", code)
		}
	}
}

func TestTOTPQRPNGIsAPNG(t *testing.T) {
	key, err := NewTOTPSecret("gotracks", "alice")
	if err != nil {
		t.Fatal(err)
	}
	png, err := TOTPQRPNG(key, 220)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(png[:8]), "\x89PNG") {
		t.Fatalf("output is not a PNG: % x", png[:8])
	}
}
