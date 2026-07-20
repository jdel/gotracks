package auth

import (
	"bytes"
	"crypto/subtle"
	"image/png"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// TOTPPeriod is the code rotation interval. Thirty seconds is what every
// authenticator app assumes by default.
const TOTPPeriod = 30

// totpOpts are the parameters both generation and validation must agree on.
// Skew is zero because ValidateTOTP walks the neighbouring steps itself.
var totpOpts = totp.ValidateOpts{
	Period:    TOTPPeriod,
	Skew:      0,
	Digits:    otp.DigitsSix,
	Algorithm: otp.AlgorithmSHA1,
}

// NewTOTPSecret creates a secret for a user. issuer is the name shown in the
// authenticator app, account identifies which login it belongs to.
func NewTOTPSecret(issuer, account string) (*otp.Key, error) {
	return totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: account,
		Period:      TOTPPeriod,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
}

// TOTPQRPNG renders the enrolment QR code. Rendering server-side keeps a QR
// library out of the browser bundle.
func TOTPQRPNG(key *otp.Key, size int) ([]byte, error) {
	img, err := key.Image(size, size)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// TOTPStep returns the timestep a moment falls in.
func TOTPStep(t time.Time) int64 { return t.Unix() / TOTPPeriod }

// ValidateTOTP checks a code against the secret, allowing one step of clock
// drift either side, and reports which timestep matched.
//
// The step is the point of this function: totp.Validate reports only whether a
// code was valid, but accepting a code twice within the drift window has to be
// prevented, and that needs to know which step was used. Callers persist the
// returned step and refuse anything not strictly greater.
func ValidateTOTP(secret, code string, now time.Time) (int64, bool) {
	for delta := int64(-1); delta <= 1; delta++ {
		at := now.Add(time.Duration(delta) * TOTPPeriod * time.Second)
		want, err := totp.GenerateCodeCustom(secret, at, totpOpts)
		if err != nil {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return TOTPStep(at), true
		}
	}
	return 0, false
}

// GenerateTOTP produces the code valid at a moment. Used by tests and by the
// end-to-end script, so no external OTP tool is needed to drive a login.
func GenerateTOTP(secret string, at time.Time) (string, error) {
	return totp.GenerateCodeCustom(secret, at, totpOpts)
}
