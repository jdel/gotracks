package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// newTwoFactorService builds the service over an in-memory database with one
// user, and returns the user id.
func newTwoFactorService(t *testing.T) (*service.TwoFactorService, *repo.Store, int64) {
	t.Helper()
	_, store, _ := newTodoService(t)
	ctx := context.Background()

	u := &domain.User{Email: "alice@example.com", Password: "x"}
	if err := store.Users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}
	svc := service.NewTwoFactorService(store.TwoFactor, store.RecoveryCodes, store.Users, store.Ephemeral, "gotracks")
	return svc, store, u.ID
}

// enrol takes a service through a full enrolment and returns the secret and the
// recovery codes handed to the user.
func enrol(t *testing.T, svc *service.TwoFactorService, userID int64) (string, []string) {
	t.Helper()
	ctx := context.Background()
	e, err := svc.BeginEnrolment(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	code, err := auth.GenerateTOTP(e.Secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	codes, err := svc.FinishEnrolment(ctx, userID, e.EnrolmentID, code)
	if err != nil {
		t.Fatalf("finish enrolment: %v", err)
	}
	return e.Secret, codes
}

// beginChallenge stands in for the password step of a sign-in.
func beginChallenge(t *testing.T, svc *service.TwoFactorService, userID int64) string {
	t.Helper()
	c, err := svc.Begin(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	return c.ChallengeID
}

// Enrolment must not switch 2FA on until a code proves the authenticator works,
// otherwise a user could lock themselves out of their own account.
func TestEnrolmentRequiresAVerifiedCode(t *testing.T) {
	svc, store, userID := newTwoFactorService(t)
	ctx := context.Background()

	e, err := svc.BeginEnrolment(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FinishEnrolment(ctx, userID, e.EnrolmentID, "000000"); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("want ErrTwoFactorCode, got %v", err)
	}

	enabled, err := svc.Enabled(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if enabled {
		t.Fatal("two-factor was enabled by a failed enrolment")
	}
	if n, err := store.RecoveryCodes.CountUnused(ctx, userID); err != nil || n != 0 {
		t.Fatalf("failed enrolment wrote %d recovery codes (err %v)", n, err)
	}
}

func TestEnrolmentThenVerifySucceeds(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	secret, codes := enrol(t, svc, userID)

	if len(codes) != auth.RecoveryCodeCount {
		t.Fatalf("got %d recovery codes, want %d", len(codes), auth.RecoveryCodeCount)
	}
	enabled, err := svc.Enabled(ctx, userID)
	if err != nil || !enabled {
		t.Fatalf("two-factor not enabled after enrolment (err %v)", err)
	}

	// A code from the next period, so it is a different timestep to the one
	// enrolment consumed.
	code, err := auth.GenerateTOTP(secret, time.Now().Add(auth.TOTPPeriod*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	u, err := svc.Verify(ctx, beginChallenge(t, svc, userID), code)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if u.ID != userID {
		t.Fatalf("verified as user %d, want %d", u.ID, userID)
	}
}

// A code must not work twice, even though plain skew validation would still
// accept it for another period.
func TestTOTPCodeCannotBeReplayed(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	secret, _ := enrol(t, svc, userID)

	at := time.Now().Add(auth.TOTPPeriod * time.Second)
	code, err := auth.GenerateTOTP(secret, at)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), code); err != nil {
		t.Fatalf("first use rejected: %v", err)
	}
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), code); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("replayed code accepted, or wrong error: %v", err)
	}
}

type gatedTwoFactorRepo struct {
	repo.TwoFactorRepo
	arrived chan struct{}
	release chan struct{}
}

func (g *gatedTwoFactorRepo) Get(ctx context.Context, userID int64) (*domain.TwoFactor, error) {
	tf, err := g.TwoFactorRepo.Get(ctx, userID)
	g.arrived <- struct{}{}
	<-g.release
	return tf, err
}

type gatedEphemeralRepo struct {
	repo.EphemeralRepo
	arrived chan struct{}
	release chan struct{}
}

func (g *gatedEphemeralRepo) Take(ctx context.Context, kind, id string) (*domain.Ephemeral, error) {
	g.arrived <- struct{}{}
	<-g.release
	return g.EphemeralRepo.Take(ctx, kind, id)
}

func releaseAfterArrivals(t *testing.T, arrived <-chan struct{}, release chan<- struct{}, count int) {
	t.Helper()
	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for range count {
		select {
		case <-arrived:
		case <-timeout.C:
			close(release)
			t.Fatal("concurrent verifications did not reach the race barrier")
		}
	}
	close(release)
}

func twoFactorResults(t *testing.T, results <-chan error, wantRejected error) (succeeded, rejected int) {
	t.Helper()
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, wantRejected):
			rejected++
		default:
			t.Fatalf("unexpected two-factor error: %v", err)
		}
	}
	return succeeded, rejected
}

