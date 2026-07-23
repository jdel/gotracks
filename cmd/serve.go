package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/jdel/gotracks/internal/api"
	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/config"
	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/mail"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
	"github.com/jdel/gotracks/internal/web"
)

// configFromViper assembles the runtime configuration from the resolved
// flag/file/env values.
func configFromViper() (*config.Config, error) {
	cfg := &config.Config{
		Addr:              viper.GetString("http.addr"),
		DatabaseURL:       viper.GetString("db.url"),
		DBDebug:           viper.GetBool("db.debug"),
		LogLevel:          viper.GetString("log-level"),
		AccessTokenTTL:    viper.GetDuration("auth.access-ttl"),
		RefreshTokenTTL:   viper.GetDuration("auth.refresh-ttl"),
		AllowRegister:     viper.GetBool("auth.allow-register"),
		RateLimitRPS:      viper.GetFloat64("http.rate.rps"),
		RateLimitBurst:    viper.GetInt("http.rate.burst"),
		PublicURL:         strings.TrimRight(viper.GetString("http.public-url"), "/"),
		QuotaStorageBytes: int64(viper.GetInt("quota.storage-mb")) * 1024 * 1024,
		QuotaTodos:        viper.GetInt("quota.todos"),
		QuotaProjects:     viper.GetInt("quota.projects"),
		QuotaNotes:        viper.GetInt("quota.notes"),
		QuotaContexts:     viper.GetInt("quota.contexts"),
		QuotaTags:         viper.GetInt("quota.tags"),
		QuotaRecurring:    viper.GetInt("quota.recurring"),
		QuotaTagsPerTodo:  viper.GetInt("quota.tags-per-todo"),

		UploadDir:      viper.GetString("storage.uploads"),
		MaxUploadBytes: int64(viper.GetInt("storage.max-upload-mb")) * 1024 * 1024,

		RPID:     viper.GetString("webauthn.rp-id"),
		RPOrigin: viper.GetString("webauthn.rp-origin"),
		RPName:   viper.GetString("webauthn.rp-name"),
	}

	for _, o := range strings.Split(viper.GetString("http.allowed-origins"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			cfg.AllowedOrigins = append(cfg.AllowedOrigins, o)
		}
	}

	trusted, err := config.ParseTrustedProxies(viper.GetString("http.trusted-proxies"))
	if err != nil {
		return nil, err
	}
	cfg.TrustedProxies = trusted

	// Passkeys need a relying-party id and origin. Rather than a second copy of
	// the domain, default them from the public URL; the explicit flags stay as
	// overrides. A malformed public URL is surfaced here rather than silently
	// leaving passkeys off.
	if cfg.PublicURL != "" && (cfg.RPID == "" || cfg.RPOrigin == "") {
		id, origin, err := config.WebAuthnFromPublicURL(cfg.PublicURL)
		if err != nil {
			return nil, err
		}
		if cfg.RPID == "" {
			cfg.RPID = id
		}
		if cfg.RPOrigin == "" {
			cfg.RPOrigin = origin
		}
	}

	// TLS is opt-in: the flag turns it on, and both files must be readable at
	// startup rather than failing on the first request.
	if viper.GetBool("http.tls.enabled") {
		cert := viper.GetString("http.tls.cert")
		key := viper.GetString("http.tls.key")
		if cert == "" || key == "" {
			return nil, fmt.Errorf("--http.tls.enabled requires --http.tls.cert and --http.tls.key")
		}
		for _, f := range []string{cert, key} {
			if _, err := os.Stat(f); err != nil {
				return nil, fmt.Errorf("tls: %w", err)
			}
		}
		cfg.TLSCert, cfg.TLSKey = cert, key
	}

	if secret := viper.GetString("auth.jwt-secret"); secret != "" {
		cfg.JWTSecret = []byte(secret)
	} else {
		// Convenient for a first look, but a fresh secret each boot signs
		// everyone out on restart: the secret keys both the access tokens and
		// the stored refresh-token digests.
		generated, err := config.GenerateSecret()
		if err != nil {
			return nil, err
		}
		cfg.JWTSecret = generated
		log.Warn().Msg("no auth.jwt-secret set; generated a temporary one, every restart signs all users out")
	}
	return cfg, nil
}

func serveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Run the API and the web interface",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return serve(cmd.Context())
		},
	}
}

