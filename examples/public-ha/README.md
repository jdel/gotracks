# Public, highly available

Two gotracks replicas behind a load balancer, sharing Postgres and S3 storage —
the deployment shape from the [HA section of the main README](../../README.md#running-multiple-instances-high-availability),
as a working compose file.

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

## TLS to MinIO, verified (no skip-verify)

On first `up`, the one-shot `certgen` service writes a self-signed certificate
to `./certs` with `SAN=minio`. MinIO serves HTTPS with it; gotracks trusts it by
pointing `SSL_CERT_FILE` at `./certs/public.crt`, so the S3 connection verifies
the certificate and hostname fully. Nothing disables verification.

Delete `./certs` to force regeneration. These are **demo certificates** —
generate your own for a real deployment, ideally from your own CA.

## First run

1. <http://localhost:8080> → register. The first account to register becomes the
   admin, so do this before the stack is reachable from the internet.
2. <http://localhost:8025> → open the invitation and click the activation link.
3. Accept the terms (legal pages are on).

## Data

Bind-mounted under this directory: `./pgdata` (Postgres), `./minio-data`
(attachments), `./certs` (the generated certificate). Back these up; delete them
to start clean.

## Hardening

- Replace every `*-change-me` secret. Generate the JWT secret with
  `openssl rand -hex 32` and set it once — it must be identical on all replicas.
- Terminate real HTTPS at nginx (or an upstream proxy) and set
  `GOTRACKS_HTTP_PUBLIC_URL` to the public domain.
- Use managed Postgres and object storage, or back these with real volumes and
  backups. Swap MinIO for real S3/R2/B2 by changing only `AWS_ENDPOINT_URL_S3`
  and the credentials — the gotracks configuration does not change.
- Replace Mailpit with a real mail provider.
