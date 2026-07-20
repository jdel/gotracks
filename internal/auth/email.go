package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/mail"
	"strings"
)

// MaxEmailLength bounds the stored address. 254 is the practical maximum for
// an email address in transit.
const MaxEmailLength = 254

// ErrInvalidEmail reports an address that cannot be used as an identity.
var ErrInvalidEmail = errors.New("invalid email address")

// NormaliseEmail puts an address into the canonical form used for storage and
// lookup: trimmed and lower-cased.
//
// Case folding matters because the address is the account identifier: without
// it "Alice@example.com" and "alice@example.com" would be two accounts for one
// mailbox, and password reset could not tell them apart.
//
// Plus-addressing is deliberately left alone. "alice+tracks@example.com" is a
// different address here even though most providers deliver it to the same
// mailbox — stripping it would break the people who use it on purpose, and
// providers disagree about what the separator even is. Abuse from throwaway
// aliases is handled by verification, the captcha and per-account quotas.
func NormaliseEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// ValidateEmail checks that an address is usable as an identity, after
// normalisation.
func ValidateEmail(email string) error {
	email = NormaliseEmail(email)
	if email == "" || len(email) > MaxEmailLength {
		return ErrInvalidEmail
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		// Rejects display-name forms like `Alice <a@b.com>`: the identity must
		// be the bare address and nothing else.
		return ErrInvalidEmail
	}
	at := strings.LastIndex(email, "@")
	if at < 1 {
		return ErrInvalidEmail
	}
	// A domain with no dot ("alice@localhost") cannot receive mail from the
	// internet, so it can never complete verification or a password reset.
	if !strings.Contains(email[at+1:], ".") {
		return ErrInvalidEmail
	}
	return nil
}

// HashEmailToken returns the digest a verification or reset token is stored as.
//
// The raw token is a credential for the life of the link, so only its hash is
// persisted: a leaked database copy then yields no working links. SHA-256 is
// enough because the token is high-entropy random, the same reasoning as for
// recovery codes.
func HashEmailToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
