# Business Review backend

Fastify + Prisma (PostgreSQL) API for the business marketing app: businesses sign up, publish a page with an offer and a
loyalty card, guests register and punch the card, and TouristAsk reads the published businesses as sponsors.
Sister repos: `business-review-fe` (front end), `tourists-faq-backend` (the product that reads `GET /partners`).

- Commands: `npm run dev` (reads `.env.dev`), `npm run stage` (reads `.env.stage`), `npm test`, `npm run typecheck`, `npm run db:migrate`.
- Conventions follow `tourists-faq-backend`: ES modules with `.js` import endings, Zod on every route, thin routes with logic in `src/lib`, errors as `{ error: "snake_case" }`, tests with Prisma mocked (`vi.mock("../src/db.js")`), secrets only through `src/config.ts`.
- Never commit `.env*` files (only the `.example` ones). Never print keys in chat.
- Work on the branch `claude/hopeful-lovelace-t76iwb`; merge into `main` only when asked.
