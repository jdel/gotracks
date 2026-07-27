# Home use

Single node, SQLite, attachments on local disk. No legal pages, no mail server —
the smallest useful gotracks.

```bash
docker compose up -d
```

Open <http://localhost:8080> and register. The first account to register
becomes the administrator.

No mail server is configured, so the activation link is **printed to the log**
rather than emailed:

```bash
docker compose logs gotracks | grep -i activate
```

## Data

Everything lives in `./data` (bind-mounted to `/data`): the SQLite file and the
`uploads/` directory. Delete that folder to start over; back it up to keep your
data.

## Hardening

Fine as-is for a machine only you reach. Before exposing it anywhere:

- Set a real `GOTRACKS_AUTH_JWT_SECRET` (`openssl rand -hex 32`).
- Put a TLS-terminating reverse proxy in front and set
  `GOTRACKS_HTTP_PUBLIC_URL` — see the `public-use` example.
