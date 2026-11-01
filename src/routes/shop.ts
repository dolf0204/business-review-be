import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { billingConfigured, stripe } from "../billing/stripe.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { shipCountries } from "../lib/kit.js";
import { sendMail } from "../lib/mail.js";
import { freePeriodEnd, isShopKey, priceOrder, shopShippedMail, type PricedOrder } from "../lib/shop.js";
import { cancelShopOrder, fulfilShopOrder, SHOP_ORDER_METADATA } from "../lib/shopFulfil.js";
import { DESIGN_IDS, FINISHES, MAX_ITEMS_PER_ORDER, PRINT_TEXT_MAX, publicCatalog, SHOP_CURRENCY, SIZES, YEARLY_DISCOUNT_PERCENT } from "../lib/shopCatalog.js";
import { stripeGuard } from "../lib/stripeGuard.js";
import { idParam } from "../schemas.js";

const SESSION_PARAM = "shop_session";
const CANCELED_PARAM = "shop_canceled";
const UNIQUE_VIOLATION = "P2002";

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();

const itemsBody = z.array(z.object({ design: z.enum(DESIGN_IDS), finish: z.enum(FINISHES), size: z.enum(SIZES), printText: text(PRINT_TEXT_MAX) })).min(1).max(MAX_ITEMS_PER_ORDER);
const addressBody = z.object({ name: text(100), line1: text(120), line2: optional(120), postalCode: text(20), city: text(80), country: z.string().trim().toUpperCase().length(2), phone: optional(40) });
const orderParams = z.object({ id: z.uuid(), orderId: z.uuid() });
const operatorQuery = z.object({ id: z.uuid(), key: z.string().min(10).max(100) });

async function planFor(businessId: string) {
  const sub = await prisma.businessSubscription.findUnique({ where: { businessId } });
  const periodEnd = freePeriodEnd(sub, new Date());
  if (!periodEnd) return { yearly: false, periodEnd: null, freeAvailable: false };
  const used = await prisma.shopOrder.findFirst({ where: { businessId, freePeriodEnd: periodEnd, status: { not: "PENDING_PAYMENT" } }, select: { id: true } });
  return { yearly: true, periodEnd, freeAvailable: !used };
}

async function releasePending(businessId: string, log: { error: (o: object, m: string) => void }) {
  const pending = await prisma.shopOrder.findMany({ where: { businessId, status: "PENDING_PAYMENT" }, select: { id: true, stripeSessionId: true } });
  for (const p of pending) {
    try {
      if (p.stripeSessionId) await stripe().checkout.sessions.expire(p.stripeSessionId);
      await cancelShopOrder(p.id);
    } catch (err) {
      log.error({ orderId: p.id, err: (err as Error).message }, "an unpaid shop order could not be released");
    }
  }
}

const quoteView = (p: PricedOrder) => ({ items: p.items, subtotalCents: p.subtotalCents, shippingCents: p.shippingCents, totalCents: p.totalCents, freeApplied: p.freeApplied });

