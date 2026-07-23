# Docker Compose example

Two variants: SQLite (default, one container) and Postgres.

## SQLite

```bash
cp .env.example .env
# set GOTRACKS_AUTH_JWT_SECRET and GOTRACKS_AUTH_BOOTSTRAP_SECRET
# generate each with: openssl rand -hex 32
docker compose up -d
```

Open <http://localhost:8080>. Enter `GOTRACKS_AUTH_BOOTSTRAP_SECRET` on the
first registration form; the account becomes admin after accepting its emailed
invitation. Remove the bootstrap secret from `.env` after activation.

The database and attachments live in the `gotracks-data` volume, mounted at
`/data`. The image points `GOTRACKS_DB_URL` and `GOTRACKS_STORAGE_UPLOADS` there
so nothing is lost when the container is replaced.

## Postgres

```bash
cp .env.example .env
docker compose -f docker-compose.postgres.yml up -d
```

The compose file overrides `GOTRACKS_DB_URL`. Attachments still live on disk, so
the data volume is mounted in both variants.

## Behind a reverse proxy

gotracks serves plain HTTP; terminate TLS in front of it. Passkeys need a
secure origin, taken from the public URL — set that and they turn on:

```env
GOTRACKS_HTTP_PUBLIC_URL=https://tracks.example.com
```

The relying-party id (`tracks.example.com`) and origin
(`https://tracks.example.com`) are derived from it. Override them with
`GOTRACKS_WEBAUTHN_RP_ID` / `GOTRACKS_WEBAUTHN_RP_ORIGIN` only for a
multi-origin setup or to scope the id to a parent domain.

## Configuration

Every flag has an environment equivalent: the `GOTRACKS_` prefix with dots and
dashes replaced by underscores (`--auth.jwt-secret` → `GOTRACKS_AUTH_JWT_SECRET`).
See `.env.example`, or run:

```bash
docker compose exec gotracks /gotracks serve --help
docker compose exec gotracks /gotracks where   # resolved paths
```
