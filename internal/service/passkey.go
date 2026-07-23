package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// Passkey errors surfaced to handlers.
var (
	ErrPasskeyDisabled = errors.New("passkeys are not configured")
	ErrPasskeySession  = errors.New("passkey session expired or invalid")
	ErrNoPasskeys      = errors.New("no passkey enrolled for this account")
)

// randomToken returns an unguessable id for a pending ceremony.
func randomToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// webauthnUser adapts a user plus their credentials to the library's interface.
type webauthnUser struct {
	user  *domain.User
	creds []webauthn.Credential
}

func (u webauthnUser) WebAuthnID() []byte {
	return []byte(fmt.Sprintf("%d", u.user.ID))
}
func (u webauthnUser) WebAuthnName() string        { return u.user.Email }
func (u webauthnUser) WebAuthnDisplayName() string { return u.user.Email }
func (u webauthnUser) WebAuthnCredentials() []webauthn.Credential {
	return u.creds
}

// PasskeyService handles WebAuthn enrolment and login.
//
// Sessions are held in memory: they live for seconds between the begin and
// finish calls, so persisting them would add coupling for no benefit. A restart
// mid-ceremony simply means the user retries.
type PasskeyService struct {
	web         *webauthn.WebAuthn
	credentials repo.CredentialRepo
	users       repo.UserRepo
	// ceremonies are shared through the database rather than held per process,
	// so a ceremony begun on one instance can be finished on another.
	ceremonies repo.EphemeralRepo
}

// The three WebAuthn flows are kept apart by kind. Without it a ceremony
// started by one endpoint could be redeemed at another — enrolling a key, or
// re-proving identity, with a ceremony begun somewhere else.
const (
	kindPasskeyRegister = "passkey-register"
	kindPasskeySignIn   = "passkey-signin"
	kindPasskeyReauth   = "passkey-reauth"
)

// ceremonyTTL is how long a half-finished WebAuthn exchange stays valid. The
// browser completes it in seconds; this is generous.
const ceremonyTTL = 5 * time.Minute

// NewPasskeyService builds the service. It returns nil when WebAuthn is not
// configured, which callers treat as "passkeys unavailable".
func NewPasskeyService(
	rpID, rpOrigin, rpName string,
	creds repo.CredentialRepo,
	users repo.UserRepo,
	ceremonies repo.EphemeralRepo,
) (*PasskeyService, error) {
	if rpID == "" || rpOrigin == "" {
		return nil, nil
	}
	web, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: rpName,
		RPOrigins:     strings.Split(rpOrigin, ","),
	})
	if err != nil {
		return nil, err
	}
	return &PasskeyService{
		web:         web,
		credentials: creds,
		users:       users,
		ceremonies:  ceremonies,
	}, nil
}

// putCeremony stores a half-finished WebAuthn exchange and returns its token.
func (s *PasskeyService) putCeremony(
	ctx context.Context, data webauthn.SessionData, userID int64, kind string,
) (string, error) {
	id, err := randomToken()
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	if err := s.ceremonies.ReplaceForUser(ctx, &domain.Ephemeral{
		ID:        id,
		Kind:      kind,
		UserID:    userID,
		Payload:   payload,
		ExpiresAt: time.Now().Add(ceremonyTTL),
	}); err != nil {
		return "", err
	}
	return id, nil
}

// takeCeremony consumes an exchange. Single-use across instances: only one
// caller can redeem a given token.
func (s *PasskeyService) takeCeremony(
	ctx context.Context, id, kind string,
) (webauthn.SessionData, int64, bool) {
	e, err := s.ceremonies.Take(ctx, kind, id)
	if err != nil {
		return webauthn.SessionData{}, 0, false
	}
	var data webauthn.SessionData
	if err := json.Unmarshal(e.Payload, &data); err != nil {
		return webauthn.SessionData{}, 0, false
	}
	return data, e.UserID, true
}

