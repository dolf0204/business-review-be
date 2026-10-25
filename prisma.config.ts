import { defineConfig } from "prisma/config";

// Prisma commands read DATABASE_URL from .env.dev (or .env) when it exists (in Docker the variables come from compose).
for (const file of [".env.dev", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* no such file */
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
