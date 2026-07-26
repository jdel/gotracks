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
go run . serve --log-level debug \
  --auth.bootstrap-secret development-bootstrap-secret # API on :8080

# Frontend (separate terminal, proxies /api to :8080)
cd ui && npm ci && npm run dev            # UI on :5173
```

Open <http://localhost:5173>. Enroll the first account using
`development-bootstrap-secret`, then follow the invitation link written to the
backend's debug log; that account becomes the administrator.

## Production build (single binary)

```bash
make all        # builds the UI, embeds it, builds ./gotracks
GOTRACKS_AUTH_JWT_SECRET=$(openssl rand -hex 32) \
GOTRACKS_AUTH_BOOTSTRAP_SECRET=$(openssl rand -hex 32) \
./gotracks serve
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
| `--auth.bootstrap-secret` | `GOTRACKS_AUTH_BOOTSTRAP_SECRET` | — | Secret required to create the first administrator (minimum 16 characters) |
| `--auth.access-ttl` | `GOTRACKS_AUTH_ACCESS_TTL` | `15m` | Access-token lifetime |
| `--auth.refresh-ttl` | `GOTRACKS_AUTH_REFRESH_TTL` | `720h` | Refresh-token lifetime |
| `--auth.allow-register` | `GOTRACKS_AUTH_ALLOW_REGISTER` | `false` | Seeds public registration after bootstrap; the admin UI owns it afterwards |
| `--http.rate.rps` / `--http.rate.burst` | `GOTRACKS_HTTP_RATE_RPS` / `_BURST` | `20` / `40` | Per-client rate limit |
| `--http.public-url` | `GOTRACKS_HTTP_PUBLIC_URL` | — | Externally reachable base URL; required when mail is enabled |
| `--http.trusted-proxies` | `GOTRACKS_HTTP_TRUSTED_PROXIES` | — | Comma-separated CIDRs whose `X-Forwarded-For` is trusted; see below |
| `--http.tls.enabled` | `GOTRACKS_HTTP_TLS_ENABLED` | `false` | Serve over HTTPS |
| `--http.tls.cert` | `GOTRACKS_HTTP_TLS_CERT` | — | TLS certificate PEM (required with `--http.tls.enabled`) |
| `--http.tls.key` | `GOTRACKS_HTTP_TLS_KEY` | — | TLS private key PEM (required with `--http.tls.enabled`) |
| `--legal.enabled` | `GOTRACKS_LEGAL_ENABLED` | `false` | Serve the terms, privacy and cookie pages and their admin screen |
| `--legal.retention-days` | `GOTRACKS_LEGAL_RETENTION_DAYS` | `90` | How long audit entries are kept (0 = forever) |
| `--storage.type` | `GOTRACKS_STORAGE_TYPE` | `local` | Attachment store: `local` (in-process S3 over the uploads dir) or `s3` |
| `--storage.uploads` | `GOTRACKS_STORAGE_UPLOADS` | XDG data dir | Local mode: attachment directory |
| `--storage.max-upload-mb` | `GOTRACKS_STORAGE_MAX_UPLOAD_MB` | `10` | Per-file upload limit |
| `--storage.bucket` | `GOTRACKS_STORAGE_BUCKET` | `attachments` | Bucket attachments live in |

In `s3` mode the endpoint and credentials are **not** gotracks flags — they come
from the standard AWS environment, the same variables and files the AWS SDKs and
CLI read.

**Endpoint and region** (gotracks reads these directly, since they are not
credentials):

| Variable | Purpose |
| --- | --- |
| `AWS_ENDPOINT_URL_S3` (or `AWS_ENDPOINT_URL`) | Endpoint URL for R2, B2, MinIO, etc.; its scheme picks HTTP vs HTTPS. Unset means real AWS S3 |
| `AWS_REGION` (or `AWS_DEFAULT_REGION`) | Region |

**Credentials** are resolved through the AWS default-chain precedence — first
match wins:

