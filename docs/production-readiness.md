# Production readiness — public multi-tenant

## Context

gotracks is currently a solid single-tenant self-hosted app. Opening signup to
strangers changes the threat model: every account is a potential attacker, disk
and CPU are shared, and mistakes become other people's data.

This plan is ordered by importance, not by effort. **P0 blocks launch** — each
item is something an attacker or a careless user can exploit within days.
P1 follows within weeks. P2 is scale and operations.

### Already in place — do not redo

argon2id password hashing; rotating refresh tokens, hashed with an HMAC keyed on
the signing secret; opt-in TOTP with recovery codes; passkeys; OIDC; per-IP rate
limiting with correct trusted-proxy handling; upload body caps; delete cascades
with tests; export. **No cookies anywhere** — auth is Bearer-only, so
there is no CSRF surface to defend.

---

## Summary

Status: ✅ done · ◐ partly done · ☐ not started

| # | Area | Effort | Status | Item |
|---|------|--------|--------|------|
| 1 | security | trivial | ✅ | [No password policy at all](#1-password-policy) |
| 2 | security | small | ✅ | [No security headers or CSP](#2-security-headers-and-csp) |
| 3 | security | medium | ✅ | [No login throttling or lockout](#3-login-throttling-and-lockout) |
| 4 | data | small | ✅ | [Email identity](#4-email-identity) |
| 5 | feature | large | ✅ | [Mailer and password reset](#5-mailer-and-password-reset) — code done; **SPF/DKIM/DMARC still yours to do** |
| 6 | abuse | medium | ✅ | [Per-account quotas](#6-per-account-quotas) |
| 7 | ops | medium | ☐ | [SQLite default, no backups](#7-postgres-and-backups) |
| 8 | abuse | medium | ☐ | [Registration is unguarded](#8-registration-abuse-controls) |
| 9 | security | trivial | ☐ | [Registration confirms who exists](#9-account-enumeration) |
| 10 | legal | medium | ☐ | [No self-service account deletion](#10-account-deletion) |
| 11 | legal | small | ☐ | [Export omits attachments](#11-complete-data-export) |
| 12 | security | medium | ☐ | [No audit log](#12-audit-log) |
| 13 | feature | medium | ☐ | [No session management](#13-session-management) |
| 14 | security | trivial | ✅ | [CORS allows every origin](#14-cors) |
| 15 | legal | small | ☐ | [No terms, privacy policy or contact](#15-legal-pages) |
| 16 | scale | large | ✅ | [In-memory state pins you to one process](#16-single-process-state) |
| 17 | ops | medium | ☐ | [No metrics, alerting or error tracking](#17-observability) |
| 18 | ops | medium | ☐ | [Migrations cannot drop or rename](#18-migration-strategy) |
| 19 | perf | trivial | ✅ | [No cache headers on static assets](#19-static-asset-caching) |

---

# P0 — before strangers can sign up

## 1. Password policy

**Now.** `AuthService.Register`, `AdminService.CreateUser` and `ChangePassword`
all accept any non-empty string. `"a"` is a valid password today.

**Why it matters here.** Multi-tenant means one weak account is someone else's
breach, and you carry the reputational cost.

**Do.** A single `auth.ValidatePassword(string) error` called from all three
paths — minimum 10-12 characters, reject the obvious ("password", the login
itself). Length beats composition rules; don't add character-class requirements.
Consider a k-anonymity check against Have I Been Pwned's range API — it is one
HTTPS call and never sends the password or its full hash.

**Verify.** Table test over the three entry points; confirm existing accounts
with short passwords can still sign in (the rule applies on set, not on use).

## 2. Security headers and CSP

**Now.** No `Strict-Transport-Security`, `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, or CSP anywhere in the
middleware chain.

**Why it matters here.** Access and refresh tokens live in `localStorage`
(`ui/src/lib/api.ts`), so **any XSS is full account takeover**, and there is
currently no CSP to make XSS harder. Attachments are user-controlled files
served from the same origin — `Content-Disposition: attachment` is set, which is
the main defence, but there is no `nosniff` behind it.

**Do.** A `SecurityHeaders` middleware beside `CORS` in `internal/api/middleware.go`:

- `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`
  (the SPA is fully self-hosted, so this needs no CDN exceptions — verify no
  inline scripts survive the Vite build)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` only when TLS is terminated (config-gated, or you
  will break plain-HTTP local use)

**Consider.** Moving refresh tokens to `HttpOnly; Secure; SameSite=Strict`
cookies would put them out of XSS reach entirely. That reintroduces CSRF, which
you currently do not have — a real trade, worth doing deliberately rather than
by accident.

**Verify.** `curl -I` every header; confirm the SPA still loads with CSP on
(inline styles from Tailwind are the usual first failure).

## 3. Login throttling and lockout

**Now.** The only defence is the global per-IP limiter (`http.rate.rps`, default
20). There is no per-account attempt counter and no lockout — confirmed absent.
Note the 2FA challenge already burns after 5 wrong codes; the password step has
no equivalent.

**Why it matters here.** Credential stuffing spreads across many IPs and many
accounts, so a per-IP limit barely touches it.

**Do.** Per-account failed-attempt counting with exponential backoff, in the
database rather than memory (see #16), keyed on the login. Cap at, say, 10
failures then require a cooldown. Return the same error and timing as a wrong
password so it cannot be used to probe. Add a stricter per-IP limit on
`/auth/login`, `/auth/register` and the reset endpoints specifically, rather
than relying on the global one.

**Verify.** Script N failed logins, assert lockout; assert a *correct* password
during lockout still fails; assert another account is unaffected.

## 4. Email identity

**Now.** `domain.User.Email` is a plain column — not unique, not verified, and
optional (`internal/domain/models.go`).

**Why it matters here.** This is a **prerequisite for #5**, not a follow-up:
"reset the password for this address" is ambiguous the moment two accounts share
one. It is also how you contact users about security events.

**Done so far.** The username was removed entirely: email is now the sole
identity, `unique, notnull`, normalised lower-case, validated, and folded on
lookup so casing cannot create two accounts for one mailbox.

**Outstanding.** `email_verified_at`, the verification mail, and the decision
already taken that an unverified account **cannot sign in** — which needs two
guards or a deployment bricks itself: the first-run admin account must be
auto-verified (it registers before any mailer exists), and enforcement must be
off entirely when no mail provider is configured.

**Original note.** Unique index on a normalised (lower-cased, trimmed) email; make it
required at registration; add `email_verified_at`. Decide explicitly what an
unverified account cannot do — otherwise verification is decorative. Suggested:
unverified accounts can use the app but cannot request a password reset.

**Note.** `addMissingColumns` adds columns nullable and without defaults, so
backfilling existing rows and *then* applying the unique index is a two-step
migration. See #18.

## 5. Mailer and password reset

**Done so far.** `internal/mail`: one `Mailer` interface with SMTP, Mailjet,
Resend and a logging no-op behind `mail.provider`, no new Go dependencies,
configuration validated at startup. Verified against a real SMTP conversation
and against recorded provider payloads.

**Outstanding.** Everything above the transport: reset tokens, the forgot/reset
endpoints, verification mail, email-change verification, and the UI for each.

**Original note.** There is no mailer at all — no SMTP config, no send path.

**Do.**

1. SMTP config (`mail.host/port/username/password/from`, TLS), a `Mailer`
   interface with an SMTP implementation and a no-op for local development.
2. Reset tokens modelled on the existing `RecoveryCode`: high entropy, **stored
   hashed**, single-use, short TTL (15-30 min), and **revoke all sessions on
   use** — the `replacePassword` path already does this.
3. `POST /auth/password/forgot` must answer identically whether or not the
   address exists.
4. Verification emails on signup and on email change.

**The part that sinks projects.** Deliverability. Without SPF, DKIM and DMARC —
or a provider like Postmark/SES — reset mail lands in spam and users conclude
the service is broken. Budget more time for this than for the code. Handle
bounces and complaints, or sending reputation decays quietly.

**Verify.** End-to-end against a local SMTP catcher (Mailpit): request reset,
consume token, assert it fails on reuse, after expiry, and that sessions died.

## 6. Per-account quotas

**Now.** No quotas of any kind. `storage.max-upload-mb` caps a single file, not
the total. One signup can fill the disk.

**Done.** `quota.storage-mb` (500), `quota.todos` (10000), `quota.projects` and
`quota.notes` (10000); zero means unlimited. Refusals are 409 naming the
limit that was hit. Storage is checked twice — once before the upload is read,
so a hopeless upload is not streamed to disk, and again with the real size,
removing the file if it would not fit.

Usage is summed on demand rather than kept as a counter on the user row: a
counter has to be corrected on every delete and every failed upload, and drifts
silently the first time one is missed.

Contexts (1000), tags (1000) and recurrences (1000) are bounded too, plus
`quota.tags-per-todo` (50) which caps a single request: tags are created from an
action's tag list, so one request could otherwise write thousands of rows while
costing one action against the allowance.

Admins see per-account consumption via `GET /api/v1/admin/users/{id}/usage`,
surfaced as a panel from the user list rather than columns in it.

**Verify.** Upload past the quota, assert refusal and that the partial file is
cleaned up.

## 7. Postgres and backups

**Now.** SQLite is the default (`defaultDatabaseURL()`); Postgres is supported
and already covered by the repo tests when `TRACKS_TEST_PG` is set.

**Why it matters here.** SQLite is single-writer — concurrent users will
serialise on writes — and there is no automated backup anywhere.

**Do.** Run Postgres in production. Automated nightly backups **with a tested
restore** (an untested backup is not a backup). Include the uploads directory:
attachment rows without their files are useless. Document the restore procedure.

## 8. Registration abuse controls

**Now.** `allowRegister` defaults to true and registration is otherwise
unguarded.

**Do.** In order of value: email verification (#5) → per-IP registration rate
limit (#3) → captcha. Captcha is the weakest of the three; it stops naive bots
and little else. Prefer Cloudflare Turnstile or hCaptcha over reCAPTCHA given a
likely EU audience. Add a disposable-domain blocklist if abuse appears — not
before.

## 9. Account enumeration

**Now.** Registering with a taken login returns `409 "login already taken"`, so
the endpoint confirms who has an account. The passkey endpoints are deliberately
anti-enumeration (`ErrNoPasskeys` is identical either way); registration is not.

**Do.** Accept that usernames are semi-public (they must be, to be chosen), but
make **email** non-enumerable everywhere: registration with an existing address
should behave like success and send a "someone tried to register with your
address" mail instead. Reset already must not distinguish (#5).

---

# P1 — within weeks of launch

## 10. Account deletion

**Now.** An admin can delete a user; a user cannot delete themselves.

**Why it matters here.** GDPR erasure, and it is simply expected. The hard work
is already done — `AdminService.DeleteUser` cascades correctly and has a test
that fails loudly when a table is forgotten.

**Do.** `DELETE /api/v1/me` behind password (or passkey) re-authentication,
reusing that cascade. Confirmation dialog with the account name typed out.
Decide on a grace period vs immediate deletion and say which in the privacy
policy.

## 11. Complete data export

**Now.** `Export` covers contexts, projects, todos, recurring, notes and tags —
but **not attachments**, so a user's uploaded files cannot be taken with them.

**Do.** Add a full export including attachment bytes (a zip with the JSON plus
files). Portability is the other half of erasure.

## 12. Audit log

**Now.** Nothing records admin actions. Deleting a user, resetting someone's
2FA, or granting admin leaves only a request log line.

**Do.** An `audit_events` table: actor, action, target, timestamp, source IP.
Record admin actions and security events (password change, 2FA enable/disable,
failed login bursts). Admin-visible, append-only, with a retention policy.

## 13. Session management

**Now.** No way to see or revoke sessions. Refresh tokens last 30 days
(`auth.refresh-ttl`). Sessions are only revoked wholesale, on password change or
admin 2FA reset.

**Do.** A settings section listing active sessions (created, last used, IP,
user-agent — store these on `refresh_tokens`) with per-session revoke and a
"sign out everywhere" button.

## 14. CORS

**Now.** `Access-Control-Allow-Origin: *` (`middleware.go`).

**Why it is not urgent.** No cookies are used and `Allow-Credentials` is unset,
so a foreign origin still needs a stolen Bearer token — at which point it has
what it needs anyway.

**Do.** Restrict to the configured public origin. Cheap, and prevents the
footgun where someone later adds a cookie and inherits a wide-open policy.

## 15. Legal pages

Terms of service, privacy policy (what you store, retention, processors — your
SMTP and captcha vendors are processors), a security contact, and a stated
incident-response expectation. Non-negotiable for holding strangers' data in the
EU.

---

# P2 — scale and operations

## 16. Single-process state

**Done.** The three flows that broke across replicas now share their state
through an `ephemeral` table: OIDC CSRF states, WebAuthn ceremonies, and
two-factor challenges and enrolments. Each is a short-lived token-addressed
row with a TTL, consumed atomically so exactly one instance can redeem a
single-use token however many race for it.

**Still per-instance, on purpose:** the rate-limiter token buckets
(`internal/api/middleware.go:168`). Sharing them would mean a database write on
every request to save a bucket that refills in seconds — a bad trade. The
consequence is that the per-IP limit is effectively multiplied by the instance
count, so divide `http.rate.rps` by the number of replicas if you want it to
mean what it says. The security-critical half, the per-account lockout, was
already in the database and is unaffected.

**The remaining HA requirements are deployment, not code:**

- **Postgres**, not SQLite — see #7. One file with one writer cannot back two
  instances.
- **Shared attachment storage**: a file uploaded on one instance is a 404 on
  another.
- **An explicit `auth.jwt-secret`, identical everywhere.** Left unset each
  instance generates its own, so a token minted by one is rejected by the
  others — and because refresh-token digests are HMAC-keyed with it, refresh
  fails too.


## 17. Observability

**Now.** zerolog only. No metrics, no error tracking, no alerting.

**Do.** Prometheus metrics (request rate/latency/status, signup and login
success/failure counters, queue depths), error tracking (Sentry or similar),
uptime checks against `/healthz`, and alerts on failed-login spikes, 5xx rates
and disk usage. You cannot respond to abuse you cannot see.

## 18. Migration strategy

**Now.** `db.Migrate` creates missing tables and adds missing columns. It never
drops, renames, or backfills, and there is no rollback or version record.

**Why it matters here.** Fine while you are the only user. With real data, the
first rename or `NOT NULL` addition (#4) has no safe path.

**Do.** Adopt versioned migrations (goose/atlas) with a recorded schema version,
keeping the current auto-migrate for local development only. Do this **before**
the schema changes in #4 and #12, not after.

## 19. Static asset caching

**Now.** No `Cache-Control` on embedded assets. Filenames are content-hashed by
Vite, so they are safe to cache immutably.

**Do.** `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`,
`no-cache` for `index.html`.

---

## Suggested order of work

1. **#1, #2, #14, #19** — a day's work between them, and #1/#2 are the
   embarrassing ones to be caught without.
2. **#18** — versioned migrations, before the schema starts moving.
3. **#4, #5** — email identity then the mailer. The long pole; start early
   because deliverability is slow to get right.
4. **#3, #6, #8, #9** — abuse controls, once accounts have real value.
5. **#7** — Postgres and a *tested* restore, before real user data exists.
6. **#10, #11, #12, #13, #15** — the obligations tier.
7. **#16, #17** — when traffic justifies it.

A realistic minimum before opening public signup is items 1-9 plus 15. Items
10-14 can trail by a few weeks if you are candid in the privacy policy about
what is not yet self-service.
