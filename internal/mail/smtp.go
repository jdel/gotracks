package mail

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// smtpMailer sends through a relay with net/smtp.
type smtpMailer struct {
	cfg  Config
	addr string
	// dial is swapped in tests; the real one opens a socket.
	dial func(ctx context.Context, encryption, addr, host string) (*smtp.Client, error)
}

func newSMTP(cfg Config) (*smtpMailer, error) {
	if strings.TrimSpace(cfg.SMTPHost) == "" {
		return nil, fmt.Errorf("mail.smtp.host is required for the smtp provider")
	}
	if cfg.SMTPPort == 0 {
		return nil, fmt.Errorf("mail.smtp.port is required for the smtp provider")
	}
	switch cfg.SMTPEncryption {
	case EncryptionStartTLS, EncryptionTLS, EncryptionNone:
	case "":
		cfg.SMTPEncryption = EncryptionStartTLS
	default:
		return nil, fmt.Errorf("unknown mail.smtp.encryption %q (want starttls, tls or none)",
			cfg.SMTPEncryption)
	}
	return &smtpMailer{
		cfg:  cfg,
		addr: net.JoinHostPort(cfg.SMTPHost, fmt.Sprint(cfg.SMTPPort)),
		dial: dialSMTP,
	}, nil
}

func (m *smtpMailer) Name() string { return "smtp" }

func (m *smtpMailer) Send(ctx context.Context, msg Message) error {
	if err := msg.validate(); err != nil {
		return err
	}

	client, err := m.dial(ctx, m.cfg.SMTPEncryption, m.addr, m.cfg.SMTPHost)
	if err != nil {
		return fmt.Errorf("smtp: connect: %w", err)
	}
	defer client.Close()

	if m.cfg.SMTPUsername != "" {
		// PlainAuth refuses to send credentials over an unencrypted link, so a
		// misconfigured relay fails loudly rather than leaking the password.
		auth := smtp.PlainAuth("", m.cfg.SMTPUsername, m.cfg.SMTPPassword, m.cfg.SMTPHost)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp: auth: %w", err)
		}
	}
	if err := client.Mail(m.cfg.FromAddress); err != nil {
		return fmt.Errorf("smtp: from: %w", err)
	}
	if err := client.Rcpt(msg.To); err != nil {
		return fmt.Errorf("smtp: recipient: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp: data: %w", err)
	}
	if _, err := w.Write([]byte(buildMIME(m.cfg, msg.Subject, msg.Text, msg.HTML, time.Now()))); err != nil {
		return fmt.Errorf("smtp: write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp: close: %w", err)
	}
	return client.Quit()
}

func dialSMTP(ctx context.Context, encryption, addr, host string) (*smtp.Client, error) {
	d := &net.Dialer{Timeout: 10 * time.Second}

	if encryption == EncryptionTLS {
		conn, err := tls.DialWithDialer(d, "tcp", addr, &tls.Config{ServerName: host})
		if err != nil {
			return nil, err
		}
		return smtp.NewClient(conn, host)
	}

	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return nil, err
	}
	if encryption == EncryptionStartTLS {
		if err := client.StartTLS(&tls.Config{ServerName: host}); err != nil {
			client.Close()
			return nil, err
		}
	}
	return client, nil
}

// buildMIME renders the RFC 5322 message.
//
// Kept separate from the conversation so it can be asserted on directly: header
// encoding and the multipart boundary are the parts most likely to be wrong,
// and they are invisible from the outside of a Send.
func buildMIME(cfg Config, subject, text, html string, now time.Time) string {
	var b strings.Builder

	// Q-encoded, so a subject with an accent survives every client.
	b.WriteString("From: " + cfg.From() + "\r\n")
	// The real destination belongs to the SMTP envelope (client.Rcpt), not the
	// message content. Keeping user-controlled account data out of the MIME
	// headers removes the header-injection surface entirely.
	b.WriteString("To: undisclosed-recipients:;\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n")
	b.WriteString("Date: " + now.Format(time.RFC1123Z) + "\r\n")
	// A message with no Message-ID scores against itself with every mainstream
	// spam filter, and some relays reject one outright. It also gives the
	// sending domain's logs and the recipient's headers a common identifier
	// when a user reports that a reset link never arrived.
	b.WriteString("Message-ID: " + messageID(cfg.FromAddress) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	// Transactional mail: tells well-behaved autoresponders not to reply.
	b.WriteString("Auto-Submitted: auto-generated\r\n")

	if html == "" {
		b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
		b.WriteString(text)
		return b.String()
	}

	boundary := randomBoundary()
	b.WriteString("Content-Type: multipart/alternative; boundary=" + boundary + "\r\n\r\n")
	// Plain text first: in multipart/alternative the last part wins, so the
	// HTML has to come second for clients that can show it.
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(text + "\r\n")
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=utf-8\r\n\r\n")
	b.WriteString(html + "\r\n")
	b.WriteString("--" + boundary + "--\r\n")
	return b.String()
}

// messageID builds a globally unique identifier for one message.
//
// The right-hand side is the sending domain, which is what DMARC alignment and
// most reputation systems expect to see; a mismatch there is itself a spam
// signal. The sender is already validated as an address, so the split is safe.
func messageID(from string) string {
	domain := "localhost"
	if at := strings.LastIndex(from, "@"); at >= 0 && at < len(from)-1 {
		domain = from[at+1:]
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// Uniqueness is what matters, and the clock still supplies it. A
		// duplicate id can make a relay treat the second message as one it has
		// already delivered.
		return fmt.Sprintf("<%d.gotracks@%s>", time.Now().UnixNano(), domain)
	}
	return fmt.Sprintf("<%s.gotracks@%s>", hex.EncodeToString(buf), domain)
}

func randomBoundary() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// A predictable boundary is only a problem if it appears in the body,
		// which our own templates never do.
		return "gotracks-boundary"
	}
	return hex.EncodeToString(buf)
}
