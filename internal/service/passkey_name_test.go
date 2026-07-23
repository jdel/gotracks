package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"
)

func TestEncodeCredentialRejectsOversizedName(t *testing.T) {
	_, err := encodeCredential(
		&webauthn.Credential{},
		1,
		strings.Repeat("x", MaxNameCharacters+1),
	)
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("error = %v, want ErrValidation", err)
	}
}
