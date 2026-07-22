package mail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testConfig(provider string) Config {
	return Config{
		Provider:         provider,
		FromAddress:      "tracks@example.com",
		FromName:         "gotracks",
		SMTPHost:         "localhost",
		SMTPPort:         587,
		MailjetAPIKey:    "public-key",
		MailjetSecretKey: "private-key",
		ResendAPIKey:     "re_test",
	}
}

var testMessage = Message{
	To:      "alice@example.com",
	Subject: "Reset your password",
	Text:    "Open this link to reset: https://example.com/r/abc",
	HTML:    `<p>Open <a href="https://example.com/r/abc">this link</a>.</p>`,
}

func TestNewSelectsProvider(t *testing.T) {
	for provider, want := range map[string]string{
		"":        "log",
		"none":    "log",
		"smtp":    "smtp",
		"mailjet": "mailjet",
		"resend":  "resend",
	} {
		m, err := New(testConfig(provider))
		if err != nil {
			t.Fatalf("New(%q): %v", provider, err)
		}
		if m.Name() != want {
			t.Errorf("New(%q).Name() = %q, want %q", provider, m.Name(), want)
		}
	}
}

func TestNewRejectsBadConfiguration(t *testing.T) {
	cases := map[string]func(*Config){
		"unknown provider":      func(c *Config) { c.Provider = "carrier-pigeon" },
		"missing from address":  func(c *Config) { c.FromAddress = "" },
		"invalid from address":  func(c *Config) { c.FromAddress = "not-an-address" },
		"from header injection": func(c *Config) { c.FromName = "gotracks\r\nBcc: attacker@example.com" },
		"smtp without host":     func(c *Config) { c.Provider = "smtp"; c.SMTPHost = "" },
		"smtp without port":     func(c *Config) { c.Provider = "smtp"; c.SMTPPort = 0 },
		"smtp bad encryption":   func(c *Config) { c.Provider = "smtp"; c.SMTPEncryption = "rot13" },
		"resend without key":    func(c *Config) { c.Provider = "resend"; c.ResendAPIKey = "" },
		"mailjet without key":   func(c *Config) { c.Provider = "mailjet"; c.MailjetAPIKey = "" },
		"mailjet without sec":   func(c *Config) { c.Provider = "mailjet"; c.MailjetSecretKey = "" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cfg := testConfig("smtp")
			mutate(&cfg)
			if _, err := New(cfg); err == nil {
				t.Error("configuration was accepted, want an error naming the setting")
			}
		})
	}
}

