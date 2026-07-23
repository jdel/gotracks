// Package auth provides password hashing and JWT access/refresh tokens.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// argon2 parameters (OWASP-recommended baseline).
const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
)

// ErrInvalidHash is returned when an encoded hash cannot be parsed.
var ErrInvalidHash = errors.New("auth: invalid password hash")

// Two 64 MiB Argon2 jobs may run at once. Extra requests wait without
// allocating their work buffer, bounding process-wide password memory at
// roughly 128 MiB regardless of request volume.
var passwordWorkSlots = make(chan struct{}, 2)

func withPasswordWork(ctx context.Context, work func()) error {
	select {
	case passwordWorkSlots <- struct{}{}:
		defer func() { <-passwordWorkSlots }()
		work()
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// HashPassword returns an encoded argon2id hash of the plaintext password.
func HashPassword(password string) (string, error) {
	return HashPasswordContext(context.Background(), password)
}

// HashPasswordContext is HashPassword with cancellation while waiting for the
// global Argon2 work allowance.
func HashPasswordContext(ctx context.Context, password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	var key []byte
	if err := withPasswordWork(ctx, func() {
		key = argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	}); err != nil {
		return "", err
	}
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword reports whether password matches the encoded argon2id hash.
func VerifyPassword(password, encoded string) (bool, error) {
	return VerifyPasswordContext(context.Background(), password, encoded)
}

// VerifyPasswordContext is VerifyPassword with cancellation while waiting for
// the global Argon2 work allowance.
func VerifyPasswordContext(ctx context.Context, password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, ErrInvalidHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, ErrInvalidHash
	}
	var mem uint32
	var t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &t, &p); err != nil {
		return false, ErrInvalidHash
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, ErrInvalidHash
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, ErrInvalidHash
	}
	var got []byte
	if err := withPasswordWork(ctx, func() {
		got = argon2.IDKey([]byte(password), salt, t, mem, p, uint32(len(want)))
	}); err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