1. **Environment** — `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (plus
   `AWS_SESSION_TOKEN` for temporary credentials), or MinIO's
   `MINIO_ROOT_USER` + `MINIO_ROOT_PASSWORD`.
2. **Shared credentials file** — `~/.aws/credentials` (or
   `AWS_SHARED_CREDENTIALS_FILE`), profile from `AWS_PROFILE` (default
   `default`). A `credential_process` entry in that profile is honoured.
3. **Instance role** — EC2/ECS/EKS instance and container roles, and IRSA web
   identity, from the container/instance metadata endpoint.

Not supported: native SSO token caches (`~/.aws/sso`) and the region/SSO
settings in `~/.aws/config`. To use SSO, wire it through a `credential_process`
in the credentials file.
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

### Account enumeration

Every public flow answers the same way whether or not an address has an account.
Enrollment, password reset and verification resend return one response for known
and unknown addresses; password sign-in performs the same Argon2 work either
way, so timing does not separate them.

Passkey sign-in does the same by handing back a ceremony for **any** address:
one without a key receives invented options whose credential id is derived from
the address under a server secret, so asking twice gives the same answer and
asking about two addresses gives different ones. The browser rejects a
credential it does not hold exactly as it rejects the wrong key. The invented
ceremony belongs to nobody and cannot complete a sign-in.

### First administrator and public enrollment

An empty database will not start without `auth.bootstrap-secret`. Enter that
secret on the first registration page; only its emailed activation link can
create the initial administrator. Remove the secret from the runtime
configuration after activation.

Public registration is disabled by default. An administrator can enable it in
the admin UI. Public requests create bounded pending enrollments rather than
users; the account is created only when its mailbox link is redeemed.
Registration, login, recovery mail and passkey-begin routes have dedicated
per-client and process-wide limits in addition to the global HTTP limit.

### Stored text limits

User-authored text is bounded by Unicode character count so row quotas also
bound database growth. Context, project, tag and passkey names, plus attachment
filenames and attachment content types allow 200 characters; action, recurrence
and project descriptions allow 1,000; note bodies and action/recurrence notes
allow 1,000. These limits are enforced by the API and cannot be disabled by
configuration.

### Audit log

Administrators get an **Audit log** section listing who did what, when, and from
where. It records the events that matter for accountability and for spotting
misuse: sign-ins and failed sign-ins, password-reset requests, address changes,
account creation, deletion and legal acceptance, and every administrator action
on an account — creation, edits, granting or revoking administrator rights,
two-factor resets, invitation resends, instance settings and legal-text changes.

Each entry holds the time, the action, the outcome, who acted and who they acted
on, the client address, the browser, and a short note such as *granted
administrator*. **It never holds a secret** — no password, hash, token, recovery
code or session id.

The table shows four columns so it reads without scrolling sideways; the address,
browser and note sit behind the details button. Filter by date range, person
(matched against both sides of an action), action and outcome, then export
exactly what the filter matched as CSV or JSON — the whole match, not the visible
page.

**Reading the log is itself recorded.** Searching or exporting writes an
`admin.audit.searched` / `admin.audit.exported` entry naming who looked and with
what filter, so browsing everyone else's history is not itself invisible. An
export entry also carries a **SHA-256 of the exact bytes it produced**, shown
behind a paperclip in the entry's details: a copy of an export can be proven the
untampered original by re-hashing it and comparing, and the log keeps only the
fingerprint, never a second copy of everyone's history at rest. If a download is
interrupted the entry is still written — the server released the data, which is
the fact that matters — with its detail noting the delivery was cut short; the
fingerprint always covers the whole export the server produced, not the fraction
a broken transfer delivered.

**Entries are never edited or removed by hand, and are not deleted when the
account they describe is deleted** — a log its own subject can erase is not
evidence of anything. The one automatic deletion is age: entries past
`--legal.retention-days` (90 by default, `0` to keep forever) are removed at
startup and hourly. Personal data may be kept no longer than the purpose needs,
whatever lawful basis it rests on, so retention is a rule about age rather than
a way to edit history. The privacy policy states the period.

Registrations against an address that already has an account are recorded as
rejected, while the caller still gets the same response as any other
registration. The response cannot be used to test which addresses exist; the log
is where an operator sees somebody working through a list.

The table is never pruned, so it grows with use. That is deliberate, but it is
worth knowing before you run an instance for years.

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

Settings can download an account's data as a **zip**: `export.json` alongside
every file the account has uploaded, under `attachments/`. The JSON lists each
attachment with the path it occupies in the archive, so the archive describes
itself.

The export is intended for leaving gotracks or processing the data elsewhere,
not for re-import: there is no import endpoint. Database and account identifiers
are deliberately omitted; relationships use the context and project names
visible in the UI.

It is written straight to the response as the archive is built rather than
assembled in memory — an account at the default storage quota holds 500 MB of
files. Archive paths are numbered and stripped to a safe character set, because
two actions can hold files of the same name and an uploaded filename is only
ever as trustworthy as the client that sent it. A row whose file has gone
missing is still listed, with no path, rather than failing the whole export.

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

### Sessions

Settings lists the devices signed in to an account. Because a refresh token
rotates on every use, one sign-in is a chain of tokens rather than a single row;
a stable session id ties the chain together so it reads as one device, carrying
its start time, last activity, and most recent address and browser. A user can
end any session but the one they are using, or sign out of all the others at
once. Ending a session revokes its refresh token — its next refresh fails —
while the access token it last minted works until it expires within
`--auth.access-ttl`. Every revoke is recorded in the audit log.

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

### Legal pages

**Off by default.** A private or single-user deployment has nobody to inform,
and empty policy pages are worse than none, so nothing is served until you set
`--legal.enabled`. With it off there are no routes, no links and no admin
screen; the SPA learns this from `/api/v1/config` rather than guessing, so it
never links to a page that would 404.

Enabled, the service serves terms of service, a privacy policy and a
cookie/storage policy at `/terms`, `/privacy` and `/cookies`, linked from under
the sign-out button, the mobile "More" sheet and every signed-out screen.

**Complete drafts ship in every interface language** (`internal/legal/defaults`,
embedded in the binary), so a fresh instance has working pages with nothing to
configure. Administrators get a **Legal** item in the navigation — a language
dropdown at the top, then the three documents as markdown in editable boxes.
Only replacements are stored in the database: a document nobody has edited has
no row, and "Restore default" deletes the row rather than copying the shipped
text into it. Clearing a box and saving does the same — it never publishes a
blank policy.

Each language is edited on its own, because a policy displayed in one language
and written in another tells the reader nothing they can rely on.

#### Agreement

Accepting an invitation requires one tick covering all three documents, and
records the date. That single record is the whole mechanism: the documents
themselves state that they may change and that anyone who disagrees can delete
their account, so continued use is what carries agreement afterwards.

There is deliberately **no versioning, no draft step and no re-consent prompt**.
Under the GDPR a privacy policy is an information duty (Article 13), not
something a reader consents to — the lawful basis here is performing the
contract and keeping the service secure. The cookie policy needs no consent
either, since the storage it describes is strictly necessary. Only the terms are
a contract, and one acceptance at signup binds them.

Saving in the admin screen publishes immediately, and the acceptance date
appears in the account's JSON export and is deleted with the account.

The shipped text is a **draft**: accurate about what the software does, but it
carries `{{PLACEHOLDER}}` markers for the operator name, address, contact
address, country and effective date. Fill those in before you open signup, and
have a lawyer read the result if you run the instance for other people. If you
change how the deployment works — add analytics, another processor, a CDN —
change the text with it, in every language.

The terms are deliberately short: the service is offered the way open-source
code is, as-is and without warranty. The privacy policy is not short and cannot
be, because GDPR Article 13 dictates most of what has to be in it.

There is **no cookie banner, and none is needed**: the app sets no cookies at
all, and the two tokens it keeps in `localStorage` are strictly necessary for a
session the visitor asked for, which is the ePrivacy exemption. The cookie page
says exactly that.

### Deliverability

This is the part that decides whether the feature works. A password reset that
lands in spam is indistinguishable from a broken service, and the user cannot
work around it. None of it is code: gotracks hands a well-formed message to a
provider, and everything below is DNS and provider configuration on the domain
you send from.

**Publish three records for the sending domain**, then check them before you
open signup:

| Record | Where | Shape |
|---|---|---|
| SPF | `example.com` `TXT` | `v=spf1 include:<your provider> -all` |
| DKIM | as the provider instructs | the `CNAME` or `TXT` records it gives you |
| DMARC | `_dmarc.example.com` `TXT` | `v=DMARC1; p=none; rua=mailto:dmarc@example.com` |

Take the SPF `include:` and the DKIM records from the provider's own dashboard
rather than from any document — they differ per provider and change. Use one
`include:` for the provider you actually send through; SPF permits ten DNS
lookups in total and stacked leftovers from previous providers silently break
it. `-all` (hard fail) is the point of the record; `~all` asks receivers to
accept forgeries softly.

Start DMARC at `p=none`, which changes nothing and only asks for reports. Read
the aggregate reports for a couple of weeks, confirm everything legitimate
passes, then move to `p=quarantine` and finally `p=reject`. Publishing
`p=reject` before reading reports is how a domain stops delivering its own mail.

**Alignment is what DMARC actually checks.** The domain in `--mail.from` has to
match the DKIM signing domain and the SPF-authorized sender. gotracks helps
where it can: it always sends a plain-text part alongside the HTML, sets
`Auto-Submitted: auto-generated`, and stamps a unique `Message-ID` rooted in the
`--mail.from` domain. A message with no `Message-ID`, or one from an unrelated
domain, is a spam signal by itself.

**Bounces and complaints decay a sender quietly.** gotracks sends and returns;
it does not receive mail, so it never sees an asynchronous bounce. Two things
follow:

- `--mail.from` must be a real, monitored mailbox. With an SMTP relay it is the
  envelope return path, so that is where bounces arrive; nobody reading it
  means nobody notices a dead address being retried forever.
- Turn on the provider's suppression list (Resend and Mailjet both keep one) so
  repeated sends to a hard-bounced address stop at the provider instead of
  accumulating against your reputation. Watch the complaint rate: mailbox
  providers start throttling well below 1%.

gotracks deliberately ships no bounce webhook receiver — provider-side
suppression covers the same ground without an authenticated public endpoint per
vendor.

**Verify end to end before launch.** Locally, point the SMTP provider at a
catcher such as [Mailpit](https://mailpit.axllent.org/) and walk the real flow:

```bash
docker run -d --rm -p 8025:8025 -p 1025:1025 axllent/mailpit

