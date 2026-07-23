# gotracks

> **Disclaimer:** These 3 lines are the only thing written by a human on this project
>
> While not an advocate of vibe coding, I wanted to try it on a low risk, low impact project
>
> The process took some trial and error, but ultimately the goal of this app has been reached
>
> Minor improvements might come in later. Feel free to use and self-host

A modern reimplementation of the [Tracks](https://github.com/TracksApp/tracks) GTD web app.

**Actions** organised by **context**, grouped into **projects**, labelled with **tags**,
deferred via the **tickler**, repeated with **recurrence patterns** — plus due dates,
starring and reference **notes**.

- **Backend:** Go (stdlib `net/http`), [bun](https://bun.uptrace.dev/) ORM, JWT auth
- **Frontend:** React + Vite + Tailwind v4 + [shadcn/ui](https://ui.shadcn.com), TanStack Query
- **Database:** SQLite by default, optional external Postgres — same binary
- **Deploy:** single binary with the frontend embedded, or Docker

## Quick start (development)

```bash
# Backend (SQLite in the XDG data dir, verbose logs)
go run . serve --log-level debug          # API on :8080

# Frontend (separate terminal, proxies /api to :8080)
cd ui && npm ci && npm run dev            # UI on :5173
```

Open <http://localhost:5173>. Enroll the first account, then follow the
invitation link written to the backend's debug log; that account becomes the
administrator.

## Production build (single binary)

```bash
make all        # builds the UI, embeds it, builds ./gotracks
GOTRACKS_AUTH_JWT_SECRET=$(openssl rand -hex 32) ./gotracks serve
```

The binary serves both the API and the SPA on `--http.addr` (default `:8080`).
The built SPA is committed, so `go install github.com/jdel/gotracks@latest`
also yields a working binary.

## Commands

```bash
gotracks serve      # run the API and web interface
gotracks where      # show the resolved config file, database and upload paths
gotracks --help     # every flag, with its default
```

## Configuration

Three sources, lowest to highest precedence:

    flag default  <  config file  <  GOTRACKS_* env var  <  explicit flag

The config file is `gotracks.{yaml,toml,json}`, looked up in the working
directory then the XDG config dirs, or given explicitly with `--config`. See
[example/config/gotracks.yaml](example/config/gotracks.yaml).

Every flag has an environment equivalent: the `GOTRACKS_` prefix with dots and
dashes replaced by underscores.

| Flag | Env | Default | Purpose |
|------|-----|---------|---------|
| `--http.addr` | `GOTRACKS_HTTP_ADDR` | `:8080` | HTTP listen address (`host:port`) |
| `--log-level` | `GOTRACKS_LOG_LEVEL` | `info` | trace, debug, info, warn, error |
| `--log-format` | `GOTRACKS_LOG_FORMAT` | `text` | `text` for humans, `json` for log shippers |
| `--db.url` | `GOTRACKS_DB_URL` | XDG data dir | `sqlite:<path>` or `postgres://…` |
| `--db.debug` | `GOTRACKS_DB_DEBUG` | `false` | Log every SQL statement |
| `--auth.jwt-secret` | `GOTRACKS_AUTH_JWT_SECRET` | — | Access-token signing key; generated (temporarily) if unset |
| `--auth.access-ttl` | `GOTRACKS_AUTH_ACCESS_TTL` | `15m` | Access-token lifetime |
| `--auth.refresh-ttl` | `GOTRACKS_AUTH_REFRESH_TTL` | `720h` | Refresh-token lifetime |
| `--auth.allow-register` | `GOTRACKS_AUTH_ALLOW_REGISTER` | `true` | Seeds self-registration on first run; the admin UI owns it afterwards |
| `--http.rate.rps` / `--http.rate.burst` | `GOTRACKS_HTTP_RATE_RPS` / `_BURST` | `20` / `40` | Per-client rate limit |
| `--http.public-url` | `GOTRACKS_HTTP_PUBLIC_URL` | — | Externally reachable base URL; required when mail is enabled |
| `--http.trusted-proxies` | `GOTRACKS_HTTP_TRUSTED_PROXIES` | — | Comma-separated CIDRs whose `X-Forwarded-For` is trusted; see below |
| `--http.tls.enabled` | `GOTRACKS_HTTP_TLS_ENABLED` | `false` | Serve over HTTPS |
| `--http.tls.cert` | `GOTRACKS_HTTP_TLS_CERT` | — | TLS certificate PEM (required with `--http.tls.enabled`) |
| `--http.tls.key` | `GOTRACKS_HTTP_TLS_KEY` | — | TLS private key PEM (required with `--http.tls.enabled`) |
| `--storage.uploads` | `GOTRACKS_STORAGE_UPLOADS` | XDG data dir | Attachment directory |
| `--storage.max-upload-mb` | `GOTRACKS_STORAGE_MAX_UPLOAD_MB` | `10` | Per-file upload limit |
| `--quota.storage-mb` | `GOTRACKS_QUOTA_STORAGE_MB` | `500` | Per-account attachment allowance (0 = unlimited) |
| `--quota.todos` | `GOTRACKS_QUOTA_TODOS` | `10000` | Per-account action limit (0 = unlimited) |
| `--quota.projects` | `GOTRACKS_QUOTA_PROJECTS` | `1000` | Per-account project limit |
| `--quota.notes` | `GOTRACKS_QUOTA_NOTES` | `10000` | Per-account note limit |
| `--quota.contexts` | `GOTRACKS_QUOTA_CONTEXTS` | `1000` | Per-account context limit |
| `--quota.tags` | `GOTRACKS_QUOTA_TAGS` | `1000` | Per-account tag limit |
| `--quota.recurring` | `GOTRACKS_QUOTA_RECURRING` | `1000` | Per-account recurring-action limit |
| `--quota.tags-per-todo` | `GOTRACKS_QUOTA_TAGS_PER_TODO` | `50` | Tags accepted on one action |
| `--webauthn.rp-id` | `GOTRACKS_WEBAUTHN_RP_ID` | *from public URL* | Passkey relying party id (bare domain); override |
| `--webauthn.rp-origin` | `GOTRACKS_WEBAUTHN_RP_ORIGIN` | *from public URL* | Passkey origin(s), comma-separated; override |
| `--webauthn.rp-name` | `GOTRACKS_WEBAUTHN_RP_NAME` | `gotracks` | Name shown in the passkey prompt |
| `--mail.provider` | `GOTRACKS_MAIL_PROVIDER` | — | `smtp`, `mailjet` or `resend`; empty logs instead of sending |
| `--mail.from` | `GOTRACKS_MAIL_FROM` | — | Sender address (required when a provider is set) |
| `--mail.from-name` | `GOTRACKS_MAIL_FROM_NAME` | `gotracks` | Sender display name |
| `--mail.smtp.host` / `.port` | `GOTRACKS_MAIL_SMTP_HOST` / `_PORT` | — / `587` | SMTP relay |
| `--mail.smtp.username` / `.password` | `GOTRACKS_MAIL_SMTP_USERNAME` / `_PASSWORD` | — | SMTP credentials |
| `--mail.smtp.encryption` | `GOTRACKS_MAIL_SMTP_ENCRYPTION` | `starttls` | `starttls` (587), `tls` (465) or `none` |
| `--mail.mailjet.api-key` / `.secret-key` | `GOTRACKS_MAIL_MAILJET_API_KEY` / `_SECRET_KEY` | — | Mailjet key pair |
| `--mail.resend.api-key` | `GOTRACKS_MAIL_RESEND_API_KEY` | — | Resend API key |

### Stored text limits

User-authored text is bounded by Unicode character count so row quotas also
bound database growth. Context, project, tag and passkey names, plus attachment
filenames and attachment content types allow 200 characters; action, recurrence
and project descriptions allow 1,000; note bodies and action/recurrence notes
allow 1,000. These limits are enforced by the API and cannot be disabled by
configuration.

### Usage report

`GET /api/v1/admin/reports/usage` returns every account's consumption, served
from a table rebuilt on a schedule. Per-account usage is seven counts, so
computing it for a whole instance on demand does not scale; the report is
seven *grouped* queries however many accounts exist (≈65 ms for a thousand).
Only the raw counts are stored — percentages are computed at read time against
the quotas currently configured, so changing a quota doesn't leave stale
numbers behind.

It rebuilds once a day at the local wall-clock time and IANA time zone selected
in the admin screen. UTC is the default. The report can also be rebuilt on
demand there or with `POST /api/v1/admin/reports/usage/run`.

In the UI it's its own page (`/reports`), in the left nav, visible only to
admins. Columns are sortable, each shows percentage of quota used with the raw
count on hover, and the *Worst* column is the highest percentage on that row —
over 100% is possible because a quota is enforced when something is created,
not retroactively when the limit is later lowered. The page takes the same
email/admin/2FA filters as the admin user list, and both are paginated.

### Attachments

The Attachments page (`/attachments`, in the left nav) lists every file a user
has uploaded across all their actions, each showing which action it's attached
to, sortable by name, action, size or upload date. Files can be downloaded or
deleted from there directly. On phones the table becomes touch-friendly cards,
with the same sorting controls and no horizontal page scrolling. In an action
list, the paperclip is tinted when that action has files — whether or not its
panel is open.

Completing an action with attachments normally prompts to delete them, with a
note that this can be automated in Settings. Turning on "auto-delete
attachments when done" (a per-user preference) skips the prompt: the server
deletes an action's attachments itself as part of completing it, before the
client ever asks.

### Notes

Notes are GTD reference material: background and ideas that need no action,
independent of any project — most never touch one. The Notes page
(`/notes`, in the left nav) lists every note for the account, whether or not
it has a project. Typing `#project` while adding a note attaches it, with the
same autocomplete and create-if-unknown behaviour the action composer has.

An attached note shows its project as a `#project` chip: the `×` detaches it,
and clicking the name opens the same `#` autocomplete inline to move it
somewhere else. Clicking the note's text edits it in place, as a plain
multi-line field — `⌘/Ctrl + Enter` saves, `Esc` cancels.

Text and project are edited separately on purpose. `#project` is only parsed
out of the body when a note is *created*, where the token is being typed
deliberately and is highlighted as you type. A note is otherwise prose, and
re-parsing it on every save would turn "see issue #42" into a project named
`42` and swallow the reference.

Deleting a project that still holds notes doesn't pick a default: it refuses
with a `409` naming the count, and the caller passes `?deleteNotes=true` (delete
them with the project) or `?deleteNotes=false` (detach and keep them) to
proceed. A project with no notes just deletes.

A note can turn into a next action — GTD's "decide it's actionable" step.
Since an action needs a context and a note has none, converting one asks
which context to use; the project (if any) carries over, and the note is
removed once the action exists.

### Language

The interface ships English and French, and every screen is translated — there
is no hardcoded copy. A user picks a language on the registration form — before
there is an account to store it against — and it is saved with the signup and
shown from the first screen; it can be changed any time under Settings. The choice is also kept on the device, so the sign-in and
registration pages, which render without a session, appear in the right
language on the next visit. A first-time visitor with no stored choice gets
whatever their browser asks for, falling back to English.

A regional tag is reduced to its language (`fr-CA` → `fr`), since the
translations are language-wide. The registration path accepts an unsupported
value and falls back rather than refusing a signup over a display setting; the
settings picker only offers supported languages, so a value it cannot render is
rejected there.

### Per-account limits

Every `quota.*` setting bounds one account, and `0` means unlimited — which is
what a single-user instance wants. Exceeding one is a `409` whose message names
the limit, its ceiling and what the account holder can do about it:

```
You have reached your limit of 200 actions. Delete some completed actions to make room.
```

The UI shows that string verbatim rather than substituting a generic failure —
the server is the only party that knows which limit was hit.

`quota.tags-per-todo` is the odd one out: it bounds a single request rather than
an account total. Tags are created as a side effect of an action's tag list, so
without it one request can write thousands of tag rows while costing a single
action against the action allowance.

Users see their own consumption in Settings, directly after the data-export
pane, via `GET /api/v1/usage`. Unlimited resources show their current count
without a quota bar.

An administrator can see any account's consumption from the user list — the
gauge icon opens a usage panel — or through
`GET /api/v1/admin/users/{id}/usage`. It is a separate call rather than a
column in the user list, since it is seven counts per account and is read one
account at a time.

### Data export

Settings can download an account's data as JSON. The export is intended for
leaving gotracks or processing the data elsewhere, not for re-import: there is
no import endpoint. Database and account identifiers are deliberately omitted;
relationships use the context and project names visible in the UI.

### Sending mail

Transactional mail (account invitations, password reset, address verification)
goes through one provider, chosen with `--mail.provider`:

```bash
# SMTP relay
GOTRACKS_MAIL_PROVIDER=smtp GOTRACKS_MAIL_FROM=tracks@example.com \
GOTRACKS_MAIL_SMTP_HOST=smtp.example.com GOTRACKS_MAIL_SMTP_USERNAME=… \
GOTRACKS_MAIL_SMTP_PASSWORD=…

# Resend
GOTRACKS_MAIL_PROVIDER=resend GOTRACKS_MAIL_FROM=tracks@example.com \
GOTRACKS_MAIL_RESEND_API_KEY=re_…

# Mailjet
GOTRACKS_MAIL_PROVIDER=mailjet GOTRACKS_MAIL_FROM=tracks@example.com \
GOTRACKS_MAIL_MAILJET_API_KEY=… GOTRACKS_MAIL_MAILJET_SECRET_KEY=…
```

Leave `--mail.provider` unset and messages are written to the log instead of
being sent, which is what you want in development. These logged messages contain
fully functional invitation, verification, email-change, deletion and reset
links, and the same verification rules remain enabled as with a real provider.
Configuration is validated at startup, so a missing key or a malformed sender
address stops the server rather than surfacing when somebody first asks for a
password reset.

Run the development backend at debug level to see the bodies and links. Setting
the public URL makes the logged links directly clickable:

```bash
go run . serve --log-level debug --http.public-url http://localhost:8080
```

`--http.public-url` must be set once a provider is configured: verification,
invitation, reset, email-change and deletion links are absolute, and the server
refuses to start without it rather than guessing from a request header, which
an attacker could point at their own site.

Public enrollment and administrator-created accounts both use invitations
instead of accepting or generating an initial password. The single-use link is
stored hashed in the database, expires after 48 hours, and works across server
instances. Choosing a password through it both activates the account and
verifies control of the email address, creates the initial session, and opens
the application without asking for the same credentials again. Administrators
can resend invitations even when public enrollment is disabled. Without a mail
provider, development invitations are written to the debug log instead of
being delivered.

### Account email and deletion

An account holder can request an email-address change from Settings. The
current address remains active until a single-use link sent to the new mailbox
is confirmed. Confirmation revokes existing sessions, requires signing in with
the new address, and sends a security notice to the previous address.

The bottom of Settings contains the account-deletion danger zone. Requesting
deletion sends a single-use link to the account's stored email address; the
link expires after 30 minutes and opens a final page that warns the user,
then performs the irreversible deletion. The JSON export is placed directly
above the deletion danger zone in Settings, and its confirmation modal reminds
the user to keep a copy. The purge removes the account, credentials, sessions,
preferences, actions, projects, notes, recurrence data, reports, attachment
records, and uploaded files. The last administrator must appoint another
administrator before deleting their own account.

**Deliverability is the hard part.** Publish SPF, DKIM and DMARC records for
the sending domain, or reset mail will land in spam and users will conclude the
service is broken.

### Direct TLS

gotracks can terminate TLS itself, which suits a bare host with no proxy in
front. If you already have a certificate (e.g. from `certbot`):

```sh
gotracks serve \
  --http.addr :8443 \
  --http.tls.enabled \
  --http.tls.cert /etc/letsencrypt/live/tracks.example.com/fullchain.pem \
  --http.tls.key  /etc/letsencrypt/live/tracks.example.com/privkey.pem
```

Both files are checked at startup, so a bad path fails immediately rather than
on the first request. Certificates are read once at boot: restart after a
renewal. Behind a reverse proxy, leave TLS off here and terminate it there.

### Running behind a reverse proxy

The rate limiter keys on the address a request arrives from. `X-Forwarded-For`
is attacker-controlled, so it is ignored unless you say which proxies may set
it — otherwise anyone could mint a fresh rate-limit budget per request and forge
the address in the logs.

Left unset (the default, correct for a directly exposed server), every request
behind a proxy carries that proxy's address, so **all clients share a single
rate-limit bucket**. Set it to the proxy's subnet:

```bash
GOTRACKS_HTTP_TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12
```

Bare addresses (`10.0.0.5`) are accepted alongside CIDRs. Forwarded entries are
read right to left, skipping trusted hops, so a client that prepends its own
`X-Forwarded-For` cannot pass itself off as another address.

### Two-factor authentication

Each user can turn on an authenticator app (TOTP) for their own account from
**Settings → Two-factor authentication**. There is no server configuration: the
feature is always available and always opt-in.

Enrolment issues **ten single-use recovery codes**, shown once. They are the
only fallback — this server sends no email, so there is nothing to fall back to
if they are lost. An admin can clear a locked-out user's second factor from the
admin screen, which also signs that user out everywhere.

Two things worth knowing:

- **A passkey still signs in with one tap and is never asked for a code.** A
  passkey is already two factors on its own, so 2FA here protects the password
  path. Anyone wanting a code demanded on every sign-in should not enrol a
  passkey.
- Sign-in challenges are held **in memory**. A restart mid-sign-in just means
  signing in again, but it also means running more than one replica needs
  sticky sessions — the same constraint passkey sign-in already has.

## Docker

```bash
docker run -p 8080:8080 -v gotracks:/data \
  -e GOTRACKS_AUTH_JWT_SECRET=$(openssl rand -hex 32) \
  ghcr.io/jdel/gotracks:latest
```

Compose examples, including a Postgres variant, are in
[example/docker-compose](example/docker-compose).

## Testing

```bash
make test                                   # SQLite
TRACKS_TEST_PG="postgres://…" make test     # also runs repo tests on Postgres
make test-race                              # race detector
```

## Project layout

```
main.go              entry point (ldflags inject the version)
cmd/                 cobra commands: root (config, logging), serve, where
internal/
  api/               router (stdlib mux), middleware, handlers
  auth/              argon2 passwords, JWT
  config/            resolved configuration
  db/                bun setup, driver select, schema sync
  domain/            data models
  repo/              storage interfaces + bun implementation
  service/           application logic
  web/               go:embed of the built frontend (dist is committed)
ui/                  React + Vite + shadcn/ui frontend
example/             docker-compose and config examples
migrations/          (reserved for versioned migrations)
```
