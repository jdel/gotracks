// Package mail sends transactional email through one of several providers.
//
// Everything above this package works with the Mailer interface, so the reset
// and verification flows are written once and the choice of provider is a
// configuration detail. Providers differ only in transport: an SMTP
// conversation, or a JSON POST to a vendor API.
package mail

import (
	"context"
	"fmt"
	"net/mail"
	"strings"
)

// Message is one transactional email.
//
// Both a plain-text and an HTML body are always sent. Text is not optional:
// some clients prefer it, and a mail with no text part is more likely to be
// treated as spam.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Mailer delivers a message.
type Mailer interface {
	Send(ctx context.Context, m Message) error
	// Name identifies the provider, for logging and the health endpoint.
	Name() string
}

// SMTP encryption modes.
const (
	// EncryptionStartTLS upgrades a plain connection, which is what port 587
	// expects and what most providers document.
	EncryptionStartTLS = "starttls"
	// EncryptionTLS dials TLS directly, for port 465.
	EncryptionTLS = "tls"
	// EncryptionNone is plaintext, only sensible for a local relay.
	EncryptionNone = "none"
)

// Config selects and configures a provider.
type Config struct {
	// Provider is "smtp", "mailjet", "resend", or empty to disable sending.
	Provider string

	// FromAddress is the envelope sender. Required unless disabled.
	FromAddress string
	FromName    string

	SMTPHost       string
	SMTPPort       int
	SMTPUsername   string
	SMTPPassword   string
	SMTPEncryption string

	MailjetAPIKey    string
	MailjetSecretKey string

	ResendAPIKey string
}

// Enabled reports whether a provider is configured.
func (c Config) Enabled() bool { return c.Provider != "" && c.Provider != "none" }

// From renders the sender as an RFC 5322 address, with the display name when
// one is set.
func (c Config) From() string {
	addr := mail.Address{Name: c.FromName, Address: c.FromAddress}
	return addr.String()
}

// New builds the configured Mailer.
//
// With no provider it returns a mailer that logs instead of sending, so
// development and tests need no mail server and every caller can assume a
// non-nil Mailer. Callers that must know whether mail can really be delivered
// ask Config.Enabled — verification is switched off when it cannot.
func New(cfg Config) (Mailer, error) {
	if !cfg.Enabled() {
		return &logMailer{}, nil
	}
	cfg.FromAddress = strings.TrimSpace(cfg.FromAddress)
	if err := validateAddress(cfg.FromAddress); err != nil {
		return nil, fmt.Errorf("mail.from: %w", err)
	}
	if err := validateHeaderValue(cfg.FromName); err != nil {
		return nil, fmt.Errorf("mail.from-name: %w", err)
	}

	switch strings.ToLower(cfg.Provider) {
	case "smtp":
		return newSMTP(cfg)
	case "mailjet":
		return newMailjet(cfg)
	case "resend":
		return newResend(cfg)
	default:
		return nil, fmt.Errorf("unknown mail provider %q (want smtp, mailjet or resend)", cfg.Provider)
	}
}

func validateAddress(addr string) error {
	if strings.TrimSpace(addr) == "" {
		return fmt.Errorf("is required when a mail provider is configured")
	}
	parsed, err := mail.ParseAddress(addr)
	if err != nil || parsed.Address != addr {
		return fmt.Errorf("%q is not a valid address", addr)
	}
	return nil
}

// validateHeaderValue rejects every ASCII control character. Newlines enable
// injected headers; the remaining controls have no legitimate place in a
// subject or display name and can be interpreted inconsistently by relays.
func validateHeaderValue(value string) error {
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("contains a control character")
		}
	}
	return nil
}

// validate checks a message before any provider touches it, so a missing
// recipient fails the same way everywhere.
func (m Message) validate() error {
	if m.To == "" {
		return fmt.Errorf("mail: no recipient")
	}
	parsed, err := mail.ParseAddress(m.To)
	if err != nil || parsed.Address != m.To {
		return fmt.Errorf("mail: invalid recipient %q", m.To)
	}
	if strings.TrimSpace(m.Subject) == "" {
		return fmt.Errorf("mail: no subject")
	}
	if err := validateHeaderValue(m.Subject); err != nil {
		return fmt.Errorf("mail: invalid subject: %w", err)
	}
	if strings.TrimSpace(m.Text) == "" {
		return fmt.Errorf("mail: no text body")
	}
	return nil
}
