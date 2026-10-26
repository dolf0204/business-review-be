import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8090),
  PUBLIC_API_URL: z.url(),
  // The front end: business admin and guest pages are one app. Allowed CORS origin and the base of every QR code.
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECURE: z.stringbool().default(false),
  // Comma separated keys the TouristAsk backend sends as x-api-key to read GET /partners. Empty = the feed is closed.
  // Comma separated emails of the people who approve businesses before TouristAsk shows them. Empty = nobody is notified.
  OPERATOR_EMAILS: z.string().default(""),
  PARTNER_API_KEYS: z.string().default(""),
  // Stripe. Empty key = billing answers 503 and nobody can publish.
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  // The two recurring Prices (monthly and yearly) of the BusinessAsk product. The amounts are read from Stripe, never written here.
  STRIPE_PRICE_MONTHLY: z.string().default(""),
  STRIPE_PRICE_YEARLY: z.string().default(""),
  // Customer portal configuration (bpc_...). Empty uses the account's default.
  STRIPE_PORTAL_CONFIGURATION: z.string().default(""),
  STRIPE_AUTOMATIC_TAX: z.stringbool().default(false),
  // Free days before the first payment. 0 = no trial.
  TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(0),
  // Where uploaded images are kept. A persistent volume in production.
  UPLOAD_DIR: z.string().default("uploads"),
  // Server key for the Places API (New), used to look a business up from its Google Maps link.
  GOOGLE_PLACES_API_KEY: z.string().default(""),
  // Cloudflare Turnstile secret for the guest forms. Empty is accepted outside production only.
  TURNSTILE_SECRET: z.string().default(""),
  BREVO_API_KEY: z.string().default(""),
  MAIL_FROM_EMAIL: z.email(),
  MAIL_FROM_NAME: z.string().default("BusinessAsk"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;
