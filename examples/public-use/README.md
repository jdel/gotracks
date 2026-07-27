# Public use (single node)

A real single-node deployment shape: SQLite, local attachment storage, legal
pages enabled, and a fake SMTP inbox so you can see the mail gotracks sends.

```bash
docker compose up -d
```

| URL | What |
| --- | --- |
| <http://localhost:8080> | the app |
| <http://localhost:8025> | Mailpit — every email gotracks sends lands here |

## First run

1. Open the app and register. The first account to register becomes the
   administrator — do this **before** exposing the service publicly.
2. Open Mailpit and click the activation link in the invitation email.
3. Accept the terms at the consent checkbox (legal pages are on).
4. Public registration is open by default; close it from the admin settings if
   you want an invitation-only instance.

## Not highly available

SQLite has one writer and local storage is one node's disk, so this cannot run
as more than one replica. For Postgres + shared S3 storage across replicas, see
[`../public-ha`](../public-ha).

## Data

`./data` holds the SQLite file and `uploads/`. Mailpit's inbox is in-memory and
resets when the container stops — it is a demo inbox, not a mail store.

## Hardening

- Set a real `GOTRACKS_AUTH_JWT_SECRET`, and register the admin account before
  the service is reachable from the internet.
- Front it with an HTTPS reverse proxy and point `GOTRACKS_HTTP_PUBLIC_URL` at
  the real domain; set `GOTRACKS_HTTP_TRUSTED_PROXIES` to the proxy's network so
  client IPs in the audit log are real.
- Replace Mailpit with a real provider: set `GOTRACKS_MAIL_PROVIDER` to `smtp`,
  `mailjet` or `resend` and its credentials, and publish SPF/DKIM/DMARC for the
  `GOTRACKS_MAIL_FROM` domain.
