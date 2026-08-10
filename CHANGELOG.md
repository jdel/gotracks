# Changelog

All notable changes to this project are documented here.

## v0.5.0 - 2026-08-10

### Added

- The interface was rebuilt on a shared design system: self-hosted fonts, a
  token-only palette with a full dark theme, and a set of shared primitives every
  screen is composed from. The desktop navigation is now an icon sidebar that
  collapses to icons only and remembers the choice per device; on phones the tab
  bar and "More" sheet are unchanged.
- Deleting an action, note or recurrence is optimistic and undoable: the row
  leaves at once and a 5s toast offers Undo, replacing the confirmation dialog.
  Completing an action works the same way — it strikes through, and un-checking
  the box inside the window cancels it.
- Actions carry touch gestures: swipe left to delete, swipe right to star, and
  long-press for an action sheet.
- The tickler and the completed archive group their rows by day, in the
  account's time zone.
- Projects report `doneCount` and `totalCount` alongside `openCount`, so a
  project card can show its progress.
- The admin user list can be ordered by email, verification or creation date
  (`sort` and `dir` query parameters, whitelisted server-side), and flags
  accounts with a pending deletion request or past one of their quotas.
- Project detail lists the files attached to the project's actions.

### Fixed

- "Today", "overdue" and the count of actions completed today are calculated in
  the account's time zone rather than the browser's, so an action is no longer
  reported overdue purely because the machine sits in a different zone.
- Unverified accounts sort to the same end of the admin user list on SQLite and
  on Postgres, which disagree on where NULLs belong.
- Account emails are logged at info level when no mail provider is configured,
  so the activation link for the first administrator is visible in the logs.

### Changed

- Fonts are served from `/static/fonts/` instead of `/fonts/`.

## v0.4.0 - 2026-08-02

### Breaking changes

- Removed `auth.bootstrap-secret`. The first account to register on an empty
  instance now becomes the administrator with no secret; registering it on a
  private deployment before exposing the service is the operator's
  responsibility.
- The admin user list (`GET /api/v1/admin/users`) is now paginated and filtered
  in the database: it returns `{items, total, page, pageSize}` instead of a bare
  array and accepts `q`, `admin`, `twoFactor`, `page` and `pageSize` query
  parameters.
- An administrator can no longer remove their own administrator rights, mirroring
  the existing self-deletion guard.

### Added

- Prometheus metrics on a separate listener (`--metrics.addr`): instance-wide
  gauges (accounts, attachment storage, configured quotas) pulled live at scrape
  time, plus HTTP request metrics (rate, latency, in-flight) and security
  counters. Metric labels are bounded — no per-account series.
- Optional S3 attachment storage (`--storage.type s3`) for shared, HA-capable
  storage; endpoint and credentials come from the standard `AWS_*` environment.
  The default `local` store speaks S3 to an in-process server, keeping a single
  storage code path.
- Legal pages — terms, privacy and cookie policies with default texts in all
  four interface languages, a per-language admin editor, and single-checkbox
  consent at registration (`--legal.enabled`).
- Audit log of account and administrator events, with a configurable retention
  period (`--legal.retention-days`), filtering and pagination, and CSV/JSON
  export carrying a SHA-256 fingerprint of the exact bytes produced.
- Session management: list active sessions per device and revoke them, including
  "sign out everywhere else".
- Server settings admin page with a runtime log-level override that takes effect
  without a restart.
- Request correlation: an `X-Request-ID` is inherited from trusted proxies (or
  generated) and threaded through service logs and per-query database logs.
- Per-address invitation-email throttle to block mailbox flooding.
- Data export as a zip archive containing structured JSON alongside every
  uploaded attachment.
- Passkey sign-in enumeration resistance: an unknown address receives an
  invented ceremony indistinguishable from a real one.
- Italian and German interface translations, joining English and French.
- The build version is shown in the interface (to signed-in users only).

### Fixed

- Logout, session revocation and password/email changes now invalidate the
  access token immediately rather than at its expiry (SR-12).
- Concurrent last-admin changes can no longer leave an instance with no
  administrator (SR-13).
- Public mail flows (invitation, verification, reset) are throttled per address
  and keep a single live link per flow (SR-09).
- Project default-context references are validated and ownership-scoped, and
  project deletion no longer detaches actions before confirming (SR-11).
- The interactive API docs are served with relative URLs and require
  authentication; the per-Host handler cache and Host reflection are removed
  (SR-10).
- Request bodies must contain exactly one JSON value, and usage-report and
  audit-log pagination are bounded against integer overflow (SR-15).
- The public deployment examples no longer ship a usable JWT signing secret, and
  a short configured secret is warned about at startup (SR-14).
- Date formatting falls back to UTC when the browser reports an unusable time
  zone such as `Etc/Unknown`.
- The SMTP client bounds the whole session with a deadline so a hung server
  cannot stall a request.
- The auto-delete-attachments preference persists on update, a detected time
  zone is validated before registration, and legal acceptances are removed when
  an account is deleted.

## v0.3.0 - 2026-07-23

### Breaking changes

- Empty instances now require `auth.bootstrap-secret` to create their first
  administrator, and public registration defaults to disabled.
