# FAQ / how things work

Deeper notes on individual features and deployment topics. For flags and
environment variables see [CONFIGURATION.md](CONFIGURATION.md); for getting
started see the [README](../README.md).

## Metrics

gotracks serves Prometheus metrics on its own address — `--metrics.addr`,
default `:9091` — separate from the API port, at `GET /metrics`. Set it empty to
turn the endpoint off.

The endpoint is **unauthenticated**, so keep the port private: bind it to a
private interface, put it behind a firewall, or leave the container port
unpublished and let Prometheus reach it on the internal network. Do not expose
`:9091` to the internet. The metrics carry no account identifiers — gauges are
instance-wide totals and every counter label is bounded (see the tables below) —
but they are still internal operational data.

Alongside the standard Go runtime and process collectors, it exposes two
families.

**Instance-wide gauges** — totals only, never a series per account (that is the
admin usage report's job). Pulled live from the same aggregation that report
uses, cached briefly, so a dashboard can chart usage against the quota gauges
without the two ever drifting:

| Metric | Labels | Meaning |
| --- | --- | --- |
| `gotracks_users` | — | Number of accounts |
| `gotracks_actions`, `_projects`, `_notes`, `_contexts`, `_tags`, `_recurring_actions` | — | Instance-wide totals |
| `gotracks_attachment_storage_bytes` | — | Total attachment storage in use |
| `gotracks_quota_actions`, …, `_quota_storage_bytes`, `_quota_tags_per_action` | — | Configured per-account limits (0 = unlimited) |
| `gotracks_scrape_errors_total` | — | Failed aggregations while collecting |

**Security counters** — incremented at the event and labelled only by bounded
attributes (outcome, type, resource). They deliberately carry **no per-account
label**: a unique account id would grow the series set without bound and expose
account identifiers on this unauthenticated endpoint. Which account was involved
is recorded in the audit log, which is retained and access-controlled:

| Metric | Labels | Meaning |
| --- | --- | --- |
| `gotracks_login_attempts_total` | `outcome` (success/invalid/locked) | Password sign-ins |
| `gotracks_token_refresh_total` | `outcome` (success/invalid) | Refresh-token rotations |
| `gotracks_two_factor_total` | `outcome` (passed/failed) | Two-factor verifications |
| `gotracks_passkey_ceremonies_total` | `type` (login/register), `outcome` | Passkey ceremonies |
| `gotracks_quota_rejections_total` | `resource` | Requests refused for hitting a quota |
| `gotracks_accounts_activated_total` | — | Registrations completed into a real account |
| `gotracks_registrations_total` | `outcome` (pending/taken/refused/throttled) | Public registration attempts |
| `gotracks_invitation_throttle_suppressed_total` | — | Invitation emails suppressed by the cooldown |
| `gotracks_ratelimit_rejections_total` | `limiter` (register/login/mail/passkey) | Requests rejected by an abuse limiter |

Watch `login_attempts{outcome="locked"}`, `ratelimit_rejections` and
`registrations{outcome="refused"}` for someone hammering the instance; use the
audit log to see which account.

**HTTP** — request rate, latency and saturation, labelled by the matched mux
route (`/api/v1/todos/{id}`), never the raw path, so cardinality stays bounded:

| Metric | Labels |
| --- | --- |
| `gotracks_http_requests_total` | `method`, `route`, `status` |
| `gotracks_http_request_duration_seconds` (histogram) | `method`, `route` |
| `gotracks_http_requests_in_flight` (gauge) | — |

## Account enumeration

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

## Stored text limits

User-authored text is bounded by Unicode character count so row quotas also
bound database growth. Context, project, tag and passkey names, plus attachment
filenames and attachment content types allow 200 characters; action, recurrence
and project descriptions allow 1,000; note bodies and action/recurrence notes
allow 1,000. These limits are enforced by the API and cannot be disabled by
configuration.

## Audit log

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

Between the age-based deletion above and the account-scoped exemption, the table
grows with use but is bounded by `--legal.retention-days`: set it to the shortest
period that still meets your needs (`0` keeps entries forever, which an operator
must choose deliberately).

## Usage report

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

## Attachments

The Attachments page (`/attachments`, in the left nav) lists every file a user
has uploaded across all their actions, each showing which action it's attached
to, sortable by name, action, size or upload date. Files can be downloaded or
deleted from there directly. On phones the table becomes touch-friendly cards,
with the same sorting controls and no horizontal page scrolling. In an action
list, the paperclip is tinted when that action has files — whether or not its
panel is open. It is the one row icon phones keep: the others are gestures
there, but no gesture reaches attachments.

Completing an action with attachments normally prompts to delete them, with a
note that this can be automated in Settings. Turning on "auto-delete
attachments when done" (a per-user preference) skips the prompt: the server
deletes an action's attachments itself as part of completing it, before the
client ever asks.

## Notes

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

## The tickler

An action can carry a "show from" date: until that day arrives it is deferred,
listed only under Tickler, and it appears in the normal lists by itself once the
date passes. Nothing runs on a timer — the promotion happens on the next read,
so a list is never stale.

Setting a due date fills in a show-from automatically, from the per-user
**Show actions this many days before they are due** setting. Its default is `0`,
so an action given a due date and nothing else waits in the tickler until the
day it is due. Raise it to surface the action earlier: `7` puts it in the active
lists a week ahead. Creating an action that lands in the tickler says so, with a
link to it — otherwise it would appear to vanish.

Two rules keep this predictable:

- **Show from is never after the due date.** Pick a later one by hand, or drag
  the due date back past it, and it is pulled to the due date.
- **The default is applied once, at creation.** Editing a due date afterwards
  never recomputes show-from, so an action you are working on is not silently
  hidden. Clearing the due date does clear the show-from that came with it.

An action with no due date can still be parked: give it a show-from on its own
and nothing constrains how far ahead it goes.

## Editing an action

Every detail of an action is editable in place — description, context, project,
tags, notes, both dates, starred — from the same editor wherever the action is
shown, including the tickler. On a desktop the card expands; on a phone a long
press opens it full screen. Each field saves as you leave it rather than behind
a Save button.

Both dates have quick-sets. **Due** offers tomorrow, next week and next month,
counted from today. **Show from** offers 1 day, 1 week and 1 month *before the
due date*, so it needs one to exist and is disabled without it — the date field
itself still works, which is how an undated action gets parked.

Two rules apply as you edit, matching what the server stores:

- **Moving Due carries Show from with it, keeping the gap.** Due on the 1st
  showing from the 1st of the month before, moved to the 15th, shows from the
  15th of the month before. An action with no show-from does not gain one.
- **Show from is never later than Due**, whichever end you moved.

There is no separate "defer" operation: deferring an action — including one
already past its due date — is pushing its due date, which carries the
show-from along and drops the action back into the tickler. A quick-defer
surface offers just those two fields, one gesture away: the Defer button on a
desktop row, a left swipe on a phone.

## Gestures on a phone

- **Swipe right** — star.
- **Swipe left** — defer. This used to delete; deleting an action with one
  horizontal drag on a list scrolled by thumb was too easy to do by accident.
- **Long press** — the editor, which is where delete now lives.
- **Tap the paperclip** — attachments, opened as a full-screen sheet with a
  delete button per file.

Swipes start away from the screen edges: the browser reads an edge swipe as
back/forward and will not let a page cancel it, so roughly a thumb's width at
each side is left alone rather than fought over. Horizontal overscroll is
contained, which is the other way a browser turns a sideways drag into a
navigation.

## Language

The interface ships English, French, Italian and German, and every screen is
translated — there is no hardcoded copy. A user picks a language on the registration form — before
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

## Per-account limits

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
`GET /api/v1/admin/users/{id}/usage`. The detail is a separate call rather than
a column in the user list, since it is seven counts per account and is read one
account at a time.

The list itself carries only a coarse **over quota** chip, taken from the stored
usage report rather than computed live, so it is as fresh as the last rebuild.
Accounts created since that rebuild have no snapshot and show no chip.

## Data export

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

## Sessions

Settings lists the devices signed in to an account. Because a refresh token
rotates on every use, one sign-in is a chain of tokens rather than a single row;
a stable session id ties the chain together so it reads as one device, carrying
its start time, last activity, and most recent address and browser. A user can
end any session but the one they are using, or sign out of all the others at
once. Ending a session revokes its refresh token so its next refresh fails, and
the access token it last minted stops working immediately too: every request
re-checks that its session is still live. Every revoke is recorded in the audit
log.

## Account email and deletion

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

## Legal pages

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

### Agreement

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

## Direct TLS

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

## Running behind a reverse proxy

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

## Two-factor authentication

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
  through the standard `AWS_*` environment variables (see
  [CONFIGURATION.md](CONFIGURATION.md#s3-attachment-storage)). The default
  `local` store keeps each node's files on its own disk, so an attachment
  uploaded on one replica is a 404 on another.

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
[Deliverability](CONFIGURATION.md#deliverability) for the records and a
verification recipe.

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
