# Public use (single node)

A **demo / reference stack** showing the single-node shape: SQLite, local
attachment storage, legal pages enabled, and Mailpit as a fake SMTP inbox. It is
meant to be run locally and read as a starting point — **not** deployed to the
internet as-is. It publishes its ports on `localhost`, ships throwaway
`*-change-me` secrets, and sends mail to a fake inbox.

```bash
docker compose up -d
```

| URL | What |
| --- | --- |
| <http://localhost:8080> | the app |
| <http://localhost:8025> | Mailpit — every email gotracks sends lands here |

## Running the demo

1. Open the app and register. The first account to register becomes the
   administrator (that is gotracks' behaviour on any empty instance; nothing
   here performs a special bootstrap step).
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

## Adapting it for an internet-facing deployment

This compose file is a reference, not a hardened deployment. To run it for real,
you own these changes:

- **Secrets** — replace every `*-change-me` value; generate
  `GOTRACKS_AUTH_JWT_SECRET` with `openssl rand -hex 32`.
- **Registration and the first admin** — because the first account to register
  becomes the administrator, do not publish the app's port before that account
  exists. Register it while the listener is reachable only to you (a local run,
  a private network, or an SSH tunnel), then open it up.
- **TLS and public URL** — terminate HTTPS at a reverse proxy, point
  `GOTRACKS_HTTP_PUBLIC_URL` at the real domain, and set
  `GOTRACKS_HTTP_TRUSTED_PROXIES` to the proxy's network so audit-log client IPs
  are real.
- **Mail** — replace Mailpit with a real provider: set `GOTRACKS_MAIL_PROVIDER`
  to `smtp`, `mailjet` or `resend` with its credentials, and publish
  SPF/DKIM/DMARC for the `GOTRACKS_MAIL_FROM` domain.
