# Examples

Ready-to-run Docker Compose setups. Each subdirectory is self-contained — `cd`
into one and `docker compose up -d`. Secrets have working defaults so they run
out of the box; every default is marked `*-change-me` and overridable through an
`.env` file or the environment.

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
