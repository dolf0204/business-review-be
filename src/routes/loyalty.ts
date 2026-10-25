import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { DEFAULT_RADIUS_METERS, distanceMeters, isNearEnough, isStaffCode, staffCode, utcDay, windowState } from "../lib/loyalty.js";
import { idParam } from "../schemas.js";
import { guestOf } from "./guests.js";

const code = z.string().min(4).max(32);
const date = z.coerce.date().nullable().optional();
// Trying staff codes is the only thing worth guessing here, so it is limited per guest (or per address when not signed in).
const guessLimit = { rateLimit: { max: 10, timeWindow: "10 minutes", keyGenerator: (req: FastifyRequest) => req.cookies?.guest ?? req.ip } };

export async function loyaltyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };
  const today = () => utcDay(new Date());

  // ---- the business owner ----
  r.get("/businesses/:id/loyalty", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const program = await prisma.loyaltyProgram.findUnique({ where: { businessId: b.id } });
    return {
      program: program ?? { enabled: false, goal: 10, rewardText: "", startsAt: null, endsAt: null, radiusMeters: DEFAULT_RADIUS_METERS },
      // The code staff show to guests who cannot share a location, and enter to redeem a reward. It changes every day.
      staffCode: staffCode(b.id, today(), config.JWT_SECRET),
    };
  });

  r.put("/businesses/:id/loyalty", {
    ...auth,
    schema: {
      params: idParam,
      body: z.object({ enabled: z.boolean(), goal: z.number().int().min(2).max(50), rewardText: z.string().trim().min(1).max(100), startsAt: date, endsAt: date }),
    },
  }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const { startsAt = null, endsAt = null, ...rest } = req.body;
    if (startsAt && endsAt && endsAt <= startsAt) return reply.code(422).send({ error: "invalid_period" });
    // The location check needs to know where the business is, which comes from the Google connection.
    if (rest.enabled && (b.lat === null || b.lng === null)) return reply.code(422).send({ error: "google_not_connected" });
    const data = { ...rest, startsAt, endsAt };
    return prisma.loyaltyProgram.upsert({ where: { businessId: b.id }, create: { businessId: b.id, ...data }, update: data });
  });

  // ---- the guest ----
  async function context(req: FastifyRequest, businessCode: string) {
    const guest = await guestOf(app, req);
    if (!guest) return { ok: false as const, status: 401, error: "unauthenticated" };
    const business = await prisma.business.findUnique({ where: { code: businessCode }, select: { id: true, publishedAt: true, lat: true, lng: true, loyaltyProgram: true } });
    if (!business || !business.publishedAt) return { ok: false as const, status: 404, error: "not_found" };
    const membership = await prisma.membership.findUnique({ where: { guestId_businessId: { guestId: guest.id, businessId: business.id } }, select: { id: true } });
    if (!membership) return { ok: false as const, status: 403, error: "not_member" };
    return { ok: true as const, business, membership, program: business.loyaltyProgram?.enabled ? business.loyaltyProgram : null };
  }

  const currentCard = (membershipId: string) =>
    prisma.loyaltyCard.findFirst({ where: { membershipId, redeemedAt: null }, orderBy: { createdAt: "desc" }, include: { _count: { select: { punches: true } } } });

  async function stateFor(membershipId: string, program: NonNullable<Awaited<ReturnType<typeof context>> extends infer C ? (C extends { program: infer P } ? P : never) : never>) {
    const card = await currentCard(membershipId);
    const last = await prisma.loyaltyPunch.findFirst({ where: { membershipId }, orderBy: { createdAt: "desc" }, select: { day: true } });
    return {
      program: { goal: program.goal, rewardText: program.rewardText, startsAt: program.startsAt, endsAt: program.endsAt, window: windowState(program.startsAt, program.endsAt, new Date()) },
      card: card ? { punches: card._count.punches, goal: card.goal, rewardText: card.rewardText, complete: card.completedAt !== null } : null,
      punchedToday: last?.day === today(),
    };
  }

  r.get("/guest/b/:code/loyalty", { schema: { params: z.object({ code }) } }, async (req, reply) => {
    const c = await context(req, req.params.code);
    if (!c.ok) return reply.code(c.status).send({ error: c.error });
    if (!c.program) return { program: null, card: null, punchedToday: false };
    return stateFor(c.membership.id, c.program);
  });

  r.post("/guest/b/:code/loyalty/punch", {
    schema: {
      params: z.object({ code }),
      body: z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).max(100_000).optional(), staffCode: z.string().max(10).optional() }).default({}),
    },
    config: guessLimit,
  }, async (req, reply) => {
    const c = await context(req, req.params.code);
    if (!c.ok) return reply.code(c.status).send({ error: c.error });
    if (!c.program) return reply.code(404).send({ error: "no_program" });
    const now = new Date();
    if (windowState(c.program.startsAt, c.program.endsAt, now) !== "active") return reply.code(409).send({ error: "program_not_active" });
    const day = utcDay(now);
    const last = await prisma.loyaltyPunch.findFirst({ where: { membershipId: c.membership.id }, orderBy: { createdAt: "desc" }, select: { day: true } });
    if (last?.day === day) return reply.code(409).send({ error: "already_punched_today" });

    // Proof that the guest is really there: the phone is near the business, or staff gave them today's code.
    const { lat, lng, accuracy } = req.body;
    const havePosition = lat !== undefined && lng !== undefined;
    const meters = havePosition && c.business.lat !== null && c.business.lng !== null ? distanceMeters({ lat, lng }, { lat: c.business.lat, lng: c.business.lng }) : null;
    let method: "LOCATION" | "STAFF_CODE" | null = null;
    if (meters !== null && isNearEnough(meters, c.program.radiusMeters, accuracy)) method = "LOCATION";
    else if (isStaffCode(req.body.staffCode, c.business.id, day, config.JWT_SECRET)) method = "STAFF_CODE";
    if (!method) {
      if (req.body.staffCode) return reply.code(403).send({ error: "wrong_code" });
      return reply.code(422).send({ error: havePosition ? "too_far" : "location_required" });
    }

    const card = (await currentCard(c.membership.id)) ?? { ...(await prisma.loyaltyCard.create({ data: { membershipId: c.membership.id, goal: c.program.goal, rewardText: c.program.rewardText } })), _count: { punches: 0 } };
    if (card.completedAt) return reply.code(409).send({ error: "card_complete" });
    try {
      await prisma.loyaltyPunch.create({ data: { cardId: card.id, membershipId: c.membership.id, day, method, distanceMeters: meters } });
    } catch (err) {
      // Two taps at the same moment: the database lets only one stamp per day through.
      if ((err as { code?: string }).code === "P2002") return reply.code(409).send({ error: "already_punched_today" });
      throw err;
    }
    if (card._count.punches + 1 >= card.goal) await prisma.loyaltyCard.update({ where: { id: card.id }, data: { completedAt: now } });
    return stateFor(c.membership.id, c.program);
  });

  // Staff redeem a finished card on the guest's phone by entering today's code. The card is then closed and a new one starts at the next stamp.
  r.post("/guest/b/:code/loyalty/redeem", { schema: { params: z.object({ code }), body: z.object({ staffCode: z.string().max(10) }) }, config: guessLimit }, async (req, reply) => {
    const c = await context(req, req.params.code);
    if (!c.ok) return reply.code(c.status).send({ error: c.error });
    if (!c.program) return reply.code(404).send({ error: "no_program" });
    if (!isStaffCode(req.body.staffCode, c.business.id, today(), config.JWT_SECRET)) return reply.code(403).send({ error: "wrong_code" });
    const card = await currentCard(c.membership.id);
    if (!card?.completedAt) return reply.code(409).send({ error: "nothing_to_redeem" });
    await prisma.loyaltyCard.update({ where: { id: card.id }, data: { redeemedAt: new Date() } });
    return stateFor(c.membership.id, c.program);
  });
}
