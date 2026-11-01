import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { isLive } from "../lib/live.js";
import { isStaffCode, staffCode, utcDay, windowState } from "../lib/loyalty.js";
import { reviewCoupon } from "../lib/review.js";
import { idParam } from "../schemas.js";
import { guestOf } from "./guests.js";

export const MAX_COUPONS_PER_BUSINESS = 10;
const code = z.string().min(4).max(32);
const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v));
const date = z.coerce.date().nullable().optional();
// Trying staff codes is the only thing worth guessing here, so it is limited per guest.
const guessLimit = { rateLimit: { max: 10, timeWindow: "10 minutes", keyGenerator: (req: FastifyRequest) => req.cookies?.guest ?? req.ip } };

type Window = { startsAt: Date | null; endsAt: Date | null; active: boolean };
/** A coupon can be shown and used when it is switched on and inside its dates. */
export const couponOpen = (c: Window, now = new Date()) => c.active && windowState(c.startsAt, c.endsAt, now) === "active";

/** How many uses are left of a limited coupon; null when it has no limit. */
export const couponLeft = (maxUses: number | null, used: number) => (maxUses === null ? null : Math.max(0, maxUses - used));

export async function couponRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };

  // ---- the business owner ----
  r.get("/businesses/:id/coupons", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const coupons = await prisma.coupon.findMany({ where: { businessId: b.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { uses: true } } } });
    return {
      coupons: coupons.map(({ _count, ...c }) => ({ ...c, uses: _count.uses })),
      // The code staff enter on the guest's phone to confirm a coupon. It changes every day.
      staffCode: staffCode(b.id, utcDay(new Date()), config.JWT_SECRET),
    };
  });

  const body = z.object({ title: z.string().trim().min(1).max(60), description: text(200).optional(), startsAt: date, endsAt: date, maxUses: z.number().int().min(1).max(100_000).nullable().optional() });

  r.post("/businesses/:id/coupons", { ...auth, schema: { params: idParam, body } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const { startsAt = null, endsAt = null } = req.body;
    if (startsAt && endsAt && endsAt <= startsAt) return reply.code(422).send({ error: "invalid_period" });
    if ((await prisma.coupon.count({ where: { businessId: b.id } })) >= MAX_COUPONS_PER_BUSINESS) return reply.code(422).send({ error: "coupon_limit_reached" });
    const created = await prisma.coupon.create({ data: { businessId: b.id, title: req.body.title, description: req.body.description ?? null, startsAt, endsAt, maxUses: req.body.maxUses ?? null } });
    return reply.code(201).send(await reviewCoupon(created, b, req.log));
  });

  r.patch("/coupons/:id", { ...auth, schema: { params: idParam, body: z.object({ active: z.boolean() }) } }, async (req, reply) => {
    const { count } = await prisma.coupon.updateMany({ where: { id: req.params.id, business: { ownerId: req.user.sub } }, data: { active: req.body.active } });
    return count ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  r.delete("/coupons/:id", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    await prisma.coupon.deleteMany({ where: { id: req.params.id, business: { ownerId: req.user.sub } } });
    return reply.code(204).send();
  });

  // ---- the guest ----
  async function context(req: FastifyRequest, businessCode: string) {
    const guest = await guestOf(app, req);
    if (!guest) return { ok: false as const, status: 401, error: "unauthenticated" };
    const business = await prisma.business.findUnique({ where: { code: businessCode }, select: { id: true, publishedAt: true, paidUntil: true } });
    if (!business || !isLive(business)) return { ok: false as const, status: 404, error: "not_found" };
    const membership = await prisma.membership.findUnique({ where: { guestId_businessId: { guestId: guest.id, businessId: business.id } }, select: { id: true } });
    if (!membership) return { ok: false as const, status: 403, error: "not_member" };
    return { ok: true as const, business, membership };
  }

  // The coupons a member can use now, and which of them they already used.
  r.get("/guest/b/:code/coupons", { schema: { params: z.object({ code }) } }, async (req, reply) => {
    const c = await context(req, req.params.code);
    if (!c.ok) return reply.code(c.status).send({ error: c.error });
    const [coupons, used] = await Promise.all([
      prisma.coupon.findMany({ where: { businessId: c.business.id, active: true }, orderBy: { createdAt: "desc" }, include: { _count: { select: { uses: true } } } }),
      prisma.couponUse.findMany({ where: { membershipId: c.membership.id }, select: { couponId: true } }),
    ]);
    const usedIds = new Set(used.map((u) => u.couponId));
    return { coupons: coupons.filter((x) => couponOpen(x)).map((x) => ({ id: x.id, title: x.title, description: x.description, startsAt: x.startsAt, endsAt: x.endsAt, used: usedIds.has(x.id), left: couponLeft(x.maxUses, x._count.uses) })) };
  });

  // Staff confirm a coupon by entering today's code on the guest's phone. One use per guest.
  r.post("/guest/b/:code/coupons/:id/use", { schema: { params: z.object({ code, id: z.uuid() }), body: z.object({ staffCode: z.string().max(10) }) }, config: guessLimit }, async (req, reply) => {
    const c = await context(req, req.params.code);
    if (!c.ok) return reply.code(c.status).send({ error: c.error });
    if (!isStaffCode(req.body.staffCode, c.business.id, utcDay(new Date()), config.JWT_SECRET)) return reply.code(403).send({ error: "wrong_code" });
    const coupon = await prisma.coupon.findFirst({ where: { id: req.params.id, businessId: c.business.id } });
    if (!coupon || !couponOpen(coupon)) return reply.code(404).send({ error: "not_found" });
    try {
      // The row of the coupon is locked while the places are counted, so two guests tapping at the same moment cannot take the last one twice.
      const taken = await prisma.$transaction(async (tx) => {
        if (coupon.maxUses !== null) {
          await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id = ${coupon.id}::uuid FOR UPDATE`;
          if (couponLeft(coupon.maxUses, await tx.couponUse.count({ where: { couponId: coupon.id } })) === 0) return false;
        }
        await tx.couponUse.create({ data: { couponId: coupon.id, membershipId: c.membership.id } });
        return true;
      });
      if (!taken) return reply.code(409).send({ error: "coupon_sold_out" });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return reply.code(409).send({ error: "coupon_already_used" });
      throw err;
    }
    return { ok: true };
  });
}