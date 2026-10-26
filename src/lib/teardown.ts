import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import Stripe from "stripe";
import { billingConfigured, stripe } from "../billing/stripe.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * Ends the Stripe subscriptions of these businesses at once. This has to succeed before any data is deleted:
 * a deleted business with a live subscription would keep charging its owner.
 */
export async function cancelBilling(businessIds: string[]): Promise<void> {
  if (!businessIds.length) return;
  const subs = await prisma.businessSubscription.findMany({ where: { businessId: { in: businessIds }, stripeSubscriptionId: { not: null } }, select: { stripeSubscriptionId: true } });
  if (!subs.length) return;
  if (!billingConfigured()) throw new Error("billing_not_configured");
  for (const s of subs) {
    try {
      await stripe().subscriptions.cancel(s.stripeSubscriptionId!);
    } catch (e) {
      // Already gone on Stripe's side is the state we want.
      if (e instanceof Stripe.errors.StripeError && e.code === "resource_missing") continue;
      throw e;
    }
  }
}

/** Removes uploaded picture files from the disk. A file that is already gone is not an error. */
export async function removeFiles(filenames: string[]): Promise<void> {
  for (const f of filenames) await unlink(join(resolve(config.UPLOAD_DIR), f)).catch(() => undefined);
}
