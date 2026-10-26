import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Placeholders so modules that read config at import time can load in unit tests.
    env: {
      NODE_ENV: "test",
      PUBLIC_API_URL: "http://localhost:8090",
      APP_URL: "http://localhost:5190",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-test-secret-test-secret-123456",
      MAIL_FROM_EMAIL: "test@example.com",
      PARTNER_API_KEYS: "partner-key-for-tests-0123456789abcdef",
      GOOGLE_PLACES_API_KEY: "places-key-for-tests",
      STRIPE_SECRET_KEY: "sk_test_unit",
      STRIPE_WEBHOOK_SECRET: "whsec_unit",
      STRIPE_PRICE_MONTHLY: "price_month",
      STRIPE_PRICE_YEARLY: "price_year",
      OPERATOR_EMAILS: "boss@example.com, second@example.com",
    },
  },
});