export async function shopRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };
  const create = { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } };
  const quick = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };
  const limit = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  r.get("/public/shop", quick, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return publicCatalog();
  });

  r.get("/businesses/:id/shop", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const plan = await planFor(b.id);
    const orders = await prisma.shopOrder.findMany({
      where: { businessId: b.id, status: { not: "CANCELED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, totalCents: true, trackingUrl: true, createdAt: true, shippedAt: true, items: { select: { design: true, finish: true, size: true, printText: true, unitCents: true } } },
    });
    return {
      available: !!config.KIT_ORDER_EMAIL,
      payOnline: billingConfigured(),
      countries: shipCountries(config.KIT_SHIP_COUNTRIES),
      yearly: plan.yearly,
      freeAvailable: plan.freeAvailable,
      discountPercent: plan.yearly ? YEARLY_DISCOUNT_PERCENT : 0,
      orders,
    };
  });

  r.post("/businesses/:id/shop/quote", { ...auth, ...quick, schema: { params: idParam, body: z.object({ items: itemsBody }) } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const plan = await planFor(b.id);
    return quoteView(priceOrder(req.body.items, plan));
  });

  r.post("/businesses/:id/shop/orders", { ...auth, ...create, schema: { params: idParam, body: z.object({ items: itemsBody, address: addressBody }) } }, async (req, reply) => {
    if (!config.KIT_ORDER_EMAIL) return reply.code(503).send({ error: "shop_unavailable" });
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const { items, address } = req.body;
    if (!shipCountries(config.KIT_SHIP_COUNTRIES).includes(address.country)) return reply.code(422).send({ error: "country_not_supported" });

    await releasePending(b.id, req.log);
    const plan = await planFor(b.id);
    const priced = priceOrder(items, plan);
    if (priced.totalCents > 0 && !billingConfigured()) return reply.code(503).send({ error: "billing_unavailable" });

    let order;
    try {
      order = await prisma.shopOrder.create({
        data: {
          businessId: b.id,
          freePeriodEnd: priced.freeApplied ? plan.periodEnd : null,
          subtotalCents: priced.subtotalCents,
          shippingCents: priced.shippingCents,
          totalCents: priced.totalCents,
          currency: SHOP_CURRENCY,
          name: address.name,
          line1: address.line1,
          line2: address.line2 ?? null,
          postalCode: address.postalCode,
          city: address.city,
          country: address.country,
          phone: address.phone ?? null,
          items: { create: priced.items.map((i) => ({ design: i.design, finish: i.finish, size: i.size, printText: i.printText, listCents: i.listCents, unitCents: i.unitCents })) },
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) return reply.code(409).send({ error: "free_stand_already_used" });
      throw err;
    }

    if (priced.totalCents === 0) {
      await fulfilShopOrder(order.id, req.log);
      return reply.code(201).send({ id: order.id, url: null });
    }

    return stripeGuard(req, reply, async () => {
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { email: true, stripeCustomerId: true } });
      const lineItems = priced.items
        .filter((i) => i.unitCents > 0)
        .map((i) => ({
          quantity: 1,
          price_data: { currency: SHOP_CURRENCY, unit_amount: i.unitCents, product_data: { name: `Handmade stand ${i.design} (${i.size}, ${i.finish})`, description: `Engraved: ${i.printText}` } },
        }));
      if (priced.shippingCents > 0) {
        lineItems.push({ quantity: 1, price_data: { currency: SHOP_CURRENCY, unit_amount: priced.shippingCents, product_data: { name: "Shipping", description: address.country } } });
      }
      const session = await stripe().checkout.sessions.create({
        mode: "payment",
        ...(owner.stripeCustomerId ? { customer: owner.stripeCustomerId } : { customer_email: owner.email }),
        client_reference_id: order.id,
        metadata: { [SHOP_ORDER_METADATA]: order.id },
        line_items: lineItems,
        success_url: `${config.APP_URL}/businesses/${b.id}?${SESSION_PARAM}={CHECKOUT_SESSION_ID}&order=${order.id}`,
        cancel_url: `${config.APP_URL}/businesses/${b.id}?${CANCELED_PARAM}=1`,
      });
      await prisma.shopOrder.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });
      return reply.code(201).send({ id: order.id, url: session.url });
    });
  });

  r.post("/businesses/:id/shop/orders/:orderId/confirm", { ...auth, ...quick, schema: { params: orderParams, body: z.object({ sessionId: z.string().min(10).max(200) }) } }, async (req, reply) => {
    if (!billingConfigured()) return reply.code(503).send({ error: "billing_unavailable" });
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const order = await prisma.shopOrder.findFirst({ where: { id: req.params.orderId, businessId: b.id }, select: { id: true, status: true, stripeSessionId: true } });
    if (!order) return reply.code(404).send({ error: "not_found" });
    if (order.stripeSessionId !== req.body.sessionId) return reply.code(403).send({ error: "forbidden" });
    if (order.status !== "PENDING_PAYMENT") return { ok: true };
    return stripeGuard(req, reply, async () => {
      const session = await stripe().checkout.sessions.retrieve(req.body.sessionId);
      if (session.payment_status !== "paid") return reply.code(202).send({ ok: false, pending: true });
      await fulfilShopOrder(order.id, req.log, session.amount_total ?? undefined);
      return { ok: true };
    });
  });

  r.get("/public/operator/shop", { ...limit, schema: { querystring: operatorQuery } }, async (req, reply) => {
    if (!isShopKey(req.query.key, req.query.id, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const o = await prisma.shopOrder.findUnique({
      where: { id: req.query.id },
      include: { items: { select: { design: true, size: true, finish: true, printText: true } }, business: { select: { name: true } } },
    });
    if (!o) return reply.code(404).send({ error: "not_found" });
    return { business: o.business.name, name: o.name, city: o.city, country: o.country, status: o.status, items: o.items };
  });

  r.post("/public/operator/shop/shipped", {
    ...limit,
    schema: { body: operatorQuery.extend({ trackingUrl: z.url({ protocol: /^https?$/ }).max(500).nullable().optional() }) },
  }, async (req, reply) => {
    const { id, key, trackingUrl } = req.body;
    if (!isShopKey(key, id, config.JWT_SECRET)) return reply.code(400).send({ error: "invalid_link" });
    const o = await prisma.shopOrder.findUnique({ where: { id }, include: { business: { select: { name: true, ownerId: true } } } });
    if (!o) return reply.code(404).send({ error: "not_found" });
    if (o.status === "PENDING_PAYMENT" || o.status === "CANCELED") return reply.code(409).send({ error: "order_not_paid" });
    if (o.status !== "SHIPPED") {
      await prisma.shopOrder.update({ where: { id }, data: { status: "SHIPPED", shippedAt: new Date(), trackingUrl: trackingUrl ?? null } });
      const owner = await prisma.user.findUnique({ where: { id: o.business.ownerId }, select: { email: true } });
      if (owner) await sendMail({ to: owner.email, ...shopShippedMail(o.business.name, trackingUrl ?? null) }, req.log).catch((err) => req.log.error({ err: (err as Error).message }, "shop shipped email could not be sent"));
    }
    return { ok: true };
  });
}