package service

import (
	"context"
	"database/sql"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/repo"
)

func ceremonyService(t *testing.T) *PasskeyService {
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
	// Only the ceremony store is exercised here, so the WebAuthn config is
	// irrelevant.
	return &PasskeyService{ceremonies: repo.NewStore(bdb).Ephemeral}
}

// A ceremony started for one flow must not be redeemable by another: the
// registration and reauth paths both trust the stored owner, so a ceremony
// begun at the public sign-in endpoint must not satisfy either.
func TestPasskeyCeremoniesAreBoundToTheirKind(t *testing.T) {
	s := ceremonyService(t)
	ctx := context.Background()

	id, err := s.putCeremony(ctx, webauthn.SessionData{}, 1, kindPasskeySignIn)
	if err != nil {
		t.Fatal(err)
	}
	for _, wrong := range []string{kindPasskeyRegister, kindPasskeyReauth} {
		if _, _, ok := s.takeCeremony(ctx, id, wrong); ok {
			t.Errorf("a %q ceremony was redeemed as %q", kindPasskeySignIn, wrong)
		}
	}
	if _, _, ok := s.takeCeremony(ctx, id, kindPasskeySignIn); !ok {
		t.Error("the ceremony could not be redeemed for its own kind")
	}
}

func TestPasskeyCeremonyIsSingleUse(t *testing.T) {
	s := ceremonyService(t)
	ctx := context.Background()

	id, err := s.putCeremony(ctx, webauthn.SessionData{}, 1, kindPasskeyReauth)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, ok := s.takeCeremony(ctx, id, kindPasskeyReauth); !ok {
		t.Fatal("first redemption failed")
	}
	if _, _, ok := s.takeCeremony(ctx, id, kindPasskeyReauth); ok {
		t.Error("the same ceremony was redeemed twice")
	}
}

func TestUnknownPasskeyCeremonyIsRejected(t *testing.T) {
	s := ceremonyService(t)
	if _, _, ok := s.takeCeremony(context.Background(), "no-such-ceremony", kindPasskeyReauth); ok {
		t.Error("an unknown ceremony token was accepted")
	}
}

// The WebAuthn challenge has to survive the round trip through storage, or
// every assertion would fail validation on another instance.
func TestPasskeyCeremonyPayloadRoundTrips(t *testing.T) {
	s := ceremonyService(t)
	ctx := context.Background()

	want := webauthn.SessionData{
		Challenge:        "Y2hhbGxlbmdl",
		UserID:           []byte{1, 2, 3},
		UserVerification: "preferred",
	}
	id, err := s.putCeremony(ctx, want, 42, kindPasskeySignIn)
	if err != nil {
		t.Fatal(err)
	}
	got, owner, ok := s.takeCeremony(ctx, id, kindPasskeySignIn)
	if !ok {
		t.Fatal("could not redeem the ceremony")
	}
	if owner != 42 {
		t.Errorf("owner = %d, want 42", owner)
	}
	if got.Challenge != want.Challenge || string(got.UserID) != string(want.UserID) ||
		got.UserVerification != want.UserVerification {
		t.Errorf("session data did not round-trip:\n got %+v\nwant %+v", got, want)
	}
}
