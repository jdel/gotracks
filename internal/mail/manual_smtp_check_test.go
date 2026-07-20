package mail

import (
	"context"
	"net"
	"os"
	"strconv"
	"testing"
)

// Exercises a real SMTP conversation against a local relay. Skipped unless
// MAIL_SMTP_CHECK names one, so the suite needs no network.
func TestSMTPAgainstLocalRelay(t *testing.T) {
	addr := os.Getenv("MAIL_SMTP_CHECK")
	if addr == "" {
		t.Skip("set MAIL_SMTP_CHECK=host:port to run")
	}
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("MAIL_SMTP_CHECK must be host:port: %v", err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("MAIL_SMTP_CHECK port: %v", err)
	}
	m, err := New(Config{
		Provider: "smtp", FromAddress: "tracks@example.com", FromName: "gotracks",
		SMTPHost: host, SMTPPort: port, SMTPEncryption: EncryptionNone,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Send(context.Background(), Message{
		To: "alice@example.com", Subject: "Réinitialisez votre mot de passe",
		Text: "plain body", HTML: "<p>html body</p>",
	}); err != nil {
		t.Fatalf("send: %v", err)
	}
}
