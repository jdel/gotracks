# Changelog

All notable changes to this project are documented here.

## v0.6.1 - 2026-08-15

### Added

- Contexts and projects can be created directly from their picker, without
  switching to shorthand entry or leaving the form.
- The action pencil opens the editor at every viewport width; editing no longer
  depends on discovering a long press on mobile.

### Fixed

- Action and recurrence add/edit forms now behave consistently on phones:
  Description receives initial focus and participates in iOS keyboard field
  navigation, while form controls no longer steal that focus.
- Optional dates use an explicit floating calendar with Cancel and Apply, so
  merely opening one cannot commit today's date. Dates remain clearable and can
  also be typed with hyphen or slash separators.
- Pinch and double-tap zoom are suppressed consistently, including after a page
  reload, and the login card and form sheets stay visible above the on-screen
  keyboard.
- Browser edge-back gestures take precedence over action-card swipes, date
  fields shrink beside their clear buttons, and audit details use the standard
  mobile sheet.
- The mobile More menu no longer repeats account controls; Sign out now sits at
  the top of Settings. Filter alignment and project review-period wording were
  also corrected.

### Internal

- Tagged releases are published immediately instead of being left as drafts.
- Updated jsdom and npm transitive dependencies, and made the race-test target
  enable CGO only for the race detector while production builds remain
  CGO-disabled.

## v0.6.0 - 2026-08-14

### Breaking changes

- Actions and recurrences no longer carry a `notes` field. Reference material
  belongs on the Notes page, which is independent of any action; the field was a
  second, invisible place for the same thing. `notes` is gone from the action and
  recurrence request and response bodies.

### Added

- **One form for adding and editing**, for actions and for recurrences alike.
  The editor that used to be a separate dialog had fallen behind the composer —
  a recurrence could not change its context or project at all — and there is no
  second form left to fall behind.
- A recurrence has a **window**: a start and an end, both editable and both
  clearable. A window that closes before it opens is refused by the form and by
  the server, checked against the pattern as it will be stored rather than
  against the request alone.
- **Tags on a recurrence**, inherited by every action it spawns — typed as
  `!tag` or in the tags field, normalised and counted like an action's.
- An action's fields and both dates are **edited in place**, wherever the action
  is shown: expanded inside the card on a desktop, a sheet on a phone, with
  exactly one of the two ever mounted. Nothing is written until Save;
  `Ctrl`/`Cmd + Enter` saves, `Escape` discards.
- Quick-sets for both dates, and a **default show-from** for a new action with a
  due date, from the per-user "show actions this many days before they are due"
  setting.
- Attachments are reachable **from a phone**, tickler and contexts moved into
  the mobile tab bar, a sheet can be **pulled down** to dismiss it, a project
  opens from anywhere on its card, and settings open from the header initials.

### Fixed

- A session survives a server that is still starting: a failed refresh on boot
  no longer signs the user out, and expiry mid-session refreshes once and
  carries on.
- Admin routes are **guarded**, not merely hidden — a non-administrator reaching
  one by URL lands on home without the page ever mounting or querying.
- A bulk attachment delete reports the ones that refused and offers to retry
  them, instead of leaving the dialog spinning.
- Editing a due date no longer wipes the show-from, dates are saved on apply or
  blur rather than half-typed, the page behind a sheet is frozen, and the action
  sheet is no longer clipped inside the swipe row.

### Internal

- One shared fake server and one render helper for the frontend tests, replacing
  per-file `fetch` stubs that matched on substrings — which had answered the
  wrong endpoint in tests that passed anyway. Three tests that passed against
  unfixed code were found and fixed.
- A browser suite (`make e2e`) for what jsdom cannot model: a media query at a
  real pixel width, touch pointers, a session refresh end to end. Pinned by its
  own lockfile.
- The bundle was measured against route-level code splitting, which moved 10 kB
  gzipped and was not adopted; the entry chunk now has a ceiling that fails the
  build instead of a warning nobody reads.
- Go 1.26.6, clearing seven standard-library advisories.

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
