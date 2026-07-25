package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims are the JWT access-token claims.
type Claims struct {
	jwt.RegisteredClaims
	UserID  int64 `json:"uid"`
	IsAdmin bool  `json:"adm"`
	// SessionID names the refresh-token chain this access token belongs to, so
	// the session list can mark which entry is the caller's own. Absent on a
	// token minted before sessions were tracked, which simply leaves the
	// current session unmarked until the next refresh.
	SessionID string `json:"sid,omitempty"`
}

// TokenManager issues and validates access tokens and refresh tokens.
type TokenManager struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// NewTokenManager builds a TokenManager with the given signing secret and TTLs.
func NewTokenManager(secret []byte, accessTTL, refreshTTL time.Duration) *TokenManager {
	return &TokenManager{secret: secret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

// AccessTTL returns the configured access-token lifetime.
func (m *TokenManager) AccessTTL() time.Duration { return m.accessTTL }

// RefreshTTL returns the configured refresh-token lifetime.
func (m *TokenManager) RefreshTTL() time.Duration { return m.refreshTTL }

// NewAccessToken signs a short-lived access token for the user, bound to the
// session it was issued within.
func (m *TokenManager) NewAccessToken(userID int64, isAdmin bool, sessionID string) (string, error) {
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.accessTTL)),
			Subject:   fmt.Sprintf("%d", userID),
		},
		UserID:    userID,
		IsAdmin:   isAdmin,
		SessionID: sessionID,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
}

// ParseAccessToken validates a signed access token and returns its claims.
func (m *TokenManager) ParseAccessToken(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, err
	}
	return claims, nil
}

// NewRefreshToken returns a random opaque refresh token and its storage hash.
// The plaintext is given to the client; only the hash is persisted.
func (m *TokenManager) NewRefreshToken() (token, hash string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(buf)
	return token, m.HashRefreshToken(token), nil
}

// HashRefreshToken returns the digest a refresh token is stored as.
//
// It is an HMAC keyed with the signing secret, not a bare hash, so that
// rotating the secret invalidates refresh tokens as well as access tokens.
// With an unkeyed digest the stored hashes stayed valid across a rotation, and
// a client whose access token had just been rejected could simply refresh —
// meaning changing the secret evicted nobody, which is the opposite of what
// rotating a leaked key is for.
func (m *TokenManager) HashRefreshToken(token string) string {
	mac := hmac.New(sha256.New, m.secret)
	mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}