go run . serve --http.public-url http://localhost:8080 \
  --mail.provider smtp --mail.from tracks@example.com \
  --mail.smtp.host localhost --mail.smtp.port 1025 --mail.smtp.encryption none
```

Request a reset, open the link from Mailpit's inbox, and confirm the new
password works, the old one does not, existing sessions are gone, and the link
fails on a second use. The transport itself has a check of its own:

```bash
MAIL_SMTP_CHECK=localhost:1025 go test ./internal/mail/ -run TestSMTPAgainstLocalRelay -v
```

A catcher proves the flow, not the deliverability. Finish with one send to a
real mailbox on a large provider and read the received headers: they must show
`spf=pass`, `dkim=pass` and `dmarc=pass`.

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
- Sign-in challenges (TOTP and passkey ceremonies alike) live in a short-lived
  database table, not in process memory, so any replica can finish a sign-in any
  other started — no sticky sessions required. A restart mid-sign-in just means
  signing in again.

## Running multiple instances (high availability)

The binary is stateless and scales to several replicas behind a load balancer,
but three things must be shared or pinned first — all configuration, no code:

- **Point every instance at Postgres**, not SQLite (`--db.url postgres://…`). A
  SQLite file has one writer on one node and cannot back a second instance; over
  a network filesystem it corrupts.