func serve(ctx context.Context) error {
	cfg, err := configFromViper()
	if err != nil {
		return err
	}

	database, err := db.Open(cfg.DatabaseURL, cfg.DBDebug)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := db.Migrate(ctx, database); err != nil {
		return err
	}

	store := repo.NewStore(database)
	tm := auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	settings := service.NewSettingsService(store.Settings, cfg.AllowRegister)

	recurring := service.NewRecurringService(store.Recurring, store.Todos, store.Contexts)
	recurring.SetProjects(store.Projects)
	attachments := service.NewAttachmentService(store.Attachments, store.Todos, cfg.UploadDir, cfg.MaxUploadBytes)
	todos := service.NewTodoService(store.Todos, store.Tags, store.Contexts, recurring)
	todos.SetAttachments(attachments)
	todos.SetProjects(store.Projects)
	prefs := service.NewPreferenceService(store.Preferences)
	todos.SetPreferences(prefs)

	// Per-account limits: on a public service one signup must not be able to
	// fill the disk for everybody.
	quotas := service.NewQuotaService(service.Quotas{
		StorageBytes: cfg.QuotaStorageBytes,
		Todos:        cfg.QuotaTodos,
		Projects:     cfg.QuotaProjects,
		Notes:        cfg.QuotaNotes,
		Contexts:     cfg.QuotaContexts,
		Tags:         cfg.QuotaTags,
		Recurring:    cfg.QuotaRecurring,
		TagsPerTodo:  cfg.QuotaTagsPerTodo,
	}, store)
	todos.SetQuotas(quotas)
	attachments.SetQuotas(quotas)
	recurring.SetQuotas(quotas)

	// Transactional mail. An unconfigured provider yields a mailer that logs
	// instead of sending, so nothing downstream has to nil-check.
	mailer, err := mail.New(mail.Config{
		Provider:         viper.GetString("mail.provider"),
		FromAddress:      viper.GetString("mail.from"),
		FromName:         viper.GetString("mail.from-name"),
		SMTPHost:         viper.GetString("mail.smtp.host"),
		SMTPPort:         viper.GetInt("mail.smtp.port"),
		SMTPUsername:     viper.GetString("mail.smtp.username"),
		SMTPPassword:     viper.GetString("mail.smtp.password"),
		SMTPEncryption:   viper.GetString("mail.smtp.encryption"),
		MailjetAPIKey:    viper.GetString("mail.mailjet.api-key"),
		MailjetSecretKey: viper.GetString("mail.mailjet.secret-key"),
		ResendAPIKey:     viper.GetString("mail.resend.api-key"),
	})
	if err != nil {
		return err
	}
	if mailer.Name() == "log" {
		log.Warn().Msg("no mail provider configured; messages will be logged, not sent")
	} else {
		log.Info().Str("provider", mailer.Name()).Msg("mail enabled")
	}

	// Two-factor authentication is always available; each user opts in.
	twoFactor := service.NewTwoFactorService(store.TwoFactor, store.RecoveryCodes, store.Users, store.Ephemeral, "gotracks")

	// Passkeys stay off unless the relying party is configured; WebAuthn needs a
	// stable domain and a secure origin.
	passkeys, err := service.NewPasskeyService(cfg.RPID, cfg.RPOrigin, cfg.RPName, store.Credentials, store.Users, store.Ephemeral)
	if err != nil {
		log.Error().Err(err).Msg("passkeys disabled: invalid webauthn configuration")
		passkeys = nil
	} else if passkeys != nil {
		log.Info().Str("rpID", cfg.RPID).Str("origin", cfg.RPOrigin).Msg("passkeys enabled")
	}

	projectSvc := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring)
	projectSvc.SetQuotas(quotas)

	contexts := service.NewContextService(store.Contexts, store.Todos, store.Recurring)
	// Deleting a context with its actions goes through the todo service, so
	// tags and attachment files go with them.
	contexts.SetTodos(todos)
	contexts.SetQuotas(quotas)

	// Mail must be able to build absolute links back into the app.
	if mailer.Name() != "log" && cfg.PublicURL == "" {
		return fmt.Errorf("http.public-url is required when a mail provider is configured: " +
			"account email links have nowhere to point")
	}

	authSvc := service.NewAuthService(store.Users, store.RefreshTokens, tm, settings)
	// Per-account lockout on top of the per-IP limiter: one covers bursts from
	// a single source, the other a slow spread across many.
	authSvc.SetLoginAttempts(store.LoginAttempts)
	authSvc.SetPreferences(store.Preferences)

	// The log mailer is a complete development transport: links are printed to
	// the server log instead of delivered, but invitation, verification,
	// email-change, deletion and reset rules behave exactly as they do with a
	// network provider. This keeps local testing representative of production.
	emailSvc := service.NewEmailService(
		store.Users, store.Ephemeral, mailer, authSvc, cfg.PublicURL, true)
	if mailer.Name() == "log" {
		log.Warn().Msg("mail delivery is using the development log backend; message bodies will be written at debug level")
	}

	reports := service.NewUsageReportService(store.UsageReports, settings, service.Quotas{
		StorageBytes: cfg.QuotaStorageBytes,
		Todos:        cfg.QuotaTodos,
		Projects:     cfg.QuotaProjects,
		Notes:        cfg.QuotaNotes,
		Contexts:     cfg.QuotaContexts,
		Tags:         cfg.QuotaTags,
		Recurring:    cfg.QuotaRecurring,
	})
	go reports.Schedule(ctx)

	svc := &api.Services{
		Auth:        authSvc,
		Contexts:    contexts,
		Projects:    projectSvc,
		Todos:       todos,
		Recurring:   recurring,
		Preferences: prefs,
		Stats:       service.NewStatsService(store.Stats, store.Contexts),
		Transfer:    service.NewTransferService(store, todos),
		Attachments: attachments,
		Admin:       service.NewAdminService(store, attachments),
		Settings:    settings,
		Passkeys:    passkeys,
		Quotas:      quotas,
		Reports:     reports,
		Email:       emailSvc,
		TwoFactor:   twoFactor,
		Tags:        store.Tags,
		Notes:       store.Notes,
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.New(cfg, tm, svc, web.FS()),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	scheme := "http"
	if cfg.TLSEnabled() {
		scheme = "https"
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info().Str("addr", cfg.Addr).Str("scheme", scheme).Str("db", cfg.DatabaseURL).Msg("listening")
		var err error
		if cfg.TLSEnabled() {
			err = srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
		} else {
			err = srv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	// Housekeeping: forget quiet lockout records so the table stays small.
	go func() {
		tick := time.NewTicker(time.Hour)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				if err := authSvc.PurgeLoginAttempts(ctx); err != nil {
					log.Warn().Err(err).Msg("could not purge login attempts")
				}
				// Shared sign-in state: expired rows are already invisible to
				// readers, this just stops the table growing. Every instance
				// runs it; the delete is idempotent.
				if err := store.Ephemeral.PurgeExpired(ctx, time.Now()); err != nil {
					log.Warn().Err(err).Msg("could not purge expired sign-in state")
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		return err
	case <-stop:
		log.Info().Msg("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
