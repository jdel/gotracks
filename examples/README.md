# Examples

> **These are examples, not production deployments.** They exist to show the
> shape of a setup and to run with a single `docker compose up -d` for a quick
> local look — they are **not** hardened for exposure to the internet as-is.
> Read each file, understand every value, and change what your deployment needs
> (signing secret, TLS, domains, mail, backups) before running one for real.
> Copying an example verbatim into production is on you.

Ready-to-run Docker Compose setups. Each subdirectory is self-contained — `cd`
into one and `docker compose up -d`.

**Signing secret.** No usable signing key is committed in any example.
`home-use` and `public-use` leave `GOTRACKS_AUTH_JWT_SECRET` unset, so gotracks
generates a random one at startup — a restart just signs everyone out, and if
you ever set a short key the startup log prints a strong one to copy. `public-ha`
cannot auto-generate (every replica would pick a different key and reject the
others' tokens), so it **fails closed**: export a shared secret before `up`:

```bash
export GOTRACKS_AUTH_JWT_SECRET=$(openssl rand -hex 32)
```

Other working defaults are marked `*-change-me` and overridable through an
`.env` file or the environment.

Every gotracks service declares both an `image:` and a `build:` on the repo
root, so:

- **No image locally** → `docker compose up -d` **builds** it from your checkout
  (a declared `build:` is used before any pull).
- **Image already present** (pulled or built earlier) → `up` reuses it. Force a
  rebuild from your current source with `--build`:

  ```bash
  docker compose up -d --build
  ```

- To use the **published** image instead, `docker compose pull` first.

| Example | Node(s) | Database | Attachments | Legal | Mail |
| --- | --- | --- | --- | --- | --- |
| [`home-use`](home-use) | single | SQLite | local disk | off | logged |
| [`public-use`](public-use) | single | SQLite | local disk | on | Mailpit inbox |
| [`public-ha`](public-ha) | 2 replicas + LB | Postgres | MinIO (S3, TLS) | on | Mailpit inbox |

- **home-use** — the minimum that works, for a machine only you reach.
- **public-use** — a real single-node shape: legal pages, a viewable mail inbox,
  passkeys. Not highly available (SQLite + local disk pin it to one node).
- **public-ha** — multiple replicas sharing Postgres and S3 storage, with MinIO
  on self-signed TLS that gotracks trusts without disabling verification.

Every gotracks flag has an environment equivalent: the `GOTRACKS_` prefix with
dots and dashes as underscores (`--auth.jwt-secret` → `GOTRACKS_AUTH_JWT_SECRET`).
S3 endpoint and credentials use the standard `AWS_*` variables instead. See the
[Configuration table](../README.md#configuration) in the main README.
