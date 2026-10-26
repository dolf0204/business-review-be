# Go-live checklist

Things that cannot be tested without the real services. Do them in this order; each step says how to know it worked.
Use Stripe **test mode** until step 9, then switch to live keys and repeat steps 7 and 8 once with a real card you refund.

1. **Server and DNS.** Run `setup-server.sh` (read it first), clone both repositories side by side, point A records for `businessask.eu`, `www` and `api` at the server.
   Check: `dig +short api.businessask.eu` shows the server's address.
2. **Fill `prod.env`.** `./compose.sh prod up --build -d` creates it from the example; fill every value, run it again.
   Generate secrets with `openssl rand -base64 48` (JWT) and `openssl rand -hex 32` (partner key). Never paste them into chat or commit them.
   Check: `./compose.sh prod ps` shows postgres, api and web healthy; `./compose.sh prod logs api` shows migrations applied.
3. **Smoke test.** `./smoke.sh https://businessask.eu https://api.businessask.eu`
   Check: "All checks passed." If CORS fails, `APP_URL` in `prod.env` is not exactly the address of the app.
4. **Email (Brevo).** Add the sending domain in Brevo and create the DNS records it shows (SPF, DKIM) plus a DMARC record (`v=DMARC1; p=none; rua=mailto:<your address>` to start).
   Check: Brevo shows the domain as verified. Register a test owner at `https://businessask.eu/register`; the confirmation mail must arrive in the inbox, not in spam (try Gmail and one more provider).
5. **Robot check (Turnstile).** The widget must allow `businessask.eu`; `TURNSTILE_SECRET` and `VITE_TURNSTILE_SITE_KEY` are the real keys.
   Check: the sign-up form shows the widget, and sign-up works. (Changing `VITE_*` needs `./compose.sh prod up -d --build`.)
6. **Google.** Server key (`GOOGLE_PLACES_API_KEY`): Places API (New) only, restricted to the server's address. Browser key (`VITE_GOOGLE_MAPS_KEY`): Maps JavaScript API only, referrer `https://businessask.eu/*`.
   Check: in the editor, pasting a Google Maps link finds the place; the map in the editor shows Google tiles.
7. **Stripe (test).** Create the product with its two Prices, the webhook `https://api.businessask.eu/stripe/webhook` with the four events listed in `docs/PAYMENTS.md`, the customer portal, and fill the `STRIPE_*` values.
   Check: the Subscription card shows both prices read from Stripe. Pay with `4242 4242 4242 4242`: you come back to the editor, the card says Active, **Publish** is no longer blocked. In Stripe the webhook shows 2xx deliveries.
8. **The whole owner and guest path, on a phone.** Publish a test business; scan its QR code; join as a guest with a second address; open the link from the mail; collect a stamp (once with location, once with the staff code); use a coupon; send an offers email to yourself; follow its unsubscribe link; download and delete the guest's data.
   Then, as the owner: cancel the subscription in the portal. Check: the page stops being shown to guests at the end of the paid period, and deleting the business or the account ends the subscription in Stripe.
9. **Go live on Stripe.** Switch `STRIPE_SECRET_KEY`, the two price ids and `STRIPE_WEBHOOK_SECRET` to live ones (live mode has its own Prices, webhook and portal). One real payment, then refund it.
10. **Operator flow.** Set `OPERATOR_EMAILS` and `KIT_ORDER_EMAIL`. Publish a business: the approval mail arrives and its link approves it. Request a kit: the order mail arrives and its "shipped" link works.
11. **TouristAsk.** Give TouristAsk one partner key (`PARTNER_API_KEYS` here, `PARTNER_API_KEY` there). Check: an approved, paid business appears as a sponsor in a TouristAsk guide, and an unapproved one does not.
12. **Backups.** Add `0 3 * * * /opt/businessask/business-review-be/deploy/backup.sh prod` to cron. Then **restore a backup on a spare machine or a local stack** with `restore.sh` and confirm the data is there. A backup you have never restored is a hope.
13. **Legal.** Have a lawyer read `/terms` and `/privacy`, make sure the `privacy@businessask.eu` mailbox exists, and add the company name and address.

Known limits to remember: the API is one process (offer emails resume after a restart, but two API containers would not split the work); prices live only in Stripe;
the kit is made and posted by hand from the order mail.
