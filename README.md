# gotracks

> **Disclaimer:** These 3 lines are the only thing written by a human on this project
>
> While not an advocate of vibe coding, I wanted to try it on a low risk, low impact project
>
> The goal was to recreate a modern mobile friendly Tracks app, with cloud hosting in mind
>
> Minor improvements might come in later. Feel free to use and self-host

A modern reimplementation of the [Tracks](https://github.com/TracksApp/tracks) GTD web app.

## Quick start

gotracks is a single binary.

**Prebuilt binary.** Download the archive for your OS/arch (example for linux amd64) from the
[v0.6.0 release](https://github.com/jdel/gotracks/releases/tag/v0.6.0), extract it,
and run:

```bash
curl -sL https://github.com/jdel/gotracks/releases/download/v0.6.0/gotracks-0.6.0-linux-amd64.tar.gz | tar zxfv - gotracks
./gotracks serve
```

**Go.** If you have the Go toolchain installed, run:

```bash
go install github.com/jdel/gotracks@v0.6.0
```

**Docker.** Pull the image from ghcr.io/jdel/gotracks

```bash
docker run -p 8080:8080 -v $(PWD)/gotracks-data:/data ghcr.io/jdel/gotracks:v0.6.0
```

**Docker Compose.** The [`examples/home-use`](examples/home-use) stack is a
ready-to-run single-node setup (SQLite, local storage):

```bash
cd examples/home-use && docker compose up -d
```

Then open <http://localhost:8080> and register. **The first account to register
becomes the administrator** — see [First administrator](#first-administrator-and-public-enrollment)
below.

With no mail provider configured, the emails are written to the logs (at info
level) — check your logs to find the activation link for the first administrator.

More complex deployment setups (ha, postgres, s3) are located in [`examples/`](examples).

:warning: The above quick start examples are aimed at trying the product and do not reflect a production setup.

Keep reading the [Configuration](#configuration) section below for all config options.

## Configuration

Three sources, lowest to highest precedence:

    flag default  <  config file  <  GOTRACKS_* env var  <  explicit flag

The config file is `gotracks.{yaml,toml,json}`, looked up in the working
directory then the XDG config dirs, or given explicitly with `--config`. See
[examples/config/gotracks.yaml](examples/config/gotracks.yaml).

Every configuration item has a flag and environment equivalent: the `GOTRACKS_` prefix with dots and
dashes replaced by underscores. For example:

```
--http.addr        →  GOTRACKS_HTTP_ADDR
--auth.jwt-secret  →  GOTRACKS_AUTH_JWT_SECRET
--storage.type     →  GOTRACKS_STORAGE_TYPE
```

**The full flag/environment reference** is in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Commands

```bash
gotracks serve      # run the API and web interface
gotracks where      # show the resolved config file, database and upload paths
gotracks --help     # every flag, with its default
```

## First administrator and public enrollment

**The first account to register becomes the administrator.** On an empty
instance the registration page is open regardless of the public-registration
setting, precisely so that first account can be created; it is still only
created once its emailed activation link is redeemed.

> [!IMPORTANT]
> There is no separate admin bootstrap step, so **register the first account on
> a private deployment — a local run, or before the service is exposed to the
> internet.

## Documentation

- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** — every configuration item, flag 
  and environment variable, S3 attachment storage, sending mail, and DNS/deliverability
  (SPF/DKIM/DMARC).
- **[docs/FAQ.md](docs/FAQ.md)** — how individual features and deployment topics
  work: mobile action and recurring forms, dates and the tickler, metrics, audit
  log, usage report, sessions, two-factor, legal pages, running behind a proxy,
  high availability, and more.

## Development

```bash
# Backend (SQLite in the XDG data dir, verbose logs)
go run . serve --log-level debug          # API on :8080

# Frontend (separate terminal, proxies /api to :8080)
cd ui && npm ci && npm run dev            # UI on :5173
```

Open <http://localhost:5173>. Register the first account, then follow the
invitation link written to the backend's log; the first account to
register becomes the administrator.

Build the production single binary (UI built and embedded):

```bash
make all        # builds the UI, embeds it, builds ./gotracks
```

The built SPA is committed, so `go install github.com/jdel/gotracks@v0.6.0` also
yields a working binary.

### Testing

```bash
make test                                   # SQLite
TRACKS_TEST_PG="postgres://…" make test     # also runs repo tests on Postgres
make test-race                              # race detector
make e2e                                    # browser checks, against a real server
```

`make e2e` drives a real browser and is deliberately outside `make test`: it
needs Chromium and takes seconds rather than milliseconds. It covers only what
jsdom cannot model — a media query at a real pixel width, touch pointers, a
session refresh end to end. One-time setup and the reasoning are in
[`e2e/README.md`](e2e/README.md).
