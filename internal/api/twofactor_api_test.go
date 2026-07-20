package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// twoFactorFixture wires the two handlers a sign-in touches over an in-memory
// store, with one enrolled user.
type twoFactorFixture struct {
	authHandler *authHandler
	twoFactor   *service.TwoFactorService
	store       *repo.Store
	secret      string
	codes       []string
	userID      int64
}

func newTwoFactorFixture(t *testing.T) *twoFactorFixture {
	t.Helper()
	ctx := context.Background()
	store := newTestStore(t)

	tm := auth.NewTokenManager([]byte("test-secret"), time.Minute, time.Hour)
	settings := service.NewSettingsService(store.Settings, true)
	authSvc := service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)
	twoFactor := service.NewTwoFactorService(store.TwoFactor, store.RecoveryCodes, store.Users, store.Ephemeral, "gotracks")

	u, _, err := authSvc.Register(ctx, "a@example.com", "S3cret-Passw0rd!", "")
	if err != nil {
		t.Fatal(err)
	}
	enrolment, err := twoFactor.BeginEnrolment(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, err := auth.GenerateTOTP(enrolment.Secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	codes, err := twoFactor.FinishEnrolment(ctx, u.ID, enrolment.EnrolmentID, code)
	if err != nil {
		t.Fatal(err)
	}

	return &twoFactorFixture{
		authHandler: &authHandler{auth: authSvc, twoFactor: twoFactor},
		twoFactor:   twoFactor,
		store:       store,
		secret:      enrolment.Secret,
		codes:       codes,
		userID:      u.ID,
	}
}

func postJSON(t *testing.T, h http.HandlerFunc, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// The response to a password that is correct but incomplete must carry the
// challenge and nothing else. Asserted against the raw body rather than a
// decoded struct, because a decode would quietly tolerate a leaked field.
func TestLoginWithTwoFactorReturnsChallengeOnly(t *testing.T) {
	f := newTwoFactorFixture(t)

	rec := postJSON(t, f.authHandler.login, "/api/v1/auth/login",
		map[string]string{"email": "a@example.com", "password": "S3cret-Passw0rd!"})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (the password step did succeed)", rec.Code)
	}
	body := rec.Body.String()

	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		t.Fatal(err)
	}
	if _, leaked := raw["user"]; leaked {
		t.Errorf("login response leaked the user object before the second factor: %s", body)
	}
	if _, leaked := raw["tokens"]; leaked {
		t.Errorf("login response issued tokens before the second factor: %s", body)
	}
	challenge, ok := raw["twoFactor"]
	if !ok {
		t.Fatalf("no challenge in the response: %s", body)
	}

	var c service.Challenge
	if err := json.Unmarshal(challenge, &c); err != nil {
		t.Fatal(err)
	}
	if c.ChallengeID == "" {
		t.Error("challenge has no id")
	}
	if !c.ExpiresAt.After(time.Now()) {
		t.Errorf("challenge already expired: %v", c.ExpiresAt)
	}
}

// A user without 2FA must see exactly the response shape clients already parse.
func TestLoginWithoutTwoFactorIsUnchanged(t *testing.T) {
	f := newTwoFactorFixture(t)
	ctx := context.Background()

	// Second account, no enrolment.
	authSvc := service.NewAuthService(
		f.store.Users, f.store.RefreshTokens,
		auth.NewTokenManager([]byte("test-secret"), time.Minute, time.Hour),
		service.NewSettingsService(f.store.Settings, true),
	)
	if _, _, err := authSvc.Register(ctx, "b@example.com", "An0ther-Passw0rd!", ""); err != nil {
		t.Fatal(err)
	}

	rec := postJSON(t, f.authHandler.login, "/api/v1/auth/login",
		map[string]string{"email": "b@example.com", "password": "An0ther-Passw0rd!"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["user"]; !ok {
		t.Errorf("user missing for an account without 2FA: %s", rec.Body.String())
	}
	if _, ok := raw["tokens"]; !ok {
		t.Errorf("tokens missing for an account without 2FA: %s", rec.Body.String())
	}
	if _, ok := raw["twoFactor"]; ok {
		t.Errorf("challenge offered to an account without 2FA: %s", rec.Body.String())
	}
}

// The verify endpoint completes the sign-in and is reachable with no bearer token.
func TestVerifyCompletesSignInWithoutABearerToken(t *testing.T) {
	f := newTwoFactorFixture(t)

	rec := postJSON(t, f.authHandler.login, "/api/v1/auth/login",
		map[string]string{"email": "a@example.com", "password": "S3cret-Passw0rd!"})
	var login authResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &login); err != nil {
		t.Fatal(err)
	}

	code, err := auth.GenerateTOTP(f.secret, time.Now().Add(auth.TOTPPeriod*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	rec = postJSON(t, f.authHandler.verifyTwoFactor, "/api/v1/auth/2fa/verify",
		map[string]string{"challengeId": login.TwoFactor.ChallengeID, "code": code})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var done authResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &done); err != nil {
		t.Fatal(err)
	}
	if done.Tokens == nil || done.Tokens.AccessToken == "" {
		t.Fatal("verify returned no tokens")
	}
	if done.User == nil || done.User.Email != "a@example.com" {
		t.Fatalf("verify returned the wrong user: %+v", done.User)
	}
}

// A wrong TOTP code and a wrong recovery code must be indistinguishable, so the
// error cannot be used to work out how an account is configured.
func TestWrongCodeResponsesAreIdentical(t *testing.T) {
	f := newTwoFactorFixture(t)

	challenge := func(t *testing.T) string {
		t.Helper()
		rec := postJSON(t, f.authHandler.login, "/api/v1/auth/login",
			map[string]string{"email": "a@example.com", "password": "S3cret-Passw0rd!"})
		var login authResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &login); err != nil {
			t.Fatal(err)
		}
		return login.TwoFactor.ChallengeID
	}

	badTOTP := postJSON(t, f.authHandler.verifyTwoFactor, "/api/v1/auth/2fa/verify",
		map[string]string{"challengeId": challenge(t), "code": "000000"})
	badRecovery := postJSON(t, f.authHandler.verifyTwoFactor, "/api/v1/auth/2fa/verify",
		map[string]string{"challengeId": challenge(t), "code": "ZZZZ-ZZZZ-ZZZZ-ZZZZ"})

	if badTOTP.Code != http.StatusUnauthorized {
		t.Errorf("wrong TOTP status = %d, want 401", badTOTP.Code)
	}
	if badTOTP.Code != badRecovery.Code {
		t.Errorf("statuses differ: TOTP %d, recovery %d", badTOTP.Code, badRecovery.Code)
	}
	if badTOTP.Body.String() != badRecovery.Body.String() {
		t.Errorf("bodies differ and reveal which factor was tried:\n TOTP:     %s\n recovery: %s",
			badTOTP.Body.String(), badRecovery.Body.String())
	}
}

// A wrong password must not reveal that the account uses 2FA.
func TestWrongPasswordDoesNotRevealTwoFactor(t *testing.T) {
	f := newTwoFactorFixture(t)

	rec := postJSON(t, f.authHandler.login, "/api/v1/auth/login",
		map[string]string{"email": "a@example.com", "password": "wrong-password"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("twoFactor")) {
		t.Errorf("failed password response mentions two-factor: %s", rec.Body.String())
	}
}
