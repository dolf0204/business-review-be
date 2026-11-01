import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../db.js";
import type { Business } from "../../generated/prisma/client.js";
import { isLive } from "../../lib/business/live.js";
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH } from "../../lib/slug/slug.js";
import { couponOpen } from "../engage/coupons.js";
import { publicBusiness } from "../../lib/business/businessView.js";

const PAGE_LIMIT = { max: 120, timeWindow: "1 minute" };

async function guestPage(b: Business, reply: FastifyReply) {
  const now = new Date();
  // The latest five posts that have not ended.
  const posts = await prisma.post.findMany({ where: { businessId: b.id, OR: [{ endsAt: null }, { endsAt: { gte: now } }] }, orderBy: { createdAt: "desc" }, take: 5 });
  const loyalty = await prisma.loyaltyProgram.findUnique({ where: { businessId: b.id } });
  const coupons = (await prisma.coupon.findMany({ where: { businessId: b.id, active: true }, orderBy: { createdAt: "desc" }, take: 20 })).filter((c) => couponOpen(c, now));
  reply.header("cache-control", "no-cache");
  return publicBusiness(b, posts, loyalty, coupons);
}

/** What a guest can read. Only published businesses exist here; everything else answers not found. */
export async function publicRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/public/b/:code", {
    schema: { params: z.object({ code: z.string().min(4).max(32) }) },
    config: { rateLimit: PAGE_LIMIT },
  }, async (req, reply) => {
    const b = await prisma.business.findUnique({ where: { code: req.params.code } });
    if (!b || !isLive(b)) return reply.code(404).send({ error: "not_found" });
    return guestPage(b, reply);
  });

  r.get("/public/s/:slug", {
    schema: { params: z.object({ slug: z.string().min(SLUG_MIN_LENGTH).max(SLUG_MAX_LENGTH) }) },
    config: { rateLimit: PAGE_LIMIT },
  }, async (req, reply) => {
    const b = await prisma.business.findUnique({ where: { slug: req.params.slug.toLowerCase() } });
    if (!b || !b.slugLockedAt || !isLive(b)) return reply.code(404).send({ error: "not_found" });
    return guestPage(b, reply);
  });
}