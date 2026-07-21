# Changelog

All notable changes to this project are documented here.

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