- Removed OIDC configuration, API routes, automatic SSO account provisioning,
  and the login-page SSO flow. Authentication is now local accounts only.

### Added

- Added ordered Bun database migrations with startup locking, safe adoption of
  existing current schemas, and applied-version tracking.
- Added email-confirmed self-service account deletion with a Settings-side JSON
  export reminder, final irreversible warning, complete data purge, and
  protection for the last administrator.
- Added verified email-address changes. The old address remains active until
  the new mailbox confirms, existing sessions are revoked, and the previous
  address receives a security notification.
- Accepting an account invitation now creates the initial authenticated session
  and opens the application directly after the password is chosen.

### Fixed

- The UI build now supports TypeScript 6.
- Public authentication work is now bounded by route and process-wide limits;
  public enrollment creates a capped pending record instead of a user, Argon2
  concurrency is capped, unknown logins create no rows, and passkey ceremonies
  replace prior state per account.
- Authenticated requests now reject deleted users and use current administrator
  privileges instead of stale access-token claims.
- Concurrent refresh requests can no longer reuse one token to create multiple
  successor sessions.
- Concurrent two-factor requests can no longer reuse one TOTP timestep or
  redeem one sign-in challenge more than once.
- Login failure counters now advance atomically under concurrency, and unknown
  accounts perform the same Argon2 work as known accounts.
- User-authored text now has server-enforced size limits, and implicit
  contexts, projects, tags, and recurring actions respect account quotas.

### Dependencies

- Refreshed UI dependencies with a 48-hour publication safety window, with
  explicitly reviewed exceptions for React 19.2.8 and
  `@vitejs/plugin-react` 6.0.4.

### Chore

- Restricted GitHub Actions permissions, refreshed action versions, and
  removed duplicate pull-request checks.
- Removed stale planning documents.

## v0.2.0 - 2026-07-22

### Breaking changes

- Removed data import from the API and UI. Exports are now JSON-only,
  intentionally non-importable snapshots that omit internal identifiers and
  represent context/project relationships by name.
- Removed the YAML, XML and CSV export formats.

### Added

- Usage-report schedules now use a configurable IANA time zone, defaulting to
  UTC, with the same searchable time-zone picker used by account settings.
- A fresh purple/teal light and dark theme, matching favicon and in-app brand
  mark.
- Shared standard and wide desktop page containers for consistent layouts.
- Mobile attachment cards with touch-sized actions and compact sorting controls;
  the full sortable table remains on desktop.
- Personal quota consumption is now a permanent Settings pane after data
  export instead of a Statistics-page modal.

### Dependencies

- Removed the unused Go YAML module and refreshed npm dependencies with a
  48-hour publication safety window.

### Tests

- Added coverage for ID-free named exports, DST-aware report scheduling,
  filterable time-zone selection, shared page widths, Settings quota placement,
  and the mobile attachment layout.

## v0.1.0 - 2026-07-22

### Added

- Card row actions collapse into an overflow (⋯) menu when crowded, and the
  action icons are tighter. The admin overflow menu is trimmed to make/revoke
  admin and delete (plus reset-two-factor only when the user has it).
- Modals are full-screen on mobile: the recurrence editor, the per-user usage
  view, and a new stats-page quota view opened from a top-right icon.
- The admin new-user form opens from a top-right "+", full-screen on mobile.
- Searchable timezone picker (type-to-filter over the full IANA list).

### Fixed

- **Timezone preferences now take effect.** A CGO-free build on a minimal image
  (alpine ships no tzdata) could not `LoadLocation` any zone but UTC, so saving
  a timezone was silently rejected. The tz database is now embedded in the
  binary (`time/tzdata`).
- The page no longer scrolls sideways on mobile (`min-w-0` on the main region).

### Chore

- Dependabot no longer proposes TypeScript bumps past typescript-eslint's
  supported peer range (`<6.1.0`), which otherwise broke the UI install.

## v0.0.2 - 2026-07-21

### Added

- Amber/orange accent theme (light and dark) and a favicon.
- Timezone and date-format preferences are now applied to every rendered date;
  the full IANA timezone list is offered and new accounts default to the zone
  detected from the browser.
- Inline rename for contexts (single click) and project titles (click the
  title).
- Edit an existing recurring action's description and schedule.
- Admin: full-screen per-user usage view, and a password generator with a
  copy-to-clipboard button on the create-user form.

### Fixed

- Contexts created through the composer's `@name` syntax are stored bare,
  matching the manual "add context" form instead of keeping a leading `@`.
- A recurring occurrence still in the tickler (deferred, future show-from) can
  no longer be completed — doing so spawned the next one and let a pattern race
  months ahead.
- Quick-add input no longer overflows to the right on mobile.
- The attachments bulk-delete button sits on its own line below the title.

### Dependencies

- Bumped Go and npm dependencies. The go-openapi bump reorders keys in the
  generated Swagger docs but is otherwise equivalent; the committed
  `internal/docs` were regenerated to match.

## v0.0.1 - 2026-07-21

### Initial release

- Modernized port of [Tracks](https://github.com/TracksApp/tracks)
