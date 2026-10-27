import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { sendMail } from "../lib/mail.js";
import { isCouponReviewKey, isReviewKey } from "../lib/operator.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ids = z.object({ b: z.uuid(), k: z.string().min(10).max(100) });
const couponIds = z.object({ c: z.uuid(), k: z.string().min(10).max(100) });

/** The page behind the link in the operator's mail. The key in the link is the proof, so there is no login. */
export async function operatorRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const limit = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  r.get("/public/operator/review", { ...limit, schema: { querystring: ids } }, async (req, reply) => {
    if (!isReviewKey(req.query.k, req.query.b, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const b = await prisma.business.findUnique({ where: { id: req.query.b } });
    if (!b) return reply.code(404).send({ error: "not_found" });
    return { name: b.name, offerText: b.offerText, subtitle: b.subtitle, address: b.address, googleMapsUrl: b.googleMapsUrl, published: b.publishedAt !== null, approved: b.approvedAt !== null };
  });

  r.post("/public/operator/decision", { ...limit, schema: { body: ids.extend({ action: z.enum(["approve", "reject"]) }) } }, async (req, reply) => {
    const { b: id, k, action } = req.body;
    if (!isReviewKey(k, id, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const found = await prisma.business.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true } });
    if (!found) return reply.code(404).send({ error: "not_found" });
    await prisma.business.update({ where: { id }, data: { approvedAt: action === "approve" ? new Date() : null } });
    if (action === "approve") {
      const owner = await prisma.user.findUnique({ where: { id: found.ownerId }, select: { email: true } });
      if (owner) {
        await sendMail({ to: owner.email, subject: `${found.name} is approved`, html: `<p>Good news: <strong>${esc(found.name)}</strong> is approved and can now be shown to tourists on TouristAsk.</p>` }, req.log).catch((err) => req.log.error({ err: (err as Error).message }, "approval email could not be sent"));
      }
    }
    return { ok: true, approved: action === "approve" };
  });

  r.get("/public/operator/coupon", { ...limit, schema: { querystring: couponIds } }, async (req, reply) => {
    if (!isCouponReviewKey(req.query.k, req.query.c, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const c = await prisma.coupon.findUnique({ where: { id: req.query.c }, include: { business: { select: { name: true } } } });
    if (!c) return reply.code(404).send({ error: "not_found" });
    return { businessName: c.business.name, title: c.title, description: c.description, cleared: c.clearedAt !== null };
  });

  r.post("/public/operator/coupon-decision", { ...limit, schema: { body: couponIds.extend({ action: z.enum(["approve", "reject"]) }) } }, async (req, reply) => {
    const { c, k, action } = req.body;
    if (!isCouponReviewKey(k, c, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const { count } = await prisma.coupon.updateMany({ where: { id: c }, data: { clearedAt: action === "approve" ? new Date() : null } });
    if (!count) return reply.code(404).send({ error: "not_found" });
    return { ok: true, approved: action === "approve" };
  });
}