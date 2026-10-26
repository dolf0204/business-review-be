# Business Review backend

API for the business marketing app. A business (restaurant, cafe, bar, barber ...) scans a QR code or NFC tag, signs up and
builds a small page: title, subtitle with an offer, design, footer with website and social links, a loyalty program and
review links. Guests open the business's QR code or NFC tag, register, punch the loyalty card when they are on location,
read the latest offers, and are asked to leave a Google and then a Tripadvisor review. TouristAsk reads the published
businesses through `GET /partners` and shows them to its guests as sponsors.

Repositories (keep them side by side):

| Repository | What it is | Local port |
| --- | --- | --- |
| `business-review-be` (this one) | API, database | 8090 |
| `business-review-fe` | One front end: business admin (`/`) and guest pages (`/b/<code>`) | 5190 |
| `tourists-faq-backend` | The TouristAsk API, which reads `GET /partners` | 8080 |

The ports differ from TouristAsk's (8080, 5173, 5177), so everything can run on one computer at once.

More documents: [`docs/ROADMAP.md`](docs/ROADMAP.md) (what is built and what comes next),
[`docs/PARTNER-API.md`](docs/PARTNER-API.md) (the feed for TouristAsk), [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md)
(accounts and keys to open).

## Run it on localhost

Needs Node 22+ and PostgreSQL 15+.

```sh
docker run -d --name brev-pg -p 5433:5432 -e POSTGRES_USER=brev -e POSTGRES_PASSWORD=brev -e POSTGRES_DB=brev \
  -v brev-pgdata:/var/lib/postgresql/data postgres:17-alpine     # port 5433, so it does not clash with TouristAsk's database

cp .env.dev.example .env.dev      # set DATABASE_URL port to 5433 if you used the command above, and JWT_SECRET
npm install
npx prisma migrate deploy         # creates the tables
npm run dev                       # http://localhost:8090/health
```

Two environments, two commands, no commenting in and out:

| Command | File | Use |
| --- | --- | --- |
| `npm run dev` | `.env.dev` | Everything on `localhost`. |
| `npm run stage` | `.env.stage` | Everything on your computer's network address, for phone testing. |

Copy `.env.dev.example` / `.env.stage.example`. The `.env*` files are git-ignored; never commit or paste keys.

### Scripts

| Script | Does |
| --- | --- |
| `npm run dev` / `npm run stage` | API with restart on changes. |
| `npm run build`, `npm start` | Compile to `dist/` and run it (production). |
| `npm test`, `npm run typecheck` | Vitest (Prisma mocked, no database needed) and `tsc --noEmit`. |
| `npm run db:migrate` | `prisma migrate dev`: create and apply a migration while developing. |
| `npm run db:deploy` | `prisma migrate deploy`: apply existing migrations only. |
| `npm run db:generate` | Regenerate the Prisma client into `src/generated/prisma`. |

After `npm install` or any schema change run `npx prisma generate`. Never edit an applied migration; add a new one.

## Environment

All variables are validated in [`src/config.ts`](src/config.ts); a wrong value stops the server with a clear message.

| Variable | Meaning |
| --- | --- |
| `PORT` (8090), `PUBLIC_API_URL`, `APP_URL` | Where the API runs, and the front end (allowed CORS origin, base of every QR code: `APP_URL/b/<code>`). |
| `DATABASE_URL` | PostgreSQL. |
| `JWT_SECRET`, `COOKIE_SECURE` | Session cookie `session` (secret at least 32 characters). |
| `PARTNER_API_KEYS` | Comma separated keys for `GET /partners`. Empty = the feed is closed. |
| `OPERATOR_EMAILS` | Comma separated emails that get a mail with approve and reject buttons when a business goes live or changes. Only approved businesses are in `GET /partners`. |
| `UPLOAD_DIR` | Where logos and backgrounds are kept (default `uploads`). A persistent volume in production, backed up with the database. |
| `GOOGLE_PLACES_API_KEY` | Places API (New) server key. |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret for the guest forms. |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | Email. Empty key = emails are logged. |

## Where is what