func TestConcurrentTOTPCodeSucceedsOnce(t *testing.T) {
	svc, store, userID := newTwoFactorService(t)
	secret, _ := enrol(t, svc, userID)

	gated := &gatedTwoFactorRepo{
		TwoFactorRepo: store.TwoFactor,
		arrived:       make(chan struct{}, 2),
		release:       make(chan struct{}),
	}
	racing := service.NewTwoFactorService(
		gated, store.RecoveryCodes, store.Users, store.Ephemeral, "gotracks",
	)
	code, err := auth.GenerateTOTP(secret, time.Now().Add(auth.TOTPPeriod*time.Second))
	if err != nil {
		t.Fatal(err)
	}

	results := make(chan error, 2)
	for range 2 {
		challengeID := beginChallenge(t, racing, userID)
		go func() {
			_, err := racing.Verify(context.Background(), challengeID, code)
			results <- err
		}()
	}

	releaseAfterArrivals(t, gated.arrived, gated.release, 2)
	succeeded, rejected := twoFactorResults(t, results, service.ErrTwoFactorCode)
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("concurrent TOTP: succeeded=%d rejected=%d, want 1 each", succeeded, rejected)
	}
}

func TestConcurrentChallengeRedemptionSucceedsOnce(t *testing.T) {
	svc, store, userID := newTwoFactorService(t)
	_, codes := enrol(t, svc, userID)

	gated := &gatedEphemeralRepo{
		EphemeralRepo: store.Ephemeral,
		arrived:       make(chan struct{}, 2),
		release:       make(chan struct{}),
	}
	racing := service.NewTwoFactorService(
		store.TwoFactor, store.RecoveryCodes, store.Users, gated, "gotracks",
	)
	challengeID := beginChallenge(t, racing, userID)

	results := make(chan error, 2)
	for _, code := range codes[:2] {
		go func() {
			_, err := racing.Verify(context.Background(), challengeID, code)
			results <- err
		}()
	}

	releaseAfterArrivals(t, gated.arrived, gated.release, 2)
	succeeded, rejected := twoFactorResults(t, results, service.ErrTwoFactorChallenge)
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("concurrent challenge: succeeded=%d rejected=%d, want 1 each", succeeded, rejected)
	}
}

// The interaction naive implementations get wrong: once a step is spent, the
// earlier step inside the drift window must also be refused.
func TestEarlierStepRejectedAfterLaterOneUsed(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	secret, _ := enrol(t, svc, userID)

	now := time.Now()
	later, err := auth.GenerateTOTP(secret, now.Add(auth.TOTPPeriod*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	earlier, err := auth.GenerateTOTP(secret, now)
	if err != nil {
		t.Fatal(err)
	}
	if earlier == later {
		t.Skip("both timestamps fell in the same period")
	}

	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), later); err != nil {
		t.Fatalf("later code rejected: %v", err)
	}
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), earlier); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("earlier code accepted after a later one was used: %v", err)
	}
}

func TestRecoveryCodeIsSingleUse(t *testing.T) {
	svc, store, userID := newTwoFactorService(t)
	ctx := context.Background()
	_, codes := enrol(t, svc, userID)

	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), codes[0]); err != nil {
		t.Fatalf("recovery code rejected: %v", err)
	}
	if n, err := store.RecoveryCodes.CountUnused(ctx, userID); err != nil || n != auth.RecoveryCodeCount-1 {
		t.Fatalf("unused count = %d (err %v), want %d", n, err, auth.RecoveryCodeCount-1)
	}
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), codes[0]); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("recovery code reused successfully: %v", err)
	}
}

// Codes are accepted however the user types them back.
func TestRecoveryCodeAcceptedInAnyFormat(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	_, codes := enrol(t, svc, userID)

	messy := "  " + auth.NormaliseRecoveryCode(codes[0]) + "  "
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), messy); err != nil {
		t.Fatalf("unformatted recovery code rejected: %v", err)
	}
}

func TestRegenerateInvalidatesPreviousCodes(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	_, old := enrol(t, svc, userID)

	fresh, err := svc.RegenerateRecoveryCodes(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), old[0]); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("code from before regeneration still works: %v", err)
	}
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), fresh[0]); err != nil {
		t.Fatalf("freshly generated code rejected: %v", err)
	}
}

// Guessing must be bounded: the challenge burns after a handful of tries, so an
// attacker has to prove the password again.
func TestChallengeBurnsAfterRepeatedWrongCodes(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	enrol(t, svc, userID)

	id := beginChallenge(t, svc, userID)
	for i := 0; i < 4; i++ {
		if _, err := svc.Verify(ctx, id, "000000"); !errors.Is(err, service.ErrTwoFactorCode) {
			t.Fatalf("attempt %d: want ErrTwoFactorCode, got %v", i+1, err)
		}
	}
	// The fifth wrong code exhausts the allowance and destroys the challenge.
	if _, err := svc.Verify(ctx, id, "000000"); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("fifth attempt: want ErrTwoFactorCode, got %v", err)
	}
	if _, err := svc.Verify(ctx, id, "000000"); !errors.Is(err, service.ErrTwoFactorChallenge) {
		t.Fatalf("challenge survived its attempt allowance: %v", err)
	}
}

