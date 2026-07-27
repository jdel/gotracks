// Package cmd holds the gotracks command tree: configuration, logging and the
// subcommands (serve, where).
package cmd

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	gap "github.com/muesli/go-app-paths"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

var version = "dev"

// SetVersion lets main inject the build version (goreleaser/ldflags).
func SetVersion(v string) { version = v }

// appScope locates gotracks' XDG-compliant config and data directories.
var appScope = gap.NewScope(gap.User, "gotracks")

// dataDir returns the directory for the database and uploads, falling back to
// the working directory when the platform gives us nothing usable.
func dataDir() string {
	dirs, err := appScope.DataDirs()
	if err != nil || len(dirs) == 0 {
		return "."
	}
	return dirs[0]
}

// defaultDatabaseURL points SQLite at the XDG data directory, so an installed
// binary keeps its data somewhere sensible rather than in $PWD.
func defaultDatabaseURL() string {
	return "sqlite:" + filepath.Join(dataDir(), "gotracks.db")
}

func defaultUploadDir() string {
	return filepath.Join(dataDir(), "uploads")
}

// RootCmd builds the top-level cobra command tree with the shared flag set and
// viper bindings used by every subcommand.
func RootCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:           "gotracks",
		Short:         "A GTD web application: actions, contexts, projects and the tickler",
		Version:       version,
		SilenceUsage:  true,
		SilenceErrors: true,
		PersistentPreRunE: func(cmd *cobra.Command, _ []string) error {
			if err := initConfig(); err != nil {
				return err
			}
			warnUnknownEnv(cmd)
			lvl, err := zerolog.ParseLevel(viper.GetString("log-level"))
			if err != nil {
				return err
			}
			zerolog.SetGlobalLevel(lvl)
			return applyLogFormat(viper.GetString("log-format"))
		},
	}

	cmd.PersistentFlags().String("config", "", "config file (yaml/toml/json); auto-discovered if unset")
	cmd.PersistentFlags().String("log-level", "info", "log level (trace, debug, info, warn, error)")
	cmd.PersistentFlags().String("log-format", "text", "log format (text, json)")

	cmd.PersistentFlags().String("db.url", defaultDatabaseURL(), "database URL (sqlite:<path> or postgres://…)")
	cmd.PersistentFlags().Bool("db.debug", false, "log every SQL statement")

	cmd.PersistentFlags().String("auth.jwt-secret", "", "signing key for access tokens (generated at startup if unset)")
	cmd.PersistentFlags().Duration("auth.access-ttl", 15*time.Minute, "access token lifetime")
	cmd.PersistentFlags().Duration("auth.refresh-ttl", 30*24*time.Hour, "refresh token lifetime")
	cmd.PersistentFlags().Bool("auth.allow-register", false, "seed public registration on first run; an admin changes it in the UI afterwards")

	cmd.PersistentFlags().String("http.addr", ":8080",
		"HTTP listen address (host:port; bind 127.0.0.1 to accept only proxied traffic)")
	cmd.PersistentFlags().Float64("http.rate.rps", 20, "per-client request rate")
	cmd.PersistentFlags().Int("http.rate.burst", 40, "per-client burst")

	cmd.PersistentFlags().Bool("http.tls.enabled", false, "serve over HTTPS")
	cmd.PersistentFlags().String("http.tls.cert", "", "TLS certificate file, PEM (required when TLS enabled)")
	cmd.PersistentFlags().String("http.tls.key", "", "TLS private key file, PEM (required when TLS enabled)")

	cmd.PersistentFlags().String("http.public-url", "",
		"externally reachable base URL (e.g. https://tracks.example.com); "+
			"required when mail is enabled, since links in email need it")

	cmd.PersistentFlags().String("http.allowed-origins", "",
		"comma-separated browser origins allowed to call the API (e.g. https://tracks.example.com); "+
			"empty allows any origin, which is fine for a same-origin deployment")

	cmd.PersistentFlags().String("http.trusted-proxies", "",
		"comma-separated CIDRs whose X-Forwarded-For is trusted for rate limiting and logging; "+
			"set this to the reverse proxy's subnet when gotracks runs behind one, "+
			"otherwise every client shares the proxy's bucket")

	cmd.PersistentFlags().String("mail.provider", "",
		"transactional mail provider: smtp, mailjet or resend; empty logs instead of sending")
	cmd.PersistentFlags().String("mail.from", "", "sender address, e.g. tracks@example.com")
	cmd.PersistentFlags().String("mail.from-name", "gotracks", "sender display name")

	cmd.PersistentFlags().String("mail.smtp.host", "", "SMTP relay host")
	cmd.PersistentFlags().Int("mail.smtp.port", 587, "SMTP relay port")
	cmd.PersistentFlags().String("mail.smtp.username", "", "SMTP username")
	cmd.PersistentFlags().String("mail.smtp.password", "", "SMTP password")
	cmd.PersistentFlags().String("mail.smtp.encryption", "starttls",
		"SMTP encryption: starttls (587), tls (465) or none")

	cmd.PersistentFlags().String("mail.mailjet.api-key", "", "Mailjet public API key")
	cmd.PersistentFlags().String("mail.mailjet.secret-key", "", "Mailjet private API key")

	cmd.PersistentFlags().String("mail.resend.api-key", "", "Resend API key")

	cmd.PersistentFlags().Int("quota.storage-mb", 500,
		"per-account attachment allowance in MB (0 = unlimited)")
	cmd.PersistentFlags().Int("quota.todos", 10000, "per-account action limit (0 = unlimited)")
	cmd.PersistentFlags().Int("quota.projects", 1000, "per-account project limit (0 = unlimited)")
	cmd.PersistentFlags().Int("quota.notes", 10000, "per-account note limit (0 = unlimited)")
	cmd.PersistentFlags().Int("quota.contexts", 1000, "per-account context limit (0 = unlimited)")
	cmd.PersistentFlags().Int("quota.tags", 1000, "per-account tag limit (0 = unlimited)")
	cmd.PersistentFlags().Int("quota.recurring", 1000, "per-account recurring-action limit (0 = unlimited)")
	cmd.PersistentFlags().Int("quota.tags-per-todo", 50,
		"tags accepted on a single action (0 = unlimited); tags are created from this "+
			"list, so it is the one limit that bounds a single request")

	// Off by default: a private deployment has nobody to inform, and empty
	// legal pages are worse than none at all.
	cmd.PersistentFlags().Bool("legal.enabled", false,
		"serve the terms, privacy and cookie pages, and the admin screen that edits them")

	cmd.PersistentFlags().Int("legal.retention-days", 90,
		"how long audit entries are kept, in days (0 = forever). Personal data may "+
			"be held no longer than the purpose needs, whatever basis it rests on")

	cmd.PersistentFlags().String("storage.uploads", defaultUploadDir(), "local mode: directory for attachment files")
	cmd.PersistentFlags().Int("storage.max-upload-mb", 10, "per-file upload limit in MB")
	cmd.PersistentFlags().String("storage.type", "local", "attachment store: local (default) or s3 (endpoint and credentials from AWS_* env)")
	cmd.PersistentFlags().String("storage.bucket", "attachments", "bucket attachments live in")

	cmd.PersistentFlags().String("webauthn.rp-id", "", "passkey relying party id (bare domain); defaults to the http.public-url host")
	cmd.PersistentFlags().String("webauthn.rp-origin", "", "passkey origin(s), comma-separated; defaults to the http.public-url origin")
	cmd.PersistentFlags().String("webauthn.rp-name", "gotracks", "name shown in the passkey prompt")

	for _, name := range []string{
		"config", "log-level", "log-format",
		"db.url", "db.debug",
		"auth.jwt-secret", "auth.access-ttl", "auth.refresh-ttl", "auth.allow-register",
		"http.addr", "http.rate.rps", "http.rate.burst", "http.trusted-proxies", "http.allowed-origins", "http.public-url",
		"http.tls.enabled", "http.tls.cert", "http.tls.key",
		"legal.enabled", "legal.retention-days",
		"storage.uploads", "storage.max-upload-mb", "storage.type", "storage.bucket",
		"quota.storage-mb", "quota.todos", "quota.projects", "quota.notes",
		"quota.contexts", "quota.tags", "quota.recurring", "quota.tags-per-todo",
		"mail.provider", "mail.from", "mail.from-name",
		"mail.smtp.host", "mail.smtp.port", "mail.smtp.username", "mail.smtp.password",
		"mail.smtp.encryption",
		"mail.mailjet.api-key", "mail.mailjet.secret-key", "mail.resend.api-key",
		"webauthn.rp-id", "webauthn.rp-origin", "webauthn.rp-name",
	} {
		_ = viper.BindPFlag(name, cmd.PersistentFlags().Lookup(name))
	}

	// Console output until PersistentPreRunE applies the configured format, so
	// anything logged during startup is still readable.
	log.Logger = zerolog.New(
		zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.DateTime},
	).With().Timestamp().Logger()

	cmd.AddCommand(serveCmd())
	cmd.AddCommand(whereCmd())
	return cmd
}