```
prisma/schema.prisma      data model (User, Business so far); migrations/ is committed
src/server.ts             starts the API
src/app.ts                Fastify app: Helmet, CORS (APP_URL only), rate limit, cookie JWT, Zod validation
src/config.ts             every environment variable
src/db.ts                 the one Prisma client
src/routes/               HTTP endpoints: health, partners
src/lib/                  geo (distance, bounding box), code (short codes for QR/NFC)
test/                     Vitest
docs/                     roadmap, partner API, accounts
```

## Code style

Same as TouristAsk: TypeScript strict, ES modules with `.js` import endings, double quotes and semicolons, Zod on every
route, thin routes with the rules in `src/lib`, errors as `{ error: "snake_case" }`, unknown or foreign ids answer
`404 not_found`, the server decides everything that matters (the browser never sends prices, limits or distances), comments
say why. Every rule gets a test.

## API (slice 1)

Session is the HTTP-only cookie `session`. Unknown or foreign ids answer `404 not_found`.

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Auth | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/me` |
| Businesses | `GET/POST /businesses`, `GET/PATCH/DELETE /businesses/:id`, `POST /businesses/:id/publish`, `/unpublish` (max 5 per owner) |
| Google | `POST /google/lookup` (pasted Google Maps link or typed name and town, up to 3 candidates), `PUT /businesses/:id/google` (confirm the place; position, address, rating, review link are read from Google, never from the browser) |
| Share (slice 2) | `GET /businesses/:id/share` (the QR and NFC addresses, `/b/<code>?s=q` and `?s=n`), `GET /businesses/:id/qr?format=svg\|png&size=200..2000` |
| Guest page | `GET /public/b/:code` (published businesses only, no owner or account data, cached 60 s) |
| Guests (slice 3) | `POST /public/b/:code/join` (email link, Turnstile, 5 links per hour per address), `POST /guest/verify`, `GET/PATCH /guest/me`, `POST /guest/logout`, `POST /guest/b/:code/join` (signed-in guest joins another business), `PUT /guest/b/:code/marketing` (give or withdraw consent for offers by email) |
| News (slice 3) | `GET/POST /businesses/:id/posts`, `DELETE /posts/:id` (max 20 per business); the latest 5 live posts are part of `GET /public/b/:code` |
| Reviews (slice 4) | `POST /guest/b/:code/visit` (counts a visit once per day, answers what to ask: `google`, `tripadvisor` or nothing), `POST /guest/b/:code/review/:platform/decline`, `GET /r/:code/:platform` (counts the click, then redirects to the stored Google or Tripadvisor link), `GET /businesses/:id/stats` |
| Loyalty (slice 5) | Owner: `GET/PUT /businesses/:id/loyalty` (program and today's staff code). Guest: `GET /guest/b/:code/loyalty`, `POST .../loyalty/punch` (location or staff code), `POST .../loyalty/redeem` (staff code). The rule is shown to everyone in `GET /public/b/:code`. |
| Offers by email (slice 6) | Owner: `GET/POST /businesses/:id/campaigns` (send to guests who agreed; one a week; answers 202 and sends in the background), `POST /businesses/:id/campaigns/test` (preview to the owner's address). Public: `POST /public/unsubscribe`, `POST /public/unsubscribe/:m/:t` (one-click) |
| Operator (slice 7) | Mail with a link to `/operator/review`; `GET /public/operator/review?b&k`, `POST /public/operator/decision` (approve or reject, the key in the link is the proof) |
| Pictures | `POST /uploads` (JPG, PNG or WebP up to 8 MB, re-encoded as WebP, metadata removed, 30 MB per owner), `GET /uploads/usage`, `GET /media/<id>.webp` (public). Logo and background are `logoUrl` and `backgroundUrl` of a business; a replaced picture is deleted. |
| Partner feed | `GET /partners` with `x-api-key`, see [`docs/PARTNER-API.md`](docs/PARTNER-API.md) |

Publishing needs a name and a connected Google place (that gives the position). The profile holds name, kind, subtitle, offer (max
100 characters), website, Instagram and Facebook links (only those sites are accepted), Tripadvisor review link, phone, contact email,
and a design (template and two colors).

**Known gap:** anyone can connect to any Google place, because ownership is not proven yet (that needs the Google Business Profile
API, see `docs/ACCOUNTS.md`). Before the feed goes live in TouristAsk we need either an operator approval step or that API.

## Status

Built: skeleton, config, schema (User, AuthToken, Business), auth, business profile, Google connection, publish, `GET /partners`;
116 tests. Not verified: anything against a real database, Google Places, Brevo or Turnstile (the sandbox has no access to them).

## Guests and privacy (slice 3)

A guest is one account per email address, shared by all businesses, so the same person is recognised everywhere. There is no password:
the guest gets a link (valid 30 minutes, single use, only a hash is stored) and the session is a long-lived HTTP-only cookie `guest`
(180 days, separate from the owner's `session` cookie, and it can never open an owner screen). On a new phone the guest asks for a new link.
This identity is what the loyalty card (slice 5) and the offers email (slice 6) hang on: a `Membership` links a guest to a business and
records consent for that business's offers. Consent is recorded only after the link is opened, it is per business, and it is withdrawn
with `PUT /guest/b/:code/marketing`. Google review prompts do not need our own Google sign-in: the review itself happens on Google's site and
we only count the click.

Still to do before launch: privacy policy and terms for guests, a delete-my-data action, and an unsubscribe link in every offers email.

## Review prompts (slice 4)

Rules live in `src/lib/reviews.ts` and are tested: Google is asked first and Tripadvisor only after the Google link was followed; a guest who
declines Google is not pushed on to Tripadvisor; "no thanks" is asked again after 3 more visits (a visit is one calendar day, UTC, on which
the guest opened the page); following a link finishes that platform for good. We can only know the link was followed, not that a review
was posted. The redirect target comes only from the business's stored links, so `/r/...` cannot be used as an open redirect.

## Loyalty card (slice 5)

A business has one program: `goal` stamps (2 to 50), a reward text, an optional start and end date, and a radius (150 m, fixed). It can only be
switched on once the business is connected to Google, because the location check needs the business's position. A card copies goal and reward
when it starts, so editing the program never changes a card in progress.

A stamp needs proof that the guest is there: the phone is within the radius (the phone's reported accuracy is allowed for, up to 100 m), or the guest
typed **today's staff code**: six digits derived from the server secret, the business and the date, so it changes every day, is never stored, and cannot
be worked out for another day. The same code lets staff redeem a full card on the guest's phone. Guesses are limited to 10 per 10 minutes per guest.
One stamp per guest per business per day is enforced by the database (unique membership and day), so a double tap cannot give two. Rules are in
`src/lib/loyalty.ts` and tested.

Known limits: a location can be faked by a determined guest; the staff code is a shared secret among staff; redeeming is not limited to the program's dates.
Browsers give a location only on HTTPS pages (and localhost), so tests on a phone over plain `http://<address>` use the staff code.

