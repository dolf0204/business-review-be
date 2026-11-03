import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireOperator } from "../../lib/auth/operator.js";
import { notifyShipped } from "../../lib/shop/notifyShipped.js";
import { ADMIN_STATUSES, statusChange } from "../../lib/shop/orderStatus.js";
import { idParam } from "../../schemas.js";

const ORDER_LIMIT = 200;
const TRACKING_URL_MAX = 500;

const trackingUrl = z.url({ protocol: /^https?$/ }).max(TRACKING_URL_MAX).nullable().optional();

export async function adminShopRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const guard = { onRequest: [app.authenticate, requireOperator] };

  r.get("/admin/shop/orders", { ...guard, schema: { querystring: z.object({ status: z.enum(ADMIN_STATUSES).optional() }) } }, async (req) => {
    const rows = await prisma.shopOrder.findMany({
      where: { status: req.query.status ?? { in: [...ADMIN_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: ORDER_LIMIT,
      include: {
        items: { select: { design: true, finish: true, size: true, printText: true } },
        business: { select: { id: true, name: true, owner: { select: { email: true } } } },
      },
    });
    return rows.map((o) => ({
      id: o.id,
      status: o.status,
      totalCents: o.totalCents,
      currency: o.currency,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      shippedAt: o.shippedAt,
      deliveredAt: o.deliveredAt,
      trackingUrl: o.trackingUrl,
      name: o.name,
      line1: o.line1,
      line2: o.line2,
      postalCode: o.postalCode,
      city: o.city,
      country: o.country,
      phone: o.phone,
      businessId: o.business.id,
      business: o.business.name,
      ownerEmail: o.business.owner.email,
      items: o.items,
    }));
  });

  r.patch("/admin/shop/orders/:id/status", { ...guard, schema: { params: idParam, body: z.object({ status: z.enum(ADMIN_STATUSES), trackingUrl }) } }, async (req, reply) => {
    const order = await prisma.shopOrder.findUnique({ where: { id: req.params.id }, include: { business: { select: { id: true, name: true, ownerId: true } } } });
    if (!order) return reply.code(404).send({ error: "not_found" });
    const change = statusChange(order, req.body.status, new Date(), req.body.trackingUrl);
    if (!change) return reply.code(409).send({ error: "order_not_paid" });
    const updated = await prisma.shopOrder.update({
      where: { id: order.id },
      data: change.data,
      select: { id: true, status: true, shippedAt: true, deliveredAt: true, trackingUrl: true },
    });
    if (change.notifyOwner) await notifyShipped(order, updated.trackingUrl, req.log);
    return updated;
  });
}