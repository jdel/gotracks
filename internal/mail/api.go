package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// apiTimeout bounds a provider call. A password reset waits on this, so it is
// short enough that a wedged provider does not hold the request open.
const apiTimeout = 15 * time.Second

func newAPIClient() *http.Client { return &http.Client{Timeout: apiTimeout} }

// postJSON sends a request and turns a non-2xx into an error carrying the
// provider's own message, which is what makes a misconfigured key debuggable.
func postJSON(ctx context.Context, client *http.Client, provider, url string, body any, auth func(*http.Request)) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("%s: encode: %w", provider, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("%s: request: %w", provider, err)
	}
	req.Header.Set("Content-Type", "application/json")
	auth(req)

	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%s: send: %w", provider, err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode > 299 {
		// Bounded: a provider erroring with a large body must not end up
		// wholesale in the logs.
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("%s: refused with %s: %s",
			provider, res.Status, strings.TrimSpace(string(detail)))
	}
	// Drain so the connection can be reused.
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	return nil
}

// --- Resend -----------------------------------------------------------------

// resendMailer posts to https://api.resend.com/emails with a bearer token.
type resendMailer struct {
	cfg      Config
	client   *http.Client
	endpoint string
}

func newResend(cfg Config) (*resendMailer, error) {
	if strings.TrimSpace(cfg.ResendAPIKey) == "" {
		return nil, fmt.Errorf("mail.resend.api-key is required for the resend provider")
	}
	return &resendMailer{
		cfg:      cfg,
		client:   newAPIClient(),
		endpoint: "https://api.resend.com/emails",
	}, nil
}

func (m *resendMailer) Name() string { return "resend" }

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	Text    string   `json:"text,omitempty"`
	HTML    string   `json:"html,omitempty"`
}

func (m *resendMailer) Send(ctx context.Context, msg Message) error {
	if err := msg.validate(); err != nil {
		return err
	}
	body := resendRequest{
		From:    m.cfg.From(),
		To:      []string{msg.To},
		Subject: msg.Subject,
		Text:    msg.Text,
		HTML:    msg.HTML,
	}
	return postJSON(ctx, m.client, "resend", m.endpoint, body, func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+m.cfg.ResendAPIKey)
	})
}

// --- Mailjet ----------------------------------------------------------------

// mailjetMailer posts to the v3.1 Send API using basic auth, where the username
// is the public key and the password the private one.
type mailjetMailer struct {
	cfg      Config
	client   *http.Client
	endpoint string
}

func newMailjet(cfg Config) (*mailjetMailer, error) {
	if strings.TrimSpace(cfg.MailjetAPIKey) == "" || strings.TrimSpace(cfg.MailjetSecretKey) == "" {
		return nil, fmt.Errorf(
			"mail.mailjet.api-key and mail.mailjet.secret-key are both required for the mailjet provider")
	}
	return &mailjetMailer{
		cfg:      cfg,
		client:   newAPIClient(),
		endpoint: "https://api.mailjet.com/v3.1/send",
	}, nil
}

func (m *mailjetMailer) Name() string { return "mailjet" }

// The v3.1 schema is capitalised and always takes a collection, even for one
// message.
type mailjetAddress struct {
	Email string `json:"Email"`
	Name  string `json:"Name,omitempty"`
}

type mailjetMessage struct {
	From     mailjetAddress   `json:"From"`
	To       []mailjetAddress `json:"To"`
	Subject  string           `json:"Subject"`
	TextPart string           `json:"TextPart,omitempty"`
	HTMLPart string           `json:"HTMLPart,omitempty"`
}

type mailjetRequest struct {
	Messages []mailjetMessage `json:"Messages"`
}

func (m *mailjetMailer) Send(ctx context.Context, msg Message) error {
	if err := msg.validate(); err != nil {
		return err
	}
	body := mailjetRequest{Messages: []mailjetMessage{{
		From:     mailjetAddress{Email: m.cfg.FromAddress, Name: m.cfg.FromName},
		To:       []mailjetAddress{{Email: msg.To}},
		Subject:  msg.Subject,
		TextPart: msg.Text,
		HTMLPart: msg.HTML,
	}}}
	return postJSON(ctx, m.client, "mailjet", m.endpoint, body, func(r *http.Request) {
		r.SetBasicAuth(m.cfg.MailjetAPIKey, m.cfg.MailjetSecretKey)
	})
}