// applyLogFormat switches the global logger between human-readable console
// output and one JSON object per line, the latter being what log shippers want.
func applyLogFormat(format string) error {
	base := zerolog.New(os.Stderr).With().Timestamp().Logger()
	switch format {
	case "text", "console":
		log.Logger = base.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.DateTime})
	case "json":
		log.Logger = base
	default:
		return fmt.Errorf("invalid --log-format %q: want text or json", format)
	}
	return nil
}

// warnUnknownEnv flags GOTRACKS_* variables that match no configuration key.
//
// viper reads the environment lazily, so a typo like GOTRACKS_JWT_SECRET (the
// key is auth.jwt-secret) is simply never looked up — the setting silently keeps
// its default. Naming the near-miss is far more useful than the puzzling
// behaviour that follows.
func warnUnknownEnv(cmd *cobra.Command) {
	known := map[string]string{} // env name -> config key
	cmd.Root().PersistentFlags().VisitAll(func(f *pflag.Flag) {
		env := "GOTRACKS_" + strings.ToUpper(strings.NewReplacer("-", "_", ".", "_").Replace(f.Name))
		known[env] = f.Name
	})

	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if !strings.HasPrefix(name, "GOTRACKS_") {
			continue
		}
		if _, ok := known[name]; ok {
			continue
		}
		event := log.Warn().Str("variable", name)
		if suggestion := closestEnv(name, known); suggestion != "" {
			event = event.Str("did_you_mean", suggestion)
		}
		event.Msg("unknown GOTRACKS_* environment variable, ignored")
	}
}

