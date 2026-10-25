import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });
}
