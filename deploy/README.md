# Deploying BusinessAsk

One Docker Compose stack: PostgreSQL, the API, and one Caddy container that serves the front end (business admin at `/`, guest pages at `/b/<code>`) and proxies the API. Caddy gets HTTPS certificates by itself.

The two repositories must sit side by side:

```
/opt/businessask/business-review-be   (this one)
/opt/businessask/business-review-fe
```

## On your own computer

```
cd deploy
./compose.sh local up --build -d      # first run creates local.env; edit it, run again
```

API on http://localhost:8090, app on http://localhost:5190.

## On the server (Ubuntu 24.04)

1. `sudo ./setup-server.sh` installs Docker, firewall (22/80/443), fail2ban and swap. Untested; read it first.
2. Point DNS A records for `businessask.eu`, `www.businessask.eu` and `api.businessask.eu` at the server.
3. `./compose.sh prod up --build -d` creates `prod.env` from the example; fill in every value, then run it again.
4. In Stripe, add the webhook `https://api.businessask.eu/stripe/webhook` and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
5. In Brevo, verify the sending domain (SPF, DKIM, DMARC) before mailing real users.

## Operations

- Update: `./update.sh` (pulls both repositories, backs up, rebuilds; migrations run when the API starts).
- Backup: `./backup.sh prod` into `deploy/backups/`, 14 days kept. Add to cron, for example `0 3 * * * /opt/businessask/business-review-be/deploy/backup.sh prod`.
- Smoke test: `./smoke.sh https://businessask.eu https://api.businessask.eu` checks a running stack from the outside. The full list of things to verify with the real services is `GO-LIVE.md`.
- Restore: `./restore.sh prod backups/<date>` (deletes current data after confirmation).
- Logs: `./compose.sh prod logs -f api`.

## Notes

- Uploaded pictures live in the `businessask_uploads` volume; it is part of the backup.
- Changing a `VITE_*` value or `PUBLIC_API_URL` needs a rebuild (`up --build`), because the front end is built with them.
- Secrets live only in `local.env` / `prod.env`, both ignored by git.