// credentialsFor loads a user's stored passkeys in the library's format.
func (s *PasskeyService) credentialsFor(ctx context.Context, userID int64) ([]webauthn.Credential, []*domain.Credential, error) {
	stored, err := s.credentials.ListForUser(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	out := make([]webauthn.Credential, 0, len(stored))
	for _, c := range stored {
		cred, err := decodeCredential(c)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, cred)
	}
	return out, stored, nil
}

// BeginRegistration starts enrolment for an authenticated user.
func (s *PasskeyService) BeginRegistration(ctx context.Context, userID int64) (any, string, error) {
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	creds, _, err := s.credentialsFor(ctx, userID)
	if err != nil {
		return nil, "", err
	}

	// Exclude keys already enrolled so the authenticator does not offer a duplicate.
	exclusions := make([]protocol.CredentialDescriptor, 0, len(creds))
	for _, c := range creds {
		exclusions = append(exclusions, c.Descriptor())
	}

	options, sessionData, err := s.web.BeginRegistration(
		webauthnUser{user: u, creds: creds},
		webauthn.WithExclusions(exclusions),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred),
	)
	if err != nil {
		return nil, "", err
	}
	id, err := s.putCeremony(ctx, *sessionData, userID, kindPasskeyRegister)
	if err != nil {
		return nil, "", err
	}
	return options, id, nil
}

// FinishRegistration stores the newly created passkey.
func (s *PasskeyService) FinishRegistration(
	ctx context.Context, userID int64, sessionID, name string, response []byte,
) (*domain.Credential, error) {
	data, owner, ok := s.takeCeremony(ctx, sessionID, kindPasskeyRegister)
	if !ok || owner != userID {
		return nil, ErrPasskeySession
	}
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	creds, _, err := s.credentialsFor(ctx, userID)
	if err != nil {
		return nil, err
	}

	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPasskeySession, err)
	}
	cred, err := s.web.CreateCredential(webauthnUser{user: u, creds: creds}, data, parsed)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPasskeySession, err)
	}

	stored, err := encodeCredential(cred, userID, name)
	if err != nil {
		return nil, err
	}
	if err := s.credentials.Create(ctx, stored); err != nil {
		return nil, err
	}
	return stored, nil
}

// BeginLogin starts a passkey login for a named account.
func (s *PasskeyService) BeginLogin(ctx context.Context, email string) (any, string, error) {
	u, err := s.users.ByEmail(ctx, auth.NormaliseEmail(email))
	if err != nil {
		// Do not reveal whether the account exists.
		return nil, "", ErrNoPasskeys
	}
	creds, _, err := s.credentialsFor(ctx, u.ID)
	if err != nil {
		return nil, "", err
	}
	if len(creds) == 0 {
		return nil, "", ErrNoPasskeys
	}

	options, sessionData, err := s.web.BeginLogin(webauthnUser{user: u, creds: creds})
	if err != nil {
		return nil, "", err
	}
	id, err := s.putCeremony(ctx, *sessionData, u.ID, kindPasskeySignIn)
	if err != nil {
		return nil, "", err
	}
	return options, id, nil
}

// FinishLogin validates the assertion and returns the authenticated user.
func (s *PasskeyService) FinishLogin(ctx context.Context, sessionID string, response []byte) (*domain.User, error) {
	data, owner, ok := s.takeCeremony(ctx, sessionID, kindPasskeySignIn)
	if !ok {
		return nil, ErrPasskeySession
	}
	u, err := s.users.ByID(ctx, owner)
	if err != nil {
		return nil, err
	}
	creds, stored, err := s.credentialsFor(ctx, u.ID)
	if err != nil {
		return nil, err
	}

	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPasskeySession, err)
	}
	used, err := s.web.ValidateLogin(webauthnUser{user: u, creds: creds}, data, parsed)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPasskeySession, err)
	}

	// Persist the new signature counter, which guards against cloned authenticators.
	usedID := base64.RawURLEncoding.EncodeToString(used.ID)
	for _, c := range stored {
		if c.CredentialID == usedID {
			now := time.Now()
			c.SignCount = used.Authenticator.SignCount
			c.BackupState = used.Flags.BackupState
			c.LastUsedAt = &now
			if err := s.credentials.Update(ctx, c); err != nil {
				return nil, err
			}
			break
		}
	}
	return u, nil
}

