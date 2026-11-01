import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { shareUrl } from "../lib/code.js";
import { isKitKey, kitKey, kitOperatorMail, kitOwnerReceivedMail, kitShippedMail, shipCountries } from "../lib/kit.js";
import { sendMail } from "../lib/mail.js";
import { idParam } from "../schemas.js";

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();

export async function kitRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };

  r.get("/businesses/:id/kit", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const request = await prisma.kitRequest.findFirst({ where: { businessId: b.id, status: { not: "CANCELED" } }, orderBy: { createdAt: "desc" } });
    return { available: !!config.KIT_ORDER_EMAIL, countries: shipCountries(config.KIT_SHIP_COUNTRIES), request };
  });

  // The free kit comes with a paid page, one per business.
  r.post("/businesses/:id/kit", {
    ...auth,
    schema: {
      params: idParam,
      body: z.object({ name: text(100), line1: text(120), line2: optional(120), postalCode: text(20), city: text(80), country: z.string().trim().toUpperCase().length(2), phone: optional(40), printText: text(32) }),
    },
    config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
  }, async (req, reply) => {
    if (!config.KIT_ORDER_EMAIL) return reply.code(503).send({ error: "kit_unavailable" });
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    if (!b.paidUntil || b.paidUntil <= new Date()) return reply.code(402).send({ error: "payment_required" });
    if (!shipCountries(config.KIT_SHIP_COUNTRIES).includes(req.body.country)) return reply.code(422).send({ error: "country_not_supported" });
    if (await prisma.kitRequest.findFirst({ where: { businessId: b.id, status: { not: "CANCELED" } }, select: { id: true } })) return reply.code(409).send({ error: "kit_already_requested" });

    const created = await prisma.kitRequest.create({ data: { businessId: b.id, ...req.body, line2: req.body.line2 ?? null, phone: req.body.phone ?? null } });
    const owner = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { email: true } });
    const qrUrl = shareUrl(config.APP_URL, b.code, "qr");
    const nfcUrl = shareUrl(config.APP_URL, b.code, "nfc");
    const opts = { errorCorrectionLevel: "M" as const, margin: 2 };
    const [png, svg] = await Promise.all([QRCode.toBuffer(qrUrl, { ...opts, width: 2000 }), QRCode.toString(qrUrl, { ...opts, type: "svg", width: 1000 })]);
    const mail = kitOperatorMail({
      business: b.name, ownerEmail: owner?.email ?? "(unknown)", printText: created.printText, name: created.name, line1: created.line1, line2: created.line2, postalCode: created.postalCode,
      city: created.city, country: created.country, phone: created.phone, qrUrl, nfcUrl, link: `${config.APP_URL}/operator/kit?k=${created.id}&key=${kitKey(created.id, config.JWT_SECRET)}`,
    });
    // The request is saved first; a mail problem is logged, and the operator can still see the request in the database.
    try {
      await sendMail({ to: config.KIT_ORDER_EMAIL, ...mail, attachments: [{ name: `qr-${b.code}.png`, content: png }, { name: `qr-${b.code}.svg`, content: Buffer.from(svg) }] }, req.log);
      if (owner) await sendMail({ to: owner.email, ...kitOwnerReceivedMail(b.name) }, req.log);
    } catch (err) {
      req.log.error({ err: (err as Error).message, requestId: created.id }, "kit email could not be sent");
    }
    return reply.code(201).send(created);
  });

  // ---- the operator marks it as posted, from the link in the mail ----
  const ids = z.object({ id: z.uuid(), key: z.string().min(10).max(100) });
  const limit = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  r.get("/public/operator/kit", { ...limit, schema: { querystring: ids } }, async (req, reply) => {
    if (!isKitKey(req.query.key, req.query.id, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const k = await prisma.kitRequest.findUnique({ where: { id: req.query.id }, include: { business: { select: { name: true } } } });
    if (!k) return reply.code(404).send({ error: "not_found" });
    return { business: k.business.name, printText: k.printText, name: k.name, city: k.city, country: k.country, status: k.status };
  });

  r.post("/public/operator/kit/shipped", {
    ...limit,
    schema: { body: ids.extend({ trackingUrl: z.url({ protocol: /^https?$/ }).max(500).nullable().optional() }) },
  }, async (req, reply) => {
    const { id, key, trackingUrl } = req.body;
    if (!isKitKey(key, id, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const k = await prisma.kitRequest.findUnique({ where: { id }, include: { business: { select: { name: true, ownerId: true } } } });
    if (!k) return reply.code(404).send({ error: "not_found" });
    if (k.status !== "SHIPPED") {
      await prisma.kitRequest.update({ where: { id }, data: { status: "SHIPPED", shippedAt: new Date(), trackingUrl: trackingUrl ?? null } });
      const owner = await prisma.user.findUnique({ where: { id: k.business.ownerId }, select: { email: true } });
      if (owner) await sendMail({ to: owner.email, ...kitShippedMail(k.business.name, trackingUrl ?? null) }, req.log).catch((err) => req.log.error({ err: (err as Error).message }, "kit shipped email could not be sent"));
    }
    return { ok: true };
  });
}
