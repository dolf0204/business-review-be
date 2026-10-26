# Payments (Stripe)

A business pays for its page. **Without payment the page does not work**: it cannot be published, and when the subscription ends the page goes off the
guests' screens (and its loyalty card, reviews and offers stop with it). The owner can set everything up before paying; only publishing needs payment.

One subscription per business, monthly or yearly. The amounts are **never written in our code**: the backend reads them from the two Stripe Prices, so the Stripe dashboard is the
only place a price is changed. Code: `src/billing/`, `src/routes/billing.ts`.

## Set up (Stripe test mode first)
1. Create one product, for example "BusinessAsk page", with two recurring Prices in EUR: one monthly, one yearly. Copy the `price_...` ids into `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
2. `STRIPE_SECRET_KEY` (`sk_test_...`). Never in a browser, never committed.
3. Webhook endpoint `https://api.businessask.eu/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`;
   its signing secret is `STRIPE_WEBHOOK_SECRET`. Locally: `stripe listen --forward-to localhost:8090/stripe/webhook`.
4. Customer portal (Settings, Billing, Customer portal): allow cancelling, changing the card and, if you want, switching between the two prices. Optional `STRIPE_PORTAL_CONFIGURATION`.
5. Optional `TRIAL_DAYS` (free days before the first payment; 0 = none) and `STRIPE_AUTOMATIC_TAX` (needs your tax registration in Stripe first).
6. Test card `4242 4242 4242 4242`, any future date, any CVC; `4000 0000 0000 0341` fails on renewal.

Checkout shows the Stripe account's public business name, not our product name. Use a Stripe account (or business name) that says BusinessAsk.

## Flow
1. `GET /businesses/:id/billing` answers whether the page is paid, until when, and the two prices from Stripe.
2. `POST /businesses/:id/billing/checkout { interval: "MONTH" | "YEAR" }` creates a Stripe Checkout Session (subscription mode) for that price, with the business id in the metadata; the browser is sent to Stripe and comes back to `/businesses/:id?session_id=...`.
3. `POST /businesses/:id/billing/confirm` reads the session (it must belong to this business) and syncs the subscription, so the page can be published at once.
4. The webhook does the same for every subscription event. **Every event only asks Stripe for the current state** and stores it, so late or out-of-order events cannot leave a wrong state.
5. `POST /businesses/:id/billing/portal` opens Stripe's customer portal (cancel, change card, invoices).

`Business.paidUntil` is the end of the paid period while the subscription is active (a trial counts, and a failed payment keeps the page up until the period ends while Stripe retries).
When the subscription is cancelled or the period has run out, `paidUntil` becomes empty and the page is unpublished. Paying again lets the owner publish it again.
Every guest-facing route checks `isLive` (published and `paidUntil` in the future), so nothing keeps working after the money stops.

## Not verified
Real Stripe checkout and webhooks have not been run (the sandbox cannot reach Stripe); tests use a fake Stripe. Do one test purchase with the test card before trusting it.
