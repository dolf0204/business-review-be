import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { joinMail } from "../lib/guestMail.js";
import { sendMail } from "../lib/mail.js";
import { hashToken, newToken } from "../lib/tokens.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { UI_LANGS } from "../schemas.js";
import { isLive } from "../lib/live.js";

const DAY = 24 * 60 * 60 * 1000;
const LINK_TTL = 30 * 60 * 1000;
const SESSION_DAYS = 180;
const MAX_LINKS_PER_HOUR = 5;
const email = z.string().trim().toLowerCase().pipe(z.email());
const lang = z.enum(UI_LANGS);
const code = z.string().min(4).max(32);

/** The guest behind this request, from the long-lived `guest` cookie. A session of any other kind never counts. */
export async function guestOf(app: FastifyInstance, req: FastifyRequest) {
  const raw = req.cookies.guest;
  if (!raw) return null;
  try {
    const payload = app.jwt.verify<{ sub: string; kind?: string }>(raw);
    if (payload.kind !== "guest") return null;
    return await prisma.guest.findUnique({ where: { id: payload.sub } });
  } catch {
    return null;
  }
}

const guestView = (g: { email: string; name: string | null; lang: string }) => ({ email: g.email, name: g.name, lang: g.lang });

export async function guestRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  const needGuest = async (req: FastifyRequest, reply: FastifyReply) => {
    const g = await guestOf(app, req);
    if (!g) return reply.code(401).send({ error: "unauthenticated" });
    (req as FastifyRequest & { guest: NonNullable<typeof g> }).guest = g;
  };
  const guestFrom = (req: FastifyRequest) => (req as FastifyRequest & { guest: Awaited<ReturnType<typeof guestOf>> & object }).guest;

  // Join a business with an email address. A link is emailed; opening it signs the guest in. No password is ever set.
  r.post("/public/b/:code/join", {
    ...strict,
    schema: {
      params: z.object({ code }),
      body: z.object({ email, name: z.string().trim().max(100).optional(), lang: lang.default("en"), marketingOptIn: z.boolean().default(false), turnstileToken: z.string().max(4000).optional() }),
    },
  }, async (req, reply) => {
    if (!(await verifyTurnstile(req.body.turnstileToken, req.ip))) return reply.code(400).send({ error: "captcha_failed" });
    const business = await prisma.business.findUnique({ where: { code: req.params.code }, select: { id: true, name: true, code: true, publishedAt: true, paidUntil: true } });
    if (!business || !isLive(business)) return reply.code(404).send({ error: "not_found" });

    const guest =
      (await prisma.guest.findUnique({ where: { email: req.body.email } })) ??
      (await prisma.guest.create({ data: { email: req.body.email, name: req.body.name, lang: req.body.lang } }));
    // A stranger must not be able to fill someone's inbox: a few links an hour per address, the same answer either way.
    const recent = await prisma.guestToken.count({ where: { guestId: guest.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (recent < MAX_LINKS_PER_HOUR) {
      const { token, hash } = newToken();
      await prisma.guestToken.create({ data: { guestId: guest.id, businessId: business.id, tokenHash: hash, marketingOptIn: req.body.marketingOptIn, expiresAt: new Date(Date.now() + LINK_TTL) } });
      const link = `${config.APP_URL}/b/${business.code}?token=${token}`;
      try {
        await sendMail({ to: guest.email, ...joinMail(req.body.lang, business.name, link) }, req.log);
      } catch (err) {
        req.log.error({ err: (err as Error).message, toDomain: guest.email.split("@")[1] }, "guest email could not be sent");
      }
    }
    return reply.code(202).send({ ok: true });
  });

  // Opening the emailed link. Signs the guest in for a long time on this device and records the membership.
  r.post("/guest/verify", { ...strict, schema: { body: z.object({ token: z.string().min(10).max(200) }) } }, async (req, reply) => {
    const row = await prisma.guestToken.findUnique({ where: { tokenHash: hashToken(req.body.token) }, include: { business: { select: { code: true, name: true } } } });
    if (!row || row.usedAt || row.expiresAt < new Date()) return reply.code(400).send({ error: "invalid_or_expired_token" });
    await prisma.guestToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    const guest = await prisma.guest.update({ where: { id: row.guestId }, data: { emailVerifiedAt: new Date() } });
    const now = new Date();
    await prisma.membership.upsert({
      where: { guestId_businessId: { guestId: guest.id, businessId: row.businessId } },
      create: { guestId: guest.id, businessId: row.businessId, marketingOptInAt: row.marketingOptIn ? now : null },
      // Consent is only ever added here; withdrawing it is a separate, explicit action.
      update: row.marketingOptIn ? { marketingOptInAt: now } : {},
    });
    const jwt = app.jwt.sign({ sub: guest.id, kind: "guest" }, { expiresIn: `${SESSION_DAYS}d` });
    reply.setCookie("guest", jwt, { path: "/", httpOnly: true, sameSite: "lax", secure: config.COOKIE_SECURE, maxAge: (SESSION_DAYS * DAY) / 1000 });
    return { guest: guestView(guest), business: row.business };
  });

  r.get("/guest/me", async (req, reply) => {
    const g = await guestOf(app, req);
    if (!g) return reply.code(401).send({ error: "unauthenticated" });
    const memberships = await prisma.membership.findMany({ where: { guestId: g.id }, select: { marketingOptInAt: true, business: { select: { code: true } } } });
    return { ...guestView(g), memberships: memberships.map((m) => ({ code: m.business.code, marketingOptIn: m.marketingOptInAt !== null })) };
  });

  r.patch("/guest/me", { preHandler: needGuest, schema: { body: z.object({ name: z.string().trim().max(100).transform((v) => v || null).optional(), lang: lang.optional() }) } }, async (req) => {
    const g = guestFrom(req);
    return guestView(await prisma.guest.update({ where: { id: g.id }, data: req.body }));
  });

  r.post("/guest/logout", async (_req, reply) => {
    reply.clearCookie("guest", { path: "/" });
    return { ok: true };
  });

  // A guest who is already signed in joins another business with one tap: the address was proven when they signed in.
  r.post("/guest/b/:code/join", { preHandler: needGuest, schema: { params: z.object({ code }), body: z.object({ marketingOptIn: z.boolean().default(false) }).default({ marketingOptIn: false }) } }, async (req, reply) => {
    const g = guestFrom(req);
    const business = await prisma.business.findUnique({ where: { code: req.params.code }, select: { id: true, publishedAt: true, paidUntil: true } });
    if (!business || !isLive(business)) return reply.code(404).send({ error: "not_found" });
    const now = new Date();
    await prisma.membership.upsert({
      where: { guestId_businessId: { guestId: g.id, businessId: business.id } },
      create: { guestId: g.id, businessId: business.id, marketingOptInAt: req.body.marketingOptIn ? now : null },
      update: req.body.marketingOptIn ? { marketingOptInAt: now } : {},
    });
    return { ok: true };
  });

  // Agree to, or stop, a business's offers by email.
  r.put("/guest/b/:code/marketing", { preHandler: needGuest, schema: { params: z.object({ code }), body: z.object({ optIn: z.boolean() }) } }, async (req, reply) => {
    const g = guestFrom(req);
    const m = await prisma.membership.findFirst({ where: { guestId: g.id, business: { code: req.params.code } } });
    if (!m) return reply.code(404).send({ error: "not_found" });
    await prisma.membership.update({ where: { id: m.id }, data: { marketingOptInAt: req.body.optIn ? new Date() : null } });
    return { ok: true, optIn: req.body.optIn };
  });
}
