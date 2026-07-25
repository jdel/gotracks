# Privacy policy

Last updated: {{EFFECTIVE_DATE}}

{{OPERATOR}} ("we", "us") knows that you care how your personal data is used,
and we take your privacy seriously. This policy explains what we collect, why,
how we look after it, and the rights you have over it. {{OPERATOR}} is the data
controller for the personal data described here.

## What data we collect

**Account data.** Your email address, a hash of your password (we never store
the password itself), whether the address has been verified, whether you are an
administrator, and when the account was created and last changed.

**Your content.** Everything you put into the service: actions, contexts,
projects, notes, tags, recurrence patterns, and any files you attach. We treat
this as private to your account.

**Settings.** Language, time zone, date format, theme.

**Security data.** Failed sign-in attempts against your address, so we can lock
an account that is being attacked; the data needed to verify two-factor
authentication or a passkey if you enable one; and your active sessions, stored
as hashed tokens with the address and browser last seen on each.

**Server logs.** Requests are logged with an IP address, a timestamp, the path
and the response status, so the service can be operated, debugged and protected
from abuse.

**Audit log.** Security-relevant events — sign-ins and failed sign-ins, password
resets, address and second-factor changes, account creation and deletion, and
every action an administrator takes on an account — are recorded with the
address involved, the time, the IP address and the browser. It never contains a
password, token or any other secret.

We do not use analytics, advertising, tracking pixels, or third-party scripts.
We do not build profiles and we make no automated decisions about you.

## How we collect your data

Most of it you give us directly: when you register, sign in, change a setting,
or create content in the service. Some is recorded automatically as you use it —
your IP address, browser, and the security and audit events above — because
operating and securing the service requires it.

## How we use your data, and on what basis

- **To provide the service** — performing our contract with you. This covers
  your account, your content and your settings.
- **To keep the service secure** — our legitimate interest in preventing abuse,
  credential stuffing and fraud, and in being able to account for
  administrative action. This covers the security data, the server logs and the
  audit log.
- **To contact you about your account** — performing our contract: verification,
  password reset, address change and security notices.
- **To meet a legal obligation**, where one applies.

## Who else sees your data

**Our email provider** processes the messages we send you — your address and the
message contents — as our processor, on our instructions only.

**Our hosting provider** operates the servers the service runs on.

That is the complete list. We do not sell personal data and we do not share it
with anyone for their own purposes. We disclose data to authorities only where
we are legally compelled to, and we will tell you unless we are forbidden from
doing so.

## How we store and protect your data

The service and its data are hosted in {{COUNTRY}}. If that ever changes to a
country outside the EEA, we will use a lawful transfer mechanism and update this
policy first.

Passwords are hashed with Argon2id and session tokens are stored hashed, never
in plain form. Two-factor authentication and passkeys are available on every
account. Sign-in attempts are rate limited per address and per source, and an
address is locked temporarily after repeated failures. Traffic is served over
HTTPS, and every query is scoped to the account that owns the data. No service
is perfectly secure; if a breach puts your rights at risk we will notify you and
the supervisory authority as the GDPR requires.

We keep your data only as long as we need it:

- **Your account and content** — until you delete them; deleting your account
  removes them immediately.
- **Failed sign-in records** — removed automatically after 24 hours.
- **Sessions** — refresh tokens expire after 30 days, and are destroyed when you
  sign out, change your password, or change your address.
- **Verification, invitation, reset and deletion links** — single use, expiring
  within hours.
- **Audit log** — kept for the retention period the operator has configured,
  then removed automatically. Because it exists to account for security and
  administrative action, it is **not** deleted when an account is deleted, and
  its entries are never edited or removed by hand.
- **Server logs** — kept for a short operational period, then discarded.
- **Backups** — a deleted account may persist briefly in a backup before that
  backup is rotated out; backups are only ever used to restore the service.

## Marketing

We do not send marketing of any kind and we do not pass your details to anyone
for marketing. There is nothing here to opt in or out of.

## Your data protection rights

Under the GDPR you have the right to:

- **be informed** about how your data is used — this policy;
- **access** your data — Settings contains an export, a zip holding structured
  JSON alongside every file you have uploaded;
- **rectification** — edit your content, and change your email address from
  Settings;
- **erasure** — the danger zone at the bottom of Settings deletes your account
  after you confirm through a link sent to your address, removing your account,
  credentials, sessions, two-factor data, preferences, actions, projects, notes,
  tags, recurrences and attachments; it cannot be undone;
- **restrict** or **object to** our processing;
- **data portability** — the same export serves this.

You can exercise access, rectification, portability and erasure yourself from
Settings, at once. For anything else, write to {{CONTACT_EMAIL}}; we will
respond within one month.

## Cookies

This service sets no cookies. The little it stores in your browser, and why it
needs no consent, is set out in the separate [cookie policy](/cookies).

## Other websites

The service links only to its own pages. Where we name a processor (our email or
hosting provider), their own privacy policy governs what they do; this policy
covers only what we do.

## Children

The service is not intended for anyone under 16, and we do not knowingly collect
their data. If you believe a child has an account, tell us and we will remove
it.

## Changes to this policy

This policy may change. We will announce material changes in the application
before they take effect, and if you do not agree with a change you can delete
your account at any time from Settings.

## How to contact us

For any question about this policy or a request about your data, write to
{{OPERATOR}}, {{ADDRESS}} — {{CONTACT_EMAIL}}.

## How to contact the authority

If you believe we have not handled your data properly, you have the right to
complain to your national data protection authority in {{COUNTRY}}.
