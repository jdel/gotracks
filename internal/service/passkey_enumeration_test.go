package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// loginService builds a passkey service with a real relying party, so
// BeginLogin produces the options a browser would actually receive.
func loginService(t *testing.T) (*PasskeyService, *repo.Store) {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	sqldb.SetMaxOpenConns(1)
	bdb := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { bdb.Close() })
	if err := db.Migrate(context.Background(), bdb); err != nil {
		t.Fatal(err)
	}
	store := repo.NewStore(bdb)
	svc, err := NewPasskeyService(
		"example.com", "https://example.com", "gotracks",
		store.Credentials, store.Users, store.Ephemeral,
	)
	if err != nil {
		t.Fatal(err)
	}
	svc.SetDecoySecret([]byte("test-decoy-secret"))
	return svc, store
}

// enrolled creates an account holding one passkey.
func enrolled(t *testing.T, store *repo.Store, email string) *domain.User {
	t.Helper()
	ctx := context.Background()
	now := time.Now()
	u := &domain.User{Email: email, Password: "x", CreatedAt: now, UpdatedAt: now}
	if err := store.Users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}
	if err := store.Credentials.Create(ctx, &domain.Credential{
		UserID:       u.ID,
		Name:         "MacBook",
		CredentialID: "Y3JlZC1pZC1vbmU",
		PublicKey:    "public-key",
		CreatedAt:    now,
	}); err != nil {
		t.Fatal(err)
	}
	return u
}

// shape reduces the options to what a caller can actually observe, so the
// comparison is about structure rather than the random challenge inside it.
func shape(t *testing.T, options any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(options)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

// Refusing to start a ceremony told anyone who asked which addresses hold a
// passkey. An address with no account, and one that never enrolled a key, now
// get options indistinguishable from an account that has one.
func TestPasskeyBeginDoesNotRevealWhoHasOne(t *testing.T) {
	svc, store := loginService(t)
	ctx := context.Background()
	enrolled(t, store, "has-key@example.com")

	now := time.Now()
	if err := store.Users.Create(ctx, &domain.User{
		Email: "no-key@example.com", Password: "x", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}

	real, realID, err := svc.BeginLogin(ctx, "has-key@example.com")
	if err != nil {
		t.Fatalf("an enrolled account was refused: %v", err)
	}
	for _, email := range []string{"no-key@example.com", "stranger@example.com"} {
		options, id, err := svc.BeginLogin(ctx, email)
		if err != nil {
			t.Fatalf("%s was refused, which is the disclosure: %v", email, err)
		}
		if id == "" || id == realID {
			t.Errorf("%s: session id %q is not a fresh ceremony", email, id)
		}
		got, want := shape(t, options), shape(t, real)
		if len(got) != len(want) {
			t.Fatalf("%s: options have %d fields, an enrolled account %d", email, len(got), len(want))
		}
		for field := range want {
			if _, ok := got[field]; !ok {
				t.Errorf("%s: options are missing %q", email, field)
			}
		}
		// The part that would give it away: how many credentials are offered.
		gotCreds, _ := got["publicKey"].(map[string]any)["allowCredentials"].([]any)
		wantCreds, _ := want["publicKey"].(map[string]any)["allowCredentials"].([]any)
		if len(gotCreds) != len(wantCreds) {
			t.Errorf("%s: offers %d credentials, an enrolled account %d",
				email, len(gotCreds), len(wantCreds))
		}
	}
}

// A real credential id does not change between requests, so an invented one
// must not either — a value that moved would be the disclosure by another name.
func TestDecoyCredentialsAreStablePerAddress(t *testing.T) {
	svc, _ := loginService(t)
	ctx := context.Background()

	first, _, err := svc.BeginLogin(ctx, "stranger@example.com")
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := svc.BeginLogin(ctx, "stranger@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, _, err := svc.BeginLogin(ctx, "someone-else@example.com")
	if err != nil {
		t.Fatal(err)
	}

	id := func(options any) string {
		creds := shape(t, options)["publicKey"].(map[string]any)["allowCredentials"].([]any)
		return creds[0].(map[string]any)["id"].(string)
	}
	if id(first) != id(second) {
		t.Error("asking twice about one address produced different credentials")
	}
	if id(first) == id(other) {
		t.Error("two addresses were given the same invented credential")
	}
}

// The invented ceremony must be worthless: it is stored against nobody, so
// finishing it cannot authenticate anyone.
func TestDecoyCeremonyCannotAuthenticate(t *testing.T) {
	svc, _ := loginService(t)
	ctx := context.Background()

	_, id, err := svc.BeginLogin(ctx, "stranger@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FinishLogin(ctx, id, []byte(`{}`)); err == nil {
		t.Fatal("an invented ceremony authenticated somebody")
	}
}
