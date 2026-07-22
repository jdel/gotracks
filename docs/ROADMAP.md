# gotracks Roadmap

A modern reimplementation of [Tracks](https://github.com/TracksApp/tracks) (GTD) with a
Go backend and a React + shadcn/ui frontend. Core-first: the GTD essentials ship before
the long tail of Tracks features.

## Phase status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Scaffold, dual-DB (SQLite/Postgres), JWT auth, contexts end-to-end | ✅ done |
| 2 | Projects, todos CRUD, state machine, due dates, tickler | ✅ done |
| 3 | Tags/taggings, starred, project notes | ✅ done |
| 4 | Views: context home, project, tickler, tags, starred, done | ✅ done |
| 5 | Mobile QA pass + preferences (theme/date/timezone) | ☐ |
| 6 | Recurring todos, reorder endpoint | ✅ done |
| 7 | Preferences, stats, export, admin, attachments, drag-drop, i18n, OIDC | ✅ done |

## Phase 1 — delivered

- Go module, standard layout (`cmd/`, `internal/{api,auth,config,db,domain,repo,service,web}`)
- Dual database via bun behind a `repo.Store` interface: `sqlite:` or `postgres://`
- JWT access tokens (15m) + rotating refresh tokens (hashed at rest), argon2id passwords
- Middleware chain (stdlib): recover → request-id → slog logging → CORS → per-IP rate limit; per-route bearer auth
- Contexts: full CRUD, per-user scoping, ordering
- React + Vite + Tailwind v4 + shadcn/ui, TanStack Query, React Router
- Responsive shell: desktop sidebar, mobile top bar + bottom tab nav
- Single binary: frontend embedded via `go:embed`, SPA deep-link fallback
- Tests: argon2 round-trip; repository tests run on SQLite always, Postgres when `TRACKS_TEST_PG` is set

## Phases 2–4 — delivered

- **Projects** — CRUD, states (active/hidden/completed), open-action counts, review stamp,
  per-project notes, detail view with its actions
- **Todos** — CRUD, GTD state machine (active/deferred/completed), due dates with
  colour-coded urgency, starring, notes, per-context ordering
- **Tickler** — `show_from` defers an action; a sweep on every list activates whatever is due
- **Tags** — free-form, normalized (trim/lowercase/dedupe), replace-on-update, browse by tag
- **Views** — context home (actions grouped by context), projects + detail, tickler, tags,
  starred, done
- **Quick add** — single-line entry with an expandable panel for context/project/due/tickler/tags
- Tests: tickler activation, complete→reactivate (incl. future `show_from`), tag
  normalization, cross-user context rejection

## Phase 6 — delivered

- **Recurring todos** — daily / weekly (multi-weekday, every-N-week aligned) / monthly
  (short months clamped) / yearly (leap day clamped) patterns, with start date, end date
  and a "show in tickler N days early" lead time.
  - Exactly one open instance exists per pattern at a time; sweeps are idempotent.
  - Completing an instance immediately queues the next one, deferred in the tickler until due.
  - A pattern past its end date marks itself completed and stops being swept.
- **Reorder endpoint** — `POST /todos/{id}/reorder`.

Recurrence has its own unit tests (including the `AddDate` month-overflow trap, where
"the 31st monthly" would otherwise skip February entirely).

## Phase 7 — delivered

- **Preferences** — theme (light/dark/system, applied live and following the OS in
  system mode), locale, timezone (validated server-side), date format, week start,
  review period.
- **Statistics dashboard** — totals by state, completion rate, average days to
  complete, 30-day and 12-month completion counts, completed-per-month bars, open
  actions per context, oldest open action, project counts. Chart colour was
  validated with the dataviz palette validator: `#3b82f6` clears the OKLCH
  lightness band for *both* modes and 3:1 contrast on both surfaces, so one value
  serves light and dark. Single-series charts carry no legend; the monthly series
  also renders as a screen-reader table.
- **Export** — JSON, downloaded with the auth token via a blob URL.
  Exports use names for relationships and omit internal database identifiers.
- **Admin panel** — user list, create, promote/demote, delete. Guarded by an
  admin-only middleware; the last admin cannot be demoted or deleted, and nobody
  can delete their own account.
- **Attachments** — per-action upload/download/delete, files on disk with metadata
  in the database, size-capped, and cleaned up when the action is deleted.
- **Drag-and-drop reordering** — `@dnd-kit` on the context home lists, with pointer
  and keyboard sensors; positions persist through the reorder endpoint.
- **Internationalization** — translator with English and French; missing keys fall
  back to English. Locale follows the user preference.
- **Single sign-on (OIDC)** — replaces Tracks' obsolete OpenID 1.0/2.0. Discovery,
  authorization-code flow, single-use CSRF state, userinfo with id_token fallback.
  Accounts are provisioned on first sign-in and are SSO-only. Disabled unless all
  four settings are present; a discovery failure logs and degrades instead of
  stopping the server.

## Deferred features (from Tracks, not yet built)

- [x] ~~Statistics dashboard~~ — done (phase 7)
- [x] ~~Export~~ — done (phase 7)
- [x] ~~Admin panel~~ — done (phase 7)
- [x] ~~Attachments~~ — done (phase 7)
- [x] ~~Drag-and-drop reordering~~ — done (phase 7)
- [x] ~~Internationalization~~ — done (phase 7)
- [x] ~~External auth~~ — done as OIDC (phase 7)
- [x] ~~Review workflow~~ — done (phase 4; `last_reviewed` + review action)
- **RSS / iCal / text feeds — dropped by decision, not deferred.**

### Known gaps

- Date format / timezone preferences are stored and validated, but the frontend
  still renders dates with the browser locale; wiring them through the formatters
  is outstanding.

## Notes / decisions

- **stdlib `net/http`** router (Go 1.22+ method patterns), no third-party router.
- **Dual DB** keeps the schema to a portable subset; dialect-specific queries (future
  full-text search, stats) will be isolated inside the repo layer with per-driver branches.
- Repository tests must pass on **both** engines to catch dialect drift.
