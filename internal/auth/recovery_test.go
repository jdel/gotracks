package auth

import (
	"regexp"
	"testing"
)

var recoveryFormat = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$`)

func TestNewRecoveryCodesAreWellFormedAndUnique(t *testing.T) {
	plain, hashes, err := NewRecoveryCodes(RecoveryCodeCount)
	if err != nil {
		t.Fatal(err)
	}
	if len(plain) != RecoveryCodeCount || len(hashes) != RecoveryCodeCount {
		t.Fatalf("got %d codes / %d hashes, want %d of each", len(plain), len(hashes), RecoveryCodeCount)
	}

	seen := map[string]bool{}
	for i, code := range plain {
		if !recoveryFormat.MatchString(code) {
			t.Errorf("code %q is not in XXXX-XXXX-XXXX-XXXX Crockford form", code)
		}
		if seen[code] {
			t.Errorf("duplicate code %q", code)
		}
		seen[code] = true
		if hashes[i] != HashRecoveryCode(code) {
			t.Errorf("hash %d does not match its code", i)
		}
		if hashes[i] == code {
			t.Errorf("hash %d is the plaintext code", i)
		}
	}
}

// A user retyping a code should not be defeated by case, dashes, spaces, or the
// characters Crockford base32 deliberately omits.
func TestNormaliseRecoveryCode(t *testing.T) {
	cases := []struct{ in, want string }{
		{"ABCD-EFGH-JKMN-PQRS", "ABCDEFGHJKMNPQRS"},
		{"abcd-efgh-jkmn-pqrs", "ABCDEFGHJKMNPQRS"},
		{"  ABCD EFGH JKMN PQRS  ", "ABCDEFGHJKMNPQRS"},
		{"ABCDEFGHJKMNPQRS", "ABCDEFGHJKMNPQRS"},
		{"I", "1"},
		{"l", "1"},
		{"O", "0"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := NormaliseRecoveryCode(tc.in); got != tc.want {
			t.Errorf("NormaliseRecoveryCode(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestHashRecoveryCodeIgnoresFormatting(t *testing.T) {
	want := HashRecoveryCode("ABCD-EFGH-JKMN-PQRS")
	for _, variant := range []string{"abcd-efgh-jkmn-pqrs", "ABCDEFGHJKMNPQRS", " ABCD EFGH JKMN PQRS "} {
		if got := HashRecoveryCode(variant); got != want {
			t.Errorf("hash of %q differs from the canonical form", variant)
		}
	}
	if HashRecoveryCode("ABCD-EFGH-JKMN-PQRT") == want {
		t.Error("different codes hashed alike")
	}
}