## Offers by email (slice 6)

The owner writes a subject (80 characters) and a plain-text message (1000); it is escaped and laid out by `src/lib/offerMail.ts`, so nothing typed is
treated as HTML. It goes to memberships with recorded consent whose guest confirmed their email, at most 1000 per campaign, in the guest's language
for the fixed texts. One campaign per business per 7 days. The sender name reads "{business} via BusinessAsk", the address is ours, replies go to the
business's contact email. Every mail has an unsubscribe link and the `List-Unsubscribe` one-click headers that Gmail and Yahoo expect from bulk senders.
The unsubscribe key is an HMAC of the membership id and the server secret: no login, nothing stored, and nobody can unsubscribe another guest.

Sending runs inside the API process after the answer (five at a time). If the process restarts mid-send, the campaign stays "Sending" and the
remaining guests get nothing; moving this to a queue (as TouristAsk does with Redis for translations) is the next step if volumes grow. Real
sending is unverified: the sandbox cannot reach Brevo, and the sender domain must be verified in Brevo (SPF, DKIM, DMARC) before it works.

## Approval before TouristAsk (slice 7)

Anyone can connect a business to any Google place, because ownership is not proven. So a business reaches `GET /partners` only after an operator
approved it: the first time it is published (and whenever an approved business changes its name, subtitle, offer or Google place) the operators in
`OPERATOR_EMAILS` get a mail with the details and a link to a page with Approve and Reject. The key in the link (an HMAC of the business id) is the proof; there
is no operator login. Approval does not affect the business's own page or its loyalty card, only the sponsor listing in TouristAsk.
