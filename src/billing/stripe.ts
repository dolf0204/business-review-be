import Stripe from "stripe";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { statusFromStripe, toIntervalFromStripe } from "./map.js";

export const priceIds = () => ({ MONTH: config.STRIPE_PRICE_MONTHLY, YEAR: config.STRIPE_PRICE_YEARLY });
export const billingConfigured = () => !!config.STRIPE_SECRET_KEY && !!config.STRIPE_PRICE_MONTHLY && !!config.STRIPE_PRICE_YEARLY;

let client: Stripe | null = null;
export function stripe(): Stripe {
  client ??= new Stripe(config.STRIPE_SECRET_KEY);
  return client;
}

export interface PriceInfo {
  interval: "MONTH" | "YEAR";
  amountCents: number;
  currency: string;
}

let cached: { at: number; prices: PriceInfo[] } | null = null;
const TEN_MINUTES = 10 * 60 * 1000;

/** What the two prices cost, read from Stripe so the dashboard is the only place a price is ever written. */
export async function loadPrices(now = Date.now()): Promise<PriceInfo[]> {
  if (cached && now - cached.at < TEN_MINUTES) return cached.prices;
  const prices: PriceInfo[] = [];
  for (const [interval, id] of Object.entries(priceIds()) as ["MONTH" | "YEAR", string][]) {
    const p = await stripe().prices.retrieve(id);
    if (p.unit_amount !== null) prices.push({ interval, amountCents: p.unit_amount, currency: p.currency });
  }
  cached = { at: now, prices };
  return prices;
}
export const clearPriceCache = () => {
  cached = null;
};

/**
 * Stripe is the source of truth. Webhooks can arrive late or out of order, so every event only asks Stripe for the current
 * state of the subscription and stores that. A business that is no longer paid is taken off the guests' screens.
 */
export async function syncSubscription(stripeSubscriptionId: string) {
  const sub = await stripe().subscriptions.retrieve(stripeSubscriptionId);
  const businessId = sub.metadata.businessId;
  if (!businessId) return null;
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!business) return null;

  const item = sub.items.data[0];
  const status = statusFromStripe(sub.status);
  const end = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const paid = status !== "CANCELED" && end !== null && end > new Date();
  const data = { stripeSubscriptionId: status === "CANCELED" ? null : sub.id, status, interval: toIntervalFromStripe(item?.price.recurring?.interval), currentPeriodEnd: end, cancelAtPeriodEnd: sub.cancel_at_period_end };
  await prisma.businessSubscription.upsert({ where: { businessId }, create: { businessId, ...data }, update: data });
  // Not paid any more: the page goes off the guests' screens now (the owner publishes it again after paying).
  await prisma.business.update({ where: { id: businessId }, data: paid ? { paidUntil: end } : { paidUntil: null, publishedAt: null } });
  return { businessId, paid };
}
