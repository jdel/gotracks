# Configuration reference

The full flag/environment reference for gotracks. The [README](../README.md)
covers the common cases; this is the exhaustive list.

Three sources, lowest to highest precedence:

    flag default  <  config file  <  GOTRACKS_* env var  <  explicit flag

The config file is `gotracks.{yaml,toml,json}`, looked up in the working
directory then the XDG config dirs, or given explicitly with `--config`. See
[examples/config/gotracks.yaml](../examples/config/gotracks.yaml).

Every flag has an environment equivalent: the `GOTRACKS_` prefix with dots and
dashes replaced by underscores (`--auth.jwt-secret` → `GOTRACKS_AUTH_JWT_SECRET`).

## Flags

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
| `--auth.allow-register` | `GOTRACKS_AUTH_ALLOW_REGISTER` | `false` | Seeds public registration on first run; the admin UI owns it afterwards |
| `--http.rate.rps` / `--http.rate.burst` | `GOTRACKS_HTTP_RATE_RPS` / `_BURST` | `20` / `40` | Per-client rate limit |
| `--http.public-url` | `GOTRACKS_HTTP_PUBLIC_URL` | — | Externally reachable base URL; required when mail is enabled |
| `--http.trusted-proxies` | `GOTRACKS_HTTP_TRUSTED_PROXIES` | — | Comma-separated CIDRs whose `X-Forwarded-For` is trusted; see [FAQ](FAQ.md#running-behind-a-reverse-proxy) |
| `--http.allowed-origins` | `GOTRACKS_HTTP_ALLOWED_ORIGINS` | — | Comma-separated browser origins allowed to call the API; empty allows any (fine for same-origin) |
| `--metrics.addr` | `GOTRACKS_METRICS_ADDR` | `:9091` | Prometheus metrics listen address; empty disables it. See [FAQ](FAQ.md#metrics) |
| `--http.tls.enabled` | `GOTRACKS_HTTP_TLS_ENABLED` | `false` | Serve over HTTPS |
| `--http.tls.cert` | `GOTRACKS_HTTP_TLS_CERT` | — | TLS certificate PEM (required with `--http.tls.enabled`) |
| `--http.tls.key` | `GOTRACKS_HTTP_TLS_KEY` | — | TLS private key PEM (required with `--http.tls.enabled`) |
| `--legal.enabled` | `GOTRACKS_LEGAL_ENABLED` | `false` | Serve the terms, privacy and cookie pages and their admin screen |
| `--legal.retention-days` | `GOTRACKS_LEGAL_RETENTION_DAYS` | `90` | How long audit entries are kept (0 = forever) |
| `--storage.type` | `GOTRACKS_STORAGE_TYPE` | `local` | Attachment store: `local` (in-process S3 over the uploads dir) or `s3` |
| `--storage.uploads` | `GOTRACKS_STORAGE_UPLOADS` | XDG data dir | Local mode: attachment directory |
| `--storage.max-upload-mb` | `GOTRACKS_STORAGE_MAX_UPLOAD_MB` | `10` | Per-file upload limit |
| `--storage.bucket` | `GOTRACKS_STORAGE_BUCKET` | `attachments` | Bucket attachments live in |
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

## S3 attachment storage

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

## Sending mail

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

## Deliverability

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