func TestUnknownChallengeIsRejected(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	enrol(t, svc, userID)

	if _, err := svc.Verify(context.Background(), "not-a-challenge", "000000"); !errors.Is(err, service.ErrTwoFactorChallenge) {
		t.Fatalf("want ErrTwoFactorChallenge, got %v", err)
	}
}

// A challenge is bound to the account that started it.
func TestChallengeIsNotTransferableBetweenUsers(t *testing.T) {
	svc, store, alice := newTwoFactorService(t)
	ctx := context.Background()

	bob := &domain.User{Email: "bob@example.com", Password: "x"}
	if err := store.Users.Create(ctx, bob); err != nil {
		t.Fatal(err)
	}
	_, aliceCodes := enrol(t, svc, alice)
	enrol(t, svc, bob.ID)

	// Bob's challenge must not accept one of Alice's recovery codes.
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, bob.ID), aliceCodes[0]); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("another user's recovery code was accepted: %v", err)
	}
}

// An enrolment ticket must not be redeemable as a sign-in challenge.
func TestEnrolmentTicketIsNotASignInChallenge(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	enrol(t, svc, userID)

	e, err := svc.BeginEnrolment(ctx, userID)
	if errors.Is(err, service.ErrTwoFactorEnabled) {
		return // already enrolled: no ticket can exist, which is the point
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Verify(ctx, e.EnrolmentID, "000000"); !errors.Is(err, service.ErrTwoFactorChallenge) {
		t.Fatalf("enrolment ticket was usable as a sign-in challenge: %v", err)
	}
}

func TestEnrolmentRefusedWhenAlreadyEnabled(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	enrol(t, svc, userID)

	if _, err := svc.BeginEnrolment(context.Background(), userID); !errors.Is(err, service.ErrTwoFactorEnabled) {
		t.Fatalf("want ErrTwoFactorEnabled, got %v", err)
	}
}

func TestDisableRequiresAValidCode(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()
	secret, _ := enrol(t, svc, userID)

	if err := svc.Disable(ctx, userID, "000000"); !errors.Is(err, service.ErrTwoFactorCode) {
		t.Fatalf("disable accepted a wrong code: %v", err)
	}
	if enabled, _ := svc.Enabled(ctx, userID); !enabled {
		t.Fatal("two-factor was disabled by a failed attempt")
	}

	code, err := auth.GenerateTOTP(secret, time.Now().Add(auth.TOTPPeriod*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Disable(ctx, userID, code); err != nil {
		t.Fatalf("disable with a valid code: %v", err)
	}
	if enabled, _ := svc.Enabled(ctx, userID); enabled {
		t.Fatal("two-factor still enabled after disable")
	}
}

// Disabling must take the recovery codes with it, so re-enrolling later cannot
// be defeated by a code issued under the old secret.
func TestDisableClearsRecoveryCodes(t *testing.T) {
	svc, store, userID := newTwoFactorService(t)
	ctx := context.Background()
	_, codes := enrol(t, svc, userID)

	if err := svc.Reset(ctx, userID); err != nil {
		t.Fatal(err)
	}
	if n, err := store.RecoveryCodes.CountUnused(ctx, userID); err != nil || n != 0 {
		t.Fatalf("%d recovery codes survived the reset (err %v)", n, err)
	}
	_ = codes
}

func TestStatusReportsRemainingCodes(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)
	ctx := context.Background()

	status, err := svc.Status(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if status.Enabled {
		t.Fatal("status reports enabled before enrolment")
	}

	_, codes := enrol(t, svc, userID)
	if _, err := svc.Verify(ctx, beginChallenge(t, svc, userID), codes[0]); err != nil {
		t.Fatal(err)
	}
	status, err = svc.Status(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled || status.EnabledAt == nil {
		t.Fatalf("status = %+v, want enabled with a timestamp", status)
	}
	if status.RecoveryCodesRemaining != auth.RecoveryCodeCount-1 {
		t.Fatalf("remaining = %d, want %d", status.RecoveryCodesRemaining, auth.RecoveryCodeCount-1)
	}
}

// Verifying against an account that never enrolled must not mint a session.
func TestVerifyRefusedWhenNotEnrolled(t *testing.T) {
	svc, _, userID := newTwoFactorService(t)

	if _, err := svc.Verify(context.Background(), beginChallenge(t, svc, userID), "000000"); !errors.Is(err, service.ErrTwoFactorNotEnabled) {
		t.Fatalf("want ErrTwoFactorNotEnabled, got %v", err)
	}
}
