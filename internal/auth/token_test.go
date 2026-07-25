package auth

import (
	"testing"
	"time"
)

func testManager(secret string) *TokenManager {
	return NewTokenManager([]byte(secret), time.Minute, time.Hour)
}

func TestRefreshTokenHashRoundTrip(t *testing.T) {
	m := testManager("secret-a")

	token, hash, err := m.NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || hash == "" {
		t.Fatal("empty token or hash")
	}
	if token == hash {
		t.Fatal("the stored hash is the plaintext token")
	}
	if got := m.HashRefreshToken(token); got != hash {
		t.Fatalf("hashing the token again gave %q, want %q", got, hash)
	}
}

// Rotating the signing secret must invalidate refresh tokens, not just access
// tokens. With an unkeyed digest the stored hash still matched after a
// rotation, so a client could refresh straight back into a session and
// changing the secret evicted nobody.
func TestRotatingSecretInvalidatesRefreshTokens(t *testing.T) {
	before := testManager("secret-before")
	after := testManager("secret-after")

	token, storedHash, err := before.NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if after.HashRefreshToken(token) == storedHash {
		t.Fatal("a refresh token issued under the old secret still matches its stored hash after rotation")
	}
	// And the same secret still matches, so a restart with an unchanged secret
	// keeps sessions alive.
	if testManager("secret-before").HashRefreshToken(token) != storedHash {
		t.Fatal("an unchanged secret failed to match its own refresh token")
	}
}

func TestRotatingSecretInvalidatesAccessTokens(t *testing.T) {
	before := testManager("secret-before")
	after := testManager("secret-after")

	access, err := before.NewAccessToken(7, true, "sess")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := before.ParseAccessToken(access); err != nil {
		t.Fatalf("token rejected by the secret that signed it: %v", err)
	}
	if _, err := after.ParseAccessToken(access); err == nil {
		t.Fatal("access token signed with the old secret was accepted after rotation")
	}
}

func TestAccessTokenCarriesClaims(t *testing.T) {
	m := testManager("secret-a")
	access, err := m.NewAccessToken(42, true, "sess")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := m.ParseAccessToken(access)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != 42 || !claims.IsAdmin {
		t.Fatalf("claims = %+v, want user 42 and admin", claims)
	}
}
