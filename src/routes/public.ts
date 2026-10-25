import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db.js";
import { publicBusiness } from "../lib/businessView.js";

/** What a guest can read. Only published businesses exist here; everything else answers not found. */
export async function publicRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/public/b/:code", {
    schema: { params: z.object({ code: z.string().min(4).max(32) }) },
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const b = await prisma.business.findUnique({ where: { code: req.params.code } });
    if (!b || !b.publishedAt) return reply.code(404).send({ error: "not_found" });
    const now = new Date();
    // The latest five posts that have not ended.
    const posts = await prisma.post.findMany({ where: { businessId: b.id, OR: [{ endsAt: null }, { endsAt: { gte: now } }] }, orderBy: { createdAt: "desc" }, take: 5 });
    reply.header("cache-control", "public, max-age=60");
    return publicBusiness(b, posts);
  });
}
