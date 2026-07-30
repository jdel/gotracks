package api

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/config"
	"github.com/jdel/gotracks/internal/metrics"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// Services bundles the application services the API depends on.
type Services struct {
	Auth        *service.AuthService
	Contexts    *service.ContextService
	Projects    *service.ProjectService
	Todos       *service.TodoService
	Recurring   *service.RecurringService
	Preferences *service.PreferenceService
	Stats       *service.StatsService
	Transfer    *service.TransferService
	Attachments *service.AttachmentService
	Admin       *service.AdminService
	Settings    *service.SettingsService
	Passkeys    *service.PasskeyService
	Quotas      *service.QuotaService
	Reports     *service.UsageReportService
	Email       *service.EmailService
	TwoFactor   *service.TwoFactorService
	Audit       *service.AuditService
	Legal       *service.LegalService
	Tags        repo.TagRepo
	Notes       repo.NoteRepo
	Metrics     *metrics.Recorder
}

// New builds the root HTTP handler: global middleware, API routes and SPA.
func New(cfg *config.Config, tm *auth.TokenManager, svc *Services, staticFS fs.FS) http.Handler {
	mux := http.NewServeMux()

	ah := &authHandler{auth: svc.Auth, twoFactor: svc.TwoFactor, passkeys: svc.Passkeys, email: svc.Email, admin: svc.Admin, quotas: svc.Quotas, legal: svc.Legal, audit: svc.Audit}
	ch := &contextHandler{contexts: svc.Contexts}
	requireAuth := RequireAuth(tm, svc.Auth.CurrentUser)
	limit := func(name string, l *AbuseLimiter, h http.HandlerFunc) http.Handler {
		inner := l.Middleware(h)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			inner.ServeHTTP(rec, r)
			if rec.status == http.StatusTooManyRequests {
				svc.Metrics.RateLimited(name)
			}
		})
	}
	// Costly public routes get both per-client and whole-process budgets. The
	// global limiter below remains a broad safety net for every route.
	registerLimit := NewAbuseLimiter(1.0/60, 3, 10.0/60, 10)
	loginLimit := NewAbuseLimiter(1, 5, 5, 10)
	mailLimit := NewAbuseLimiter(1.0/60, 3, 10.0/60, 10)
	passkeyLimit := NewAbuseLimiter(1, 5, 10, 20)

	// Health check (public).
	mh := &metaHandler{
		settings: svc.Settings, auth: svc.Auth,
		passkeys: svc.Passkeys != nil, twoFactor: svc.TwoFactor != nil,
		legal: svc.Legal != nil, version: cfg.Version,
	}
	mux.HandleFunc("GET /healthz", mh.healthz)
	// The build is shown in the shell, so it is read by signed-in clients only.
	mux.Handle("GET /api/v1/version", requireAuth(http.HandlerFunc(mh.buildVersion)))

	// Swagger UI + spec at /doc, behind auth (see swaggerHandlers).
	swaggerHandlers(mux, cfg.TLSEnabled(), requireAuth)

	// Auth endpoints (public).
	mux.Handle("POST /api/v1/auth/register", limit("register", registerLimit, ah.register))
	mux.Handle("POST /api/v1/auth/login", limit("login", loginLimit, ah.login))
	mux.HandleFunc("POST /api/v1/auth/refresh", ah.refresh)
	mux.HandleFunc("POST /api/v1/auth/logout", ah.logout)
	// Completes a sign-in that stopped at the second factor. Public: the
	// caller has proven a password but holds no access token yet.
	mux.HandleFunc("POST /api/v1/auth/2fa/verify", ah.verifyTwoFactor)
	// Address verification, invitations and password reset, all public: the
	// caller is holding a mailed token, not a session.
	if svc.Email != nil {
		mux.HandleFunc("POST /api/v1/auth/email/verify", ah.verifyEmail)
		mux.Handle("POST /api/v1/auth/email/resend", limit("mail", mailLimit, ah.resendVerification))
		mux.HandleFunc("POST /api/v1/auth/email/change/confirm", ah.confirmEmailChange)
		mux.Handle("POST /api/v1/auth/password/forgot", limit("mail", mailLimit, ah.forgotPassword))
		mux.HandleFunc("POST /api/v1/auth/password/reset", ah.resetPassword)
		mux.HandleFunc("POST /api/v1/auth/invitation/accept", ah.acceptInvitation)
		mux.HandleFunc("POST /api/v1/auth/account/deletion/confirm", ah.confirmAccountDeletion)
	}

	// Current user (protected).
	mux.Handle("GET /api/v1/me", requireAuth(http.HandlerFunc(ah.me)))
	mux.Handle("GET /api/v1/usage", requireAuth(http.HandlerFunc(ah.usage)))
	mux.Handle("POST /api/v1/me/password", requireAuth(http.HandlerFunc(ah.changePassword)))
	mux.Handle("POST /api/v1/me/email-change", requireAuth(http.HandlerFunc(ah.requestEmailChange)))
	mux.Handle("POST /api/v1/me/reauth/passkey/begin", requireAuth(http.HandlerFunc(ah.reauthPasskeyBegin)))
	mux.Handle("POST /api/v1/me/deletion", requireAuth(http.HandlerFunc(ah.requestAccountDeletion)))

	sesh := &sessionHandler{auth: svc.Auth, audit: svc.Audit}
	mux.Handle("GET /api/v1/me/sessions", requireAuth(http.HandlerFunc(sesh.list)))
	mux.Handle("DELETE /api/v1/me/sessions", requireAuth(http.HandlerFunc(sesh.revokeOthers)))
	mux.Handle("DELETE /api/v1/me/sessions/{id}", requireAuth(http.HandlerFunc(sesh.revoke)))

	// Context endpoints (protected).
	protect := func(h http.HandlerFunc) http.Handler { return requireAuth(h) }
	mux.Handle("GET /api/v1/contexts", protect(ch.list))
	mux.Handle("POST /api/v1/contexts", protect(ch.create))
	mux.Handle("GET /api/v1/contexts/{id}", protect(ch.get))
	mux.Handle("PUT /api/v1/contexts/{id}", protect(ch.update))
	mux.Handle("DELETE /api/v1/contexts/{id}", protect(ch.delete))

	// Project endpoints (protected).
	ph := &projectHandler{projects: svc.Projects}
	mux.Handle("GET /api/v1/projects", protect(ph.list))
	mux.Handle("POST /api/v1/projects", protect(ph.create))
	mux.Handle("GET /api/v1/projects/{id}", protect(ph.get))
	mux.Handle("PUT /api/v1/projects/{id}", protect(ph.update))
	mux.Handle("POST /api/v1/projects/{id}/review", protect(ph.review))
	mux.Handle("DELETE /api/v1/projects/{id}", protect(ph.delete))

	// Todo endpoints (protected).
	th := &todoHandler{todos: svc.Todos}
	mux.Handle("GET /api/v1/todos", protect(th.list))
	mux.Handle("POST /api/v1/todos", protect(th.create))
	mux.Handle("GET /api/v1/todos/{id}", protect(th.get))
	mux.Handle("PUT /api/v1/todos/{id}", protect(th.update))
	mux.Handle("POST /api/v1/todos/{id}/complete", protect(th.complete))
	mux.Handle("POST /api/v1/todos/{id}/reactivate", protect(th.reactivate))
	mux.Handle("POST /api/v1/todos/{id}/reorder", protect(th.reorder))
	mux.Handle("DELETE /api/v1/todos/{id}", protect(th.delete))

	// Recurring todo endpoints (protected).
	rh := &recurringHandler{recurring: svc.Recurring}
	mux.Handle("GET /api/v1/recurring", protect(rh.list))
	mux.Handle("POST /api/v1/recurring", protect(rh.create))
	mux.Handle("GET /api/v1/recurring/{id}", protect(rh.get))
	mux.Handle("PUT /api/v1/recurring/{id}", protect(rh.update))
	mux.Handle("DELETE /api/v1/recurring/{id}", protect(rh.delete))

	// Tag + note endpoints (protected).
	tgh := &tagHandler{tags: svc.Tags}
	mux.Handle("GET /api/v1/tags", protect(tgh.list))
	nh := &noteHandler{notes: svc.Notes, projects: svc.Projects, quotas: svc.Quotas}
	mux.Handle("GET /api/v1/notes", protect(nh.list))
	mux.Handle("POST /api/v1/notes", protect(nh.create))
	mux.Handle("PUT /api/v1/notes/{id}", protect(nh.update))
	mux.Handle("DELETE /api/v1/notes/{id}", protect(nh.delete))

	// Preferences, stats and export (protected).
	prh := &preferenceHandler{prefs: svc.Preferences}
	mux.Handle("GET /api/v1/preferences", protect(prh.get))
	mux.Handle("PUT /api/v1/preferences", protect(prh.update))

	sh := &statsHandler{stats: svc.Stats}
	mux.Handle("GET /api/v1/stats", protect(sh.get))

	trh := &transferHandler{transfer: svc.Transfer}
	mux.Handle("GET /api/v1/export", protect(trh.export))

	// Attachments (protected).
	atth := &attachmentHandler{attachments: svc.Attachments}
	mux.Handle("GET /api/v1/todos/{id}/attachments", protect(atth.list))
	mux.Handle("POST /api/v1/todos/{id}/attachments", protect(atth.upload))
	mux.Handle("GET /api/v1/attachments", protect(atth.listAll))
	mux.Handle("GET /api/v1/attachments/{id}", protect(atth.download))
	mux.Handle("DELETE /api/v1/attachments/{id}", protect(atth.delete))

	// Admin (protected + admin-only).
	adminOnly := func(h http.HandlerFunc) http.Handler { return requireAuth(RequireAdmin(h)) }
	adh := &adminHandler{admin: svc.Admin, settings: svc.Settings, twoFactor: svc.TwoFactor, quotas: svc.Quotas, reports: svc.Reports, email: svc.Email, audit: svc.Audit}
	mux.Handle("GET /api/v1/admin/users", adminOnly(adh.listUsers))
	mux.Handle("POST /api/v1/admin/users", adminOnly(adh.createUser))
	mux.Handle("PUT /api/v1/admin/users/{id}", adminOnly(adh.updateUser))
	mux.Handle("DELETE /api/v1/admin/users/{id}", adminOnly(adh.deleteUser))
	mux.Handle("POST /api/v1/admin/users/{id}/2fa/reset", adminOnly(adh.resetTwoFactor))
	mux.Handle("POST /api/v1/admin/users/{id}/invitation", adminOnly(adh.resendInvitation))
	mux.Handle("GET /api/v1/admin/users/{id}/usage", adminOnly(adh.usage))
	// The instance-wide report: served from the periodically rebuilt table,
	// and rebuildable on demand.
	mux.Handle("GET /api/v1/admin/reports/usage", adminOnly(adh.usageReport))
	mux.Handle("POST /api/v1/admin/reports/usage/run", adminOnly(adh.runUsageReport))
	if svc.Audit != nil {
		auh := &auditHandler{audit: svc.Audit}
		mux.Handle("GET /api/v1/admin/audit", adminOnly(auh.list))
		mux.Handle("GET /api/v1/admin/audit/actions", adminOnly(auh.actions))
		mux.Handle("GET /api/v1/admin/audit/export", adminOnly(auh.export))
	}

	mux.Handle("GET /api/v1/admin/settings", adminOnly(adh.getSettings))
	mux.Handle("PUT /api/v1/admin/settings", adminOnly(adh.updateSettings))

	// Legal documents. Reading is public because the pages have to render
	// before an account exists; writing is administrator-only.
	if svc.Legal != nil {
		lh := &legalHandler{legal: svc.Legal, prefs: svc.Preferences, audit: svc.Audit}
		mux.HandleFunc("GET /api/v1/legal", lh.get)
		mux.Handle("GET /api/v1/admin/legal", adminOnly(lh.editor))
		mux.Handle("PUT /api/v1/admin/legal/{locale}/{kind}", adminOnly(lh.update))
		mux.Handle("DELETE /api/v1/admin/legal/{locale}/{kind}", adminOnly(lh.reset))
	}

	// Passkeys (WebAuthn). Enrolment is per user and self-service.
	pkh := &passkeyHandler{passkeys: svc.Passkeys, auth: svc.Auth, audit: svc.Audit}
	mux.HandleFunc("GET /api/v1/auth/passkey/status", pkh.status)
	if pkh.enabled() {
		mux.Handle("POST /api/v1/auth/passkey/login/begin", limit("passkey", passkeyLimit, pkh.loginBegin))
		mux.HandleFunc("POST /api/v1/auth/passkey/login/finish", pkh.loginFinish)
		mux.Handle("GET /api/v1/passkeys", protect(pkh.list))
		mux.Handle("POST /api/v1/passkeys/register/begin", protect(pkh.registerBegin))
		mux.Handle("POST /api/v1/passkeys/register/finish", protect(pkh.registerFinish))
		mux.Handle("DELETE /api/v1/passkeys/{id}", protect(pkh.delete))
	}

	// Two-factor enrolment and management (protected, self-service).
	tfh := &twoFactorHandler{twoFactor: svc.TwoFactor, auth: svc.Auth, audit: svc.Audit}
	mux.Handle("GET /api/v1/2fa", protect(tfh.status))
	mux.Handle("POST /api/v1/2fa/enrol/begin", protect(tfh.enrolBegin))
	mux.Handle("POST /api/v1/2fa/enrol/finish", protect(tfh.enrolFinish))
	mux.Handle("POST /api/v1/2fa/recovery/regenerate", protect(tfh.regenerate))
	mux.Handle("POST /api/v1/2fa/disable", protect(tfh.disable))

	// Public capabilities, so the sign-in page knows what to offer.
	mux.HandleFunc("GET /api/v1/config", mh.config)

	// SPA fallback for everything else.
	if staticFS != nil {
		mux.Handle("/", spaHandler(staticFS))
	}

	rl := NewRateLimiter(cfg.RateLimitRPS, cfg.RateLimitBurst)
	return Chain(mux,
		Recover,
		RequestID,
		// Before Logger and the limiter: both read the address it resolves.
		RealIP(cfg.TrustedProxies),
		// After RealIP, so a new or refreshed session records the resolved
		// address rather than a proxy's.
		sessionMeta,
		Logger,
		SecurityHeaders(cfg.HSTSEnabled()),
		CORS(cfg.AllowedOrigins),
		rl.Middleware,
	)
}

// spaHandler serves static files, falling back to index.html for client routes.
func spaHandler(staticFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(staticFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// An unmatched /api/ path is a real 404, not a client route. Without
		// this it would fall through to index.html and answer 200 text/html —
		// a client hitting a typo'd or removed endpoint would parse the SPA as
		// if it were the JSON it asked for.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		if _, err := fs.Stat(staticFS, cleanPath(r.URL.Path)); err != nil {
			// Not a real file: serve the SPA entrypoint.
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		// Build output under /assets/ carries a content hash in its name, so a
		// changed file is a changed URL and the old one can be cached forever.
		// index.html has a stable name and must never be, or an upgrade would
		// keep serving the previous bundle.
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	})
}

// cleanPath maps a URL path to an fs path (fs.FS uses no leading slash).
func cleanPath(p string) string {
	if p == "/" || p == "" {
		return "index.html"
	}
	return p[1:]
}
