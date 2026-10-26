import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { billingConfigured, loadPrices, priceIds, stripe, syncSubscription } from "../billing/stripe.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { stripeGuard } from "../lib/stripeGuard.js";
import { idParam } from "../schemas.js";

const strict = { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } };
const interval = z.enum(["MONTH", "YEAR"]);

/** Paying for a business's page. Everything about money is decided here: the browser only says which of the two prices it wants. */
export async function billingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };

  // The two prices for the home page, read from Stripe (never written in our code). No prices when billing is off or Stripe cannot be reached.
  r.get("/public/pricing", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=300");
    if (!billingConfigured()) return { prices: [] };
    try {
      return { prices: await loadPrices() };
    } catch {
      return { prices: [] };
    }
  });

  r.get("/businesses/:id/billing", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const sub = await prisma.businessSubscription.findUnique({ where: { businessId: b.id } });
    const available = billingConfigured();
    let prices: Awaited<ReturnType<typeof loadPrices>> = [];
    if (available) {
      try {
        prices = await loadPrices();
      } catch (err) {
        req.log.error({ err: (err as Error).message }, "prices could not be read from Stripe");
      }
    }
    return {
      available: available && prices.length > 0,
      paid: !!b.paidUntil && b.paidUntil > new Date(),
      paidUntil: b.paidUntil,
      status: sub?.status ?? null,
      interval: sub?.interval ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      canManage: !!sub?.stripeSubscriptionId,
      trialDays: config.TRIAL_DAYS,
      prices,
    };
  });

  r.post("/businesses/:id/billing/checkout", { ...auth, ...strict, schema: { params: idParam, body: z.object({ interval }) } }, async (req, reply) => {
    if (!billingConfigured()) return reply.code(503).send({ error: "billing_unavailable" });
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    // One subscription per business. Changing the plan goes through the Stripe customer portal.
    const existing = await prisma.businessSubscription.findUnique({ where: { businessId: b.id } });
    if (existing?.stripeSubscriptionId && existing.status !== "CANCELED") return reply.code(409).send({ error: "already_subscribed" });

    return stripeGuard(req, reply, async () => {
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { email: true, stripeCustomerId: true } });
      let customerId = owner.stripeCustomerId;
      if (!customerId) {
        customerId = (await stripe().customers.create({ email: owner.email, metadata: { userId: req.user.sub } })).id;
        await prisma.user.update({ where: { id: req.user.sub }, data: { stripeCustomerId: customerId } });
      }
      const session = await stripe().checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: b.id,
        line_items: [{ price: priceIds()[req.body.interval], quantity: 1 }],
        // Redirect targets come from config, never from the request.
        success_url: `${config.APP_URL}/businesses/${b.id}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.APP_URL}/businesses/${b.id}?canceled=1`,
        allow_promotion_codes: true,
        subscription_data: { metadata: { businessId: b.id }, ...(config.TRIAL_DAYS > 0 ? { trial_period_days: config.TRIAL_DAYS } : {}) },
        ...(config.STRIPE_AUTOMATIC_TAX
          ? { automatic_tax: { enabled: true }, billing_address_collection: "required" as const, customer_update: { address: "auto" as const, name: "auto" as const } }
          : {}),
      });
      return { url: session.url };
    });
  });

  // Called by the page the owner returns to, so it flips at once without waiting for the webhook.
  r.post("/businesses/:id/billing/confirm", { ...auth, ...strict, schema: { params: idParam, body: z.object({ sessionId: z.string().min(10).max(200) }) } }, async (req, reply) => {
    if (!billingConfigured()) return reply.code(503).send({ error: "billing_unavailable" });
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    return stripeGuard(req, reply, async () => {
      const session = await stripe().checkout.sessions.retrieve(req.body.sessionId);
      // A session of another business must not switch this one on.
      if (session.client_reference_id !== b.id) return reply.code(403).send({ error: "forbidden" });
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (session.status !== "complete" || !subId) return reply.code(202).send({ ok: false, pending: true });
      await syncSubscription(subId);
      return { ok: true };
    });
  });

  r.post("/businesses/:id/billing/portal", { ...auth, ...strict, schema: { params: idParam } }, async (req, reply) => {
    if (!billingConfigured()) return reply.code(503).send({ error: "billing_unavailable" });
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const owner = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { stripeCustomerId: true } });
    if (!owner?.stripeCustomerId) return reply.code(409).send({ error: "no_billing_account" });
    const customer = owner.stripeCustomerId;
    return stripeGuard(req, reply, async () => {
      const portal = await stripe().billingPortal.sessions.create({
        customer,
        return_url: `${config.APP_URL}/businesses/${b.id}`,
        ...(config.STRIPE_PORTAL_CONFIGURATION ? { configuration: config.STRIPE_PORTAL_CONFIGURATION } : {}),
      });
      return { url: portal.url };
    });
  });
}

// Needs the raw request body to verify Stripe's signature, so it lives in its own encapsulated scope.
export async function stripeWebhookRoutes(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/stripe/webhook", { config: { rateLimit: false } }, async (req, reply) => {
    const signature = req.headers["stripe-signature"];
    if (!config.STRIPE_WEBHOOK_SECRET || typeof signature !== "string") return reply.code(400).send({ error: "bad_request" });

    let event;
    try {
      event = stripe().webhooks.constructEvent(req.body as Buffer, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.code(400).send({ error: "invalid_signature" });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
        if (s.mode === "subscription" && subId) await syncSubscription(subId);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object.id);
        break;
      default:
        break; // other events are not needed
    }
    return { received: true };
  });
}
