# Accounts and keys to open

Before the first working version
1. **Domain and DNS (Spaceship).** Subdomains: `api.` (backend), `app.` (business admin), bare domain for guest pages. QR and NFC tags carry this domain, so choose it carefully; check the renewal price, not only the first year.
2. **Google Cloud project (separate from TouristAsk).** Billing on. Enable Places API (New) with a server key (`GOOGLE_PLACES_API_KEY`) and Maps JavaScript API with a browser key restricted to the app domains. Set daily quotas and budget alerts at 50 / 90 / 100 percent.
3. **Brevo.** New API key and a verified sender on the new domain (SPF, DKIM, DMARC).
4. **Cloudflare Turnstile.** A site key (front end) and secret (`TURNSTILE_SECRET`).
5. **Support mailbox** on the new domain for the privacy policy and terms.
6. **Server.** Can be the TouristAsk server; own containers and database.

Later
7. **Stripe** when businesses are charged (same account or a separate one: checkout shows the account's public business name).
8. **Anthropic key** (own spend limit) if offers are translated.
9. **Google Business Profile API**: separate approval request to Google, owner or manager email, quota stays 0 until approved. Start with a pasted Google Maps link instead.
10. **Tripadvisor**: no API at first; the business pastes its Tripadvisor page link.

Not needed: Apple or Google developer accounts (web app), any account for NFC (programmable NTAG tags written with a phone app).
