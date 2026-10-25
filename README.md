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
| Partner feed | `GET /partners` with `x-api-key`, see [`docs/PARTNER-API.md`](docs/PARTNER-API.md) |

Publishing needs a name and a connected Google place (that gives the position). The profile holds name, kind, subtitle, offer (max
100 characters), website, Instagram and Facebook links (only those sites are accepted), Tripadvisor review link, phone, contact email,
and a design (template and two colors).

**Known gap:** anyone can connect to any Google place, because ownership is not proven yet (that needs the Google Business Profile
API, see `docs/ACCOUNTS.md`). Before the feed goes live in TouristAsk we need either an operator approval step or that API.

## Status

Built: skeleton, config, schema (User, AuthToken, Business), auth, business profile, Google connection, publish, `GET /partners`;
57 tests. Not verified: anything against a real database, Google Places, Brevo or Turnstile (the sandbox has no access to them).

## Guests and privacy (slice 3)

A guest is one account per email address, shared by all businesses, so the same person is recognised everywhere. There is no password:
the guest gets a link (valid 30 minutes, single use, only a hash is stored) and the session is a long-lived HTTP-only cookie `guest`
(180 days, separate from the owner's `session` cookie, and it can never open an owner screen). On a new phone the guest asks for a new link.
This identity is what the loyalty card (slice 5) and the offers email (slice 6) hang on: a `Membership` links a guest to a business and
records consent for that business's offers. Consent is recorded only after the link is opened, it is per business, and it is withdrawn
with `PUT /guest/b/:code/marketing`. Google review prompts do not need our own Google sign-in: the review itself happens on Google's site and
we only count the click.

Still to do before launch: privacy policy and terms for guests, a delete-my-data action, and an unsubscribe link in every offers email.