// closestEnv finds a known variable sharing the same tail, which catches the
// common case of a missing or wrong group prefix.
func closestEnv(name string, known map[string]string) string {
	suffix := strings.TrimPrefix(name, "GOTRACKS_")
	for candidate := range known {
		tail := strings.TrimPrefix(candidate, "GOTRACKS_")
		if tail == suffix || strings.HasSuffix(tail, "_"+suffix) {
			return candidate
		}
	}
	return ""
}

// initConfig loads configuration from a file and the environment.
//
// Resolution order, lowest to highest precedence:
//
//	flag default  <  config file  <  GOTRACKS_* env var  <  explicit flag
//
// If --config is given, that file must exist. Otherwise a file named
// gotracks.{yaml,toml,json} is looked up in the current directory first, then
// in the XDG config dirs — a missing file there is not an error.
//
// Env vars use the GOTRACKS_ prefix with dashes and dots mapped to underscores,
// so --auth.jwt-secret is GOTRACKS_AUTH_JWT_SECRET.
func initConfig() error {
	viper.SetEnvPrefix("GOTRACKS")
	viper.SetEnvKeyReplacer(strings.NewReplacer("-", "_", ".", "_"))
	viper.AutomaticEnv()

	if explicit := viper.GetString("config"); explicit != "" {
		viper.SetConfigFile(explicit)
		return viper.ReadInConfig()
	}

	viper.SetConfigName("gotracks")
	viper.AddConfigPath(".")
	if dirs, err := appScope.ConfigDirs(); err == nil {
		for _, d := range dirs {
			viper.AddConfigPath(d)
		}
	}
	if err := viper.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if errors.As(err, &notFound) {
			return nil
		}
		return err
	}
	return nil
}