// BeginReauth starts an assertion for a signed-in user who is about to change
// a credential. It proves the person at the keyboard holds the authenticator,
// which a stolen session does not.
func (s *PasskeyService) BeginReauth(ctx context.Context, userID int64) (any, string, error) {
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	creds, _, err := s.credentialsFor(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	if len(creds) == 0 {
		return nil, "", ErrNoPasskeys
	}
	options, sessionData, err := s.web.BeginLogin(webauthnUser{user: u, creds: creds})
	if err != nil {
		return nil, "", err
	}
	id, err := s.putCeremony(ctx, *sessionData, userID, kindPasskeyReauth)
	if err != nil {
		return nil, "", err
	}
	return options, id, nil
}

// FinishReauth validates the assertion. It reports success only when the key
// belongs to the caller, so one account's passkey cannot authorise a change to
// another's.
func (s *PasskeyService) FinishReauth(ctx context.Context, userID int64, sessionID string, response []byte) error {
	data, owner, ok := s.takeCeremony(ctx, sessionID, kindPasskeyReauth)
	if !ok || owner != userID {
		return ErrPasskeySession
	}
	u, err := s.users.ByID(ctx, userID)
	if err != nil {
		return err
	}
	creds, _, err := s.credentialsFor(ctx, userID)
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return ErrPasskeySession
	}
	if _, err := s.web.ValidateLogin(webauthnUser{user: u, creds: creds}, data, parsed); err != nil {
		return ErrPasskeySession
	}
	return nil
}

// List returns a user's enrolled passkeys.
func (s *PasskeyService) List(ctx context.Context, userID int64) ([]*domain.Credential, error) {
	return s.credentials.ListForUser(ctx, userID)
}

// Delete removes one of the user's passkeys.
func (s *PasskeyService) Delete(ctx context.Context, userID, id int64) error {
	return s.credentials.Delete(ctx, userID, id)
}

// encodeCredential converts a library credential into the stored row.
func encodeCredential(c *webauthn.Credential, userID int64, name string) (*domain.Credential, error) {
	transport, err := json.Marshal(c.Transport)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		name = "Passkey"
	}
	name = strings.TrimSpace(name)
	if err := validateName(name); err != nil {
		return nil, err
	}
	return &domain.Credential{
		UserID:          userID,
		Name:            name,
		CredentialID:    base64.RawURLEncoding.EncodeToString(c.ID),
		PublicKey:       base64.RawURLEncoding.EncodeToString(c.PublicKey),
		AttestationType: c.AttestationType,
		Transport:       string(transport),
		AAGUID:          base64.RawURLEncoding.EncodeToString(c.Authenticator.AAGUID),
		SignCount:       c.Authenticator.SignCount,
		BackupEligible:  c.Flags.BackupEligible,
		BackupState:     c.Flags.BackupState,
		CreatedAt:       time.Now(),
	}, nil
}

// decodeCredential converts a stored row back into the library's form.
func decodeCredential(c *domain.Credential) (webauthn.Credential, error) {
	id, err := base64.RawURLEncoding.DecodeString(c.CredentialID)
	if err != nil {
		return webauthn.Credential{}, err
	}
	key, err := base64.RawURLEncoding.DecodeString(c.PublicKey)
	if err != nil {
		return webauthn.Credential{}, err
	}
	aaguid, err := base64.RawURLEncoding.DecodeString(c.AAGUID)
	if err != nil {
		aaguid = nil
	}
	var transport []protocol.AuthenticatorTransport
	if c.Transport != "" {
		_ = json.Unmarshal([]byte(c.Transport), &transport)
	}
	return webauthn.Credential{
		ID:              id,
		PublicKey:       key,
		AttestationType: c.AttestationType,
		Transport:       transport,
		Flags: webauthn.CredentialFlags{
			BackupEligible: c.BackupEligible,
			BackupState:    c.BackupState,
		},
		Authenticator: webauthn.Authenticator{
			AAGUID:    aaguid,
			SignCount: c.SignCount,
		},
	}, nil
}