- **Set one explicit `--auth.jwt-secret`, identical on every instance.** Left
  unset, each generates its own at boot, so a token minted by one replica is
  rejected by the next and refresh (its digest is HMAC-keyed with the secret)
  fails too. Rotating this value signs everyone out, so treat a change as a
  deliberate fleet-wide sign-out.
- **Use shared object storage: `--storage.type s3`** with a bucket every
  instance can reach (S3, R2, B2, MinIO), its endpoint and credentials supplied
  through the standard `AWS_*` environment variables above. The default `local`
  store keeps each node's files on its own disk, so an attachment uploaded on
  one replica is a 404 on another.

One caveat that needs no configuration: the request **rate limiter is
per-instance**, so the effective per-IP limit is `--http.rate.rps` × replica
count. Divide it by your replica count if you want the number to mean what it
says. The security-critical per-account lockout lives in the database and is
unaffected.

## What this project does not do for you

Three things a public deployment needs are deliberately outside the binary,
because no amount of application code can supply them. They are yours:

**Mail deliverability.** gotracks hands a well-formed message to a provider and
stops there. Publishing SPF, DKIM and DMARC for the sending domain, monitoring
the mailbox behind `--mail.from` for bounces, and enabling the provider's own
suppression list are DNS and vendor configuration. Without them, password-reset
mail lands in spam and users conclude the service is broken. See
[Deliverability](#deliverability) for the records and a verification recipe.

**A database you can restore.** SQLite is the default and is single-writer; run
Postgres for anything with real users. Automated backups with a **tested**
restore are yours to set up — an untested backup is not a backup. Include the
uploads directory: attachment rows without their files are useless.

**The wording of your legal texts.** The binary ships complete drafts in every
interface language, accurate about what the software does, but they carry
`{{PLACEHOLDER}}` markers for your name, address, contact address, country and
effective date. You are the data controller, not this project: fill them in and
have a lawyer read the result before you collect anyone else's data. See
[Legal pages](#legal-pages).

## Docker

```bash
docker run -p 8080:8080 -v gotracks:/data \
  -e GOTRACKS_AUTH_JWT_SECRET=$(openssl rand -hex 32) \
  ghcr.io/jdel/gotracks:latest
```

Compose examples, including a Postgres variant, are in
[example/docker-compose](example/docker-compose).

Complete, ready-to-run deployment setups are in [examples/](examples): a minimal
`home-use` (SQLite, local storage), a single-node `public-use` (legal pages and
a fake mail inbox), and a `public-ha` stack (two replicas behind a load
balancer, Postgres, and MinIO over self-signed TLS that gotracks trusts).

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
  db/                bun setup, driver select, versioned migrations
  domain/            data models
  repo/              storage interfaces + bun implementation
  service/           application logic
  web/               go:embed of the built frontend (dist is committed)
ui/                  React + Vite + shadcn/ui frontend
example/             docker-compose and config examples
```