// Disabling mail must not require every caller to nil-check.
func TestDisabledMailerAcceptsMessages(t *testing.T) {
	m, err := New(Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Send(context.Background(), testMessage); err != nil {
		t.Fatalf("the log mailer refused a message: %v", err)
	}
}

func TestMessageValidation(t *testing.T) {
	m, _ := New(Config{})
	cases := map[string]Message{
		"no recipient":      {Subject: "s", Text: "t"},
		"invalid recipient": {To: "not-an-address", Subject: "s", Text: "t"},
		"recipient header":  {To: "a@example.com\r\nBcc: attacker@example.com", Subject: "s", Text: "t"},
		"recipient display": {To: "Alice <a@example.com>", Subject: "s", Text: "t"},
		"no subject":        {To: "a@example.com", Text: "t"},
		"subject header":    {To: "a@example.com", Subject: "hello\r\nBcc: attacker@example.com", Text: "t"},
		"no text body":      {To: "a@example.com", Subject: "s", HTML: "<p>x</p>"},
	}
	for name, msg := range cases {
		t.Run(name, func(t *testing.T) {
			if err := m.Send(context.Background(), msg); err == nil {
				t.Error("message was accepted, want an error")
			}
		})
	}
}

// The exact field names are what the provider contract turns on: a wrong one
// is accepted by the compiler and rejected at runtime, in production.
func TestResendRequestShape(t *testing.T) {
	var gotAuth string
	var body resendRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"abc"}`))
	}))
	defer srv.Close()

	m, err := newResend(testConfig("resend"))
	if err != nil {
		t.Fatal(err)
	}
	m.endpoint = srv.URL
	if err := m.Send(context.Background(), testMessage); err != nil {
		t.Fatalf("send: %v", err)
	}

	if gotAuth != "Bearer re_test" {
		t.Errorf("Authorization = %q, want a bearer token", gotAuth)
	}
	if body.From != `"gotracks" <tracks@example.com>` {
		t.Errorf("from = %q, want the display-name form", body.From)
	}
	if len(body.To) != 1 || body.To[0] != testMessage.To {
		t.Errorf("to = %v, want [%q]", body.To, testMessage.To)
	}
	if body.Subject != testMessage.Subject || body.Text != testMessage.Text || body.HTML != testMessage.HTML {
		t.Errorf("body did not round-trip: %+v", body)
	}
}

func TestMailjetRequestShape(t *testing.T) {
	var user, pass string
	var ok bool
	var body mailjetRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok = r.BasicAuth()
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	m, err := newMailjet(testConfig("mailjet"))
	if err != nil {
		t.Fatal(err)
	}
	m.endpoint = srv.URL
	if err := m.Send(context.Background(), testMessage); err != nil {
		t.Fatalf("send: %v", err)
	}

	if !ok || user != "public-key" || pass != "private-key" {
		t.Errorf("basic auth = %q/%q (ok=%v), want the key pair", user, pass, ok)
	}
	// v3.1 always takes a collection, even for a single message.
	if len(body.Messages) != 1 {
		t.Fatalf("Messages had %d entries, want 1", len(body.Messages))
	}
	got := body.Messages[0]
	if got.From.Email != "tracks@example.com" || got.From.Name != "gotracks" {
		t.Errorf("From = %+v", got.From)
	}
	if len(got.To) != 1 || got.To[0].Email != testMessage.To {
		t.Errorf("To = %+v", got.To)
	}
	if got.Subject != testMessage.Subject || got.TextPart != testMessage.Text || got.HTMLPart != testMessage.HTML {
		t.Errorf("body did not round-trip: %+v", got)
	}
}

// A provider that refuses must surface its own explanation, or a bad API key
// is indistinguishable from a bug here.
func TestAPIErrorCarriesTheProviderMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"API key is invalid"}`))
	}))
	defer srv.Close()

	m, _ := newResend(testConfig("resend"))
	m.endpoint = srv.URL
	err := m.Send(context.Background(), testMessage)
	if err == nil {
		t.Fatal("a 401 was treated as success")
	}
	if !strings.Contains(err.Error(), "API key is invalid") {
		t.Errorf("error does not carry the provider's message: %v", err)
	}
	if !strings.Contains(err.Error(), "resend") {
		t.Errorf("error does not name the provider: %v", err)
	}
}

func TestMIMEStructure(t *testing.T) {
	cfg := testConfig("smtp")
	out := buildMIME(cfg, testMessage.Subject, testMessage.Text, testMessage.HTML,
		time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC))

	for _, want := range []string{
		"From: \"gotracks\" <tracks@example.com>",
		"To: undisclosed-recipients:;",
		"Subject: Reset your password",
		"MIME-Version: 1.0",
		"Auto-Submitted: auto-generated",
		"multipart/alternative",
		"text/plain; charset=utf-8",
		"text/html; charset=utf-8",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("message is missing %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, testMessage.To) {
		t.Error("the untrusted envelope recipient was copied into the MIME content")
	}
	// Plain text must come first: the last part of a multipart/alternative
	// wins, so HTML has to be second.
	if strings.Index(out, "text/plain") > strings.Index(out, "text/html") {
		t.Error("html part precedes the plain-text part")
	}
	if !strings.HasSuffix(strings.TrimSpace(out), "--") {
		t.Error("the multipart body is not closed")
	}
}

// A non-ASCII subject has to be encoded, or clients show mojibake.
func TestMIMEEncodesUnicodeSubject(t *testing.T) {
	msg := testMessage
	msg.Subject = "Réinitialisez votre mot de passe"
	out := buildMIME(testConfig("smtp"), msg.Subject, msg.Text, msg.HTML, time.Now())

	if strings.Contains(out, "Réinitialisez") {
		t.Error("the subject was written raw rather than encoded")
	}
	if !strings.Contains(out, "=?utf-8?q?") {
		t.Errorf("no Q-encoded subject found:\n%s", out)
	}
}

// Without HTML the message is a plain single part, not an empty multipart.
func TestMIMETextOnly(t *testing.T) {
	msg := testMessage
	msg.HTML = ""
	out := buildMIME(testConfig("smtp"), msg.Subject, msg.Text, msg.HTML, time.Now())

	if strings.Contains(out, "multipart") {
		t.Error("a text-only message was wrapped in multipart")
	}
	if !strings.Contains(out, "Content-Type: text/plain; charset=utf-8") {
		t.Error("missing the plain-text content type")
	}
}
