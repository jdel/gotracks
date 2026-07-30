# Public, highly available

A **demo / reference stack** for the HA shape: two gotracks replicas behind a
load balancer, sharing Postgres and S3 storage — the deployment shape from the
[HA section of the main README](../../README.md#running-multiple-instances-high-availability),
as a working compose file. It runs on one host with its ports published on
`localhost`, throwaway `*-change-me` secrets, a self-signed MinIO certificate,
and Mailpit. Run it to see the pieces fit together and read it as a starting
point — it is **not** a hardened, internet-facing deployment as-is.

```bash
docker compose up -d
```

| URL | What |
| --- | --- |
| <http://localhost:8080> | the app, load-balanced across both replicas |
| <http://localhost:8025> | Mailpit — mail gotracks sends |
| <https://localhost:9001> | MinIO console (accept the self-signed cert once) |

## What makes it HA

| Concern | How it is solved here |
| --- | --- |
| Shared database | `db` (Postgres 17); every replica points at it |
| Same token everywhere | one `GOTRACKS_AUTH_JWT_SECRET` shared by both replicas |
| Shared attachments | `minio` over S3; `GOTRACKS_STORAGE_TYPE=s3`, one bucket |
| No sticky sessions | sign-in state is in the database, so nginx round-robins freely |

Scale further by copying the `gotracks2` block to `gotracks3`, etc., and adding
it to `nginx.conf`'s `upstream`.

## TLS everywhere, verified (no skip-verify)

On first `up`, the one-shot `certgen` service writes a self-signed certificate
to `./certs` whose SAN covers both `minio` and `mailpit`. Both services serve
TLS with it:

- **MinIO** serves the S3 API over HTTPS.
- **Mailpit** serves **implicit TLS (SMTPS)** on its SMTP port
  (`MP_SMTP_REQUIRE_TLS`) — TLS from the first byte — and gotracks connects with
  `mail.smtp.encryption=tls`. (STARTTLS is the other mode —
  `MP_SMTP_REQUIRE_STARTTLS` with `encryption=starttls`, as in `../public-use`.)

gotracks trusts the certificate by pointing `SSL_CERT_FILE` at
`./certs/public.crt`, so both the S3 connection and the SMTP STARTTLS session
verify the certificate and hostname fully. Nothing disables verification.

Delete `./certs` to force regeneration (**required** if you ran an earlier
version of this example, whose certificate did not name `mailpit`). These are
**demo certificates** — generate your own for a real deployment, ideally from
your own CA.

## Running the demo

1. <http://localhost:8080> → register. The first account to register becomes the
   admin (gotracks' behaviour on any empty instance — nothing here does a
   special bootstrap step).
2. <http://localhost:8025> → open the invitation and click the activation link.
3. Accept the terms (legal pages are on).

## Data

Bind-mounted under this directory: `./pgdata` (Postgres), `./minio-data`
(attachments), `./certs` (the generated certificate). Back these up; delete them
to start clean.

## Adapting it for an internet-facing deployment

This compose file is a reference, not a hardened deployment. To run it for real,
you own these changes:

- **Secrets** — replace every `*-change-me` value. Generate the JWT secret with
  `openssl rand -hex 32` and set it once — it must be identical on all replicas.
- **Registration and the first admin** — the first account to register becomes
  the administrator, so do not expose the load balancer before that account
  exists. Register it while the app is reachable only to you, then publish.
- **TLS and public URL** — terminate real HTTPS at nginx (or an upstream proxy)
  and set `GOTRACKS_HTTP_PUBLIC_URL` to the public domain.
- **Backing services** — use managed Postgres and object storage, or back these
  with real volumes and backups. Swap MinIO for real S3/R2/B2 by changing only
  `AWS_ENDPOINT_URL_S3` and the credentials — the gotracks configuration does
  not change.
- **Mail** — replace Mailpit with a real mail provider.
