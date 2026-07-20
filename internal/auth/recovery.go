package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"strings"
)

// RecoveryCodeCount is how many codes are issued at enrolment.
const RecoveryCodeCount = 10

// recoveryAlphabet is Crockford base32: no I, L, O or U, so codes cannot be
// misread as digits and there is no accidental profanity.
const recoveryAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

var recoveryEncoding = base32.NewEncoding(recoveryAlphabet).WithPadding(base32.NoPadding)

// NewRecoveryCodes returns n codes to show the user once, alongside the hashes
// to store. Each code carries 80 bits of entropy.
func NewRecoveryCodes(n int) (plain []string, hashes []string, err error) {
	plain = make([]string, 0, n)
	hashes = make([]string, 0, n)
	for i := 0; i < n; i++ {
		buf := make([]byte, 10)
		if _, err := rand.Read(buf); err != nil {
			return nil, nil, err
		}
		raw := recoveryEncoding.EncodeToString(buf) // 16 characters
		code := raw[0:4] + "-" + raw[4:8] + "-" + raw[8:12] + "-" + raw[12:16]
		plain = append(plain, code)
		hashes = append(hashes, HashRecoveryCode(code))
	}
	return plain, hashes, nil
}

// NormaliseRecoveryCode strips formatting so a user can type a code with or
// without dashes, in any case, and maps the characters Crockford base32 leaves
// out to the digits they are usually mistaken for.
func NormaliseRecoveryCode(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(s)) {
		switch {
		case r == 'I' || r == 'L':
			b.WriteRune('1')
		case r == 'O':
			b.WriteRune('0')
		case (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z'):
			b.WriteRune(r)
		}
	}
	return b.String()
}

// HashRecoveryCode returns the SHA-256 hex digest a code is stored as. See the
// RecoveryCode model for why this is not argon2.
func HashRecoveryCode(code string) string {
	sum := sha256.Sum256([]byte(NormaliseRecoveryCode(code)))
	return hex.EncodeToString(sum[:])
}
