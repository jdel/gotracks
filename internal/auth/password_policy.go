package auth

import (
	"errors"
	"unicode"
)

// MinPasswordLength is the shortest password accepted.
const MinPasswordLength = 10

// ErrWeakPassword reports a password that does not meet the policy. Use
// PasswordRules to tell the user which parts are missing.
var ErrWeakPassword = errors.New("password does not meet the policy")

// PasswordCheck is one rule and whether a password satisfied it.
type PasswordCheck struct {
	// ID is stable, so the UI can match a rule to its own wording.
	ID  string `json:"id"`
	Met bool   `json:"met"`
}

// PasswordRules reports each rule against a password.
//
// The browser mirrors these rules to give feedback as the user types
// (ui/src/lib/password.ts); this is the authority, and every path that sets a
// password goes through ValidatePassword.
func PasswordRules(password string) []PasswordCheck {
	var upper, lower, digit, symbol bool
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsLower(r):
			lower = true
		case unicode.IsDigit(r):
			digit = true
		// Anything that is not a letter, digit or space counts as a symbol,
		// so non-ASCII punctuation is accepted rather than silently rejected.
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			symbol = true
		}
	}
	return []PasswordCheck{
		{ID: "length", Met: len([]rune(password)) >= MinPasswordLength},
		{ID: "upper", Met: upper},
		{ID: "lower", Met: lower},
		{ID: "digit", Met: digit},
		{ID: "symbol", Met: symbol},
	}
}

// ValidatePassword returns ErrWeakPassword unless every rule is met.
func ValidatePassword(password string) error {
	for _, c := range PasswordRules(password) {
		if !c.Met {
			return ErrWeakPassword
		}
	}
	return nil
}
