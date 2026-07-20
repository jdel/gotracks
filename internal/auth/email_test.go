package auth

import "testing"

func TestValidateEmail(t *testing.T) {
	cases := []struct {
		email string
		ok    bool
	}{
		{"alice@example.com", true},
		{"Alice@Example.COM", true}, // normalised, not rejected
		{"alice+tracks@example.com", true},
		{"alice.smith@sub.example.co.uk", true},
		{"a@b.co", true},
		{"", false},
		{"alice", false},
		{"alice@", false},
		{"@example.com", false},
		{"alice@localhost", false},           // undeliverable from the internet
		{"alice example@test.com", false},    // space
		{"Alice <alice@example.com>", false}, // the identity is the bare address
		{"alice@@example.com", false},
	}
	for _, tc := range cases {
		err := ValidateEmail(tc.email)
		if tc.ok && err != nil {
			t.Errorf("ValidateEmail(%q) = %v, want nil", tc.email, err)
		}
		if !tc.ok && err == nil {
			t.Errorf("ValidateEmail(%q) = nil, want ErrInvalidEmail", tc.email)
		}
	}
}

// The address is the account identity, so casing must not create two accounts
// for one mailbox.
func TestNormaliseEmail(t *testing.T) {
	for in, want := range map[string]string{
		"Alice@Example.COM":   "alice@example.com",
		"  alice@example.com": "alice@example.com",
		"alice@example.com":   "alice@example.com",
	} {
		if got := NormaliseEmail(in); got != want {
			t.Errorf("NormaliseEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

// Plus-addressing is left intact on purpose: providers disagree about the
// separator, and stripping it would break people who use it deliberately.
func TestPlusAddressingIsPreserved(t *testing.T) {
	if got := NormaliseEmail("Alice+Tracks@example.com"); got != "alice+tracks@example.com" {
		t.Errorf("NormaliseEmail stripped or altered the tag: %q", got)
	}
}

func TestOverlongEmailRejected(t *testing.T) {
	long := make([]byte, MaxEmailLength)
	for i := range long {
		long[i] = 'a'
	}
	if err := ValidateEmail(string(long) + "@example.com"); err == nil {
		t.Error("an over-length address was accepted")
	}
}
