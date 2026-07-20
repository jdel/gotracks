package mail

import (
	"context"

	"github.com/rs/zerolog/log"
)

// logMailer stands in when no provider is configured. It writes the message to
// the log instead of sending it, so local development needs no mail server and
// the reset flow can still be walked end to end.
//
// The body is logged at debug level only: reset links are credentials, and they
// should not sit in an operator's info-level logs by default.
type logMailer struct{}

func (m *logMailer) Name() string { return "log" }

func (m *logMailer) Send(_ context.Context, msg Message) error {
	if err := msg.validate(); err != nil {
		return err
	}
	log.Info().Str("to", msg.To).Str("subject", msg.Subject).
		Msg("mail not sent: no provider configured")
	log.Debug().Str("to", msg.To).Str("body", msg.Text).Msg("mail body")
	return nil
}
