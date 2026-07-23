package auth

import (
	"context"
	"errors"
	"testing"
)

func TestHashVerifyRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	ok, err := VerifyPassword("correct horse battery staple", hash)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !ok {
		t.Fatal("expected password to verify")
	}
	ok, err = VerifyPassword("wrong", hash)
	if err != nil {
		t.Fatalf("verify wrong: %v", err)
	}
	if ok {
		t.Fatal("expected wrong password to fail")
	}
}

func TestVerifyInvalidHash(t *testing.T) {
	if _, err := VerifyPassword("x", "not-a-hash"); err == nil {
		t.Fatal("expected error for malformed hash")
	}
}

func TestPasswordWorkIsGloballyBoundedAndCancelable(t *testing.T) {
	if cap(passwordWorkSlots) != 2 {
		t.Fatalf("password work slots = %d, want 2", cap(passwordWorkSlots))
	}
	passwordWorkSlots <- struct{}{}
	passwordWorkSlots <- struct{}{}
	t.Cleanup(func() {
		<-passwordWorkSlots
		<-passwordWorkSlots
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := HashPasswordContext(ctx, "password"); !errors.Is(err, context.Canceled) {
		t.Fatalf("queued password work ignored cancellation: %v", err)
	}
}
