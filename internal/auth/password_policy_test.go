package auth

import "testing"

func TestValidatePassword(t *testing.T) {
	cases := []struct {
		name     string
		password string
		ok       bool
	}{
		{"meets every rule", "Str0ng!Passw0rd", true},
		{"exactly the minimum length", "Aa1!aaaaaa", true},
		{"one short", "Aa1!aaaaa", false},
		{"no uppercase", "str0ng!passw0rd", false},
		{"no lowercase", "STR0NG!PASSW0RD", false},
		{"no digit", "Strong!Password", false},
		{"no symbol", "Str0ngPassw0rd1", false},
		{"empty", "", false},
		{"long but only letters", "abcdefghijklmnopqrst", false},
		// Non-ASCII punctuation still counts as a symbol.
		{"unicode symbol", "Str0ng«Passw0rd", true},
		// Multi-byte characters count as one character, not one byte, so this
		// is 10 runes and must pass rather than sneaking past on byte length.
		{"unicode length counted in runes", "Aa1!éééééé", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePassword(tc.password)
			if tc.ok && err != nil {
				t.Fatalf("ValidatePassword(%q) = %v, want nil", tc.password, err)
			}
			if !tc.ok && err == nil {
				t.Fatalf("ValidatePassword(%q) = nil, want ErrWeakPassword", tc.password)
			}
		})
	}
}

// The UI needs to know which rules failed, not just that something did.
func TestPasswordRulesReportEachRule(t *testing.T) {
	byID := map[string]bool{}
	for _, c := range PasswordRules("abcdefghij") { // long, lowercase only
		byID[c.ID] = c.Met
	}
	want := map[string]bool{"length": true, "lower": true, "upper": false, "digit": false, "symbol": false}
	for id, expected := range want {
		if byID[id] != expected {
			t.Errorf("rule %q = %v, want %v", id, byID[id], expected)
		}
	}
}
