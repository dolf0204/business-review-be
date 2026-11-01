import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { Business, Coupon } from "../generated/prisma/client.js";
import { takeCheckSlot } from "./checkLimit.js";
import { checkBusinessContent, checkCouponContent, checkSpelling, contentCheckEnabled } from "./contentCheck.js";
import { sendMail } from "./mail.js";
import { acceptableFixes, type Fixes } from "./textFixes.js";
import { couponReviewKey, couponReviewMail, operatorList, reviewKey, reviewMail } from "./operator.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

/** Tell the operators that a business needs to be looked at. A mail problem is logged, never shown to the owner. */
export async function requestApproval(b: Pick<Business, "id" | "name" | "offerText" | "address" | "googleMapsUrl" | "ownerId">, changed: boolean, log: Log, note?: string) {
  const to = operatorList(config.OPERATOR_EMAILS);
  if (!to.length) return;
  const owner = await prisma.user.findUnique({ where: { id: b.ownerId }, select: { email: true } });
  const link = `${config.APP_URL}/operator/review?b=${b.id}&k=${reviewKey(b.id, config.JWT_SECRET)}`;
  const mail = reviewMail({ name: b.name, offerText: b.offerText, address: b.address, googleMapsUrl: b.googleMapsUrl, ownerEmail: owner?.email ?? "(unknown)", link, changed, note });
  for (const address of to) {
    try {
      await sendMail({ to: address, ...mail }, log);
    } catch (err) {
      log.error({ err: (err as Error).message, toDomain: address.split("@")[1] }, "operator email could not be sent");
    }
  }
}

async function approve(b: Business): Promise<Business> {
  return prisma.business.update({ where: { id: b.id }, data: { approvedAt: new Date() } });
}

export interface BusinessReview {
  business: Business;
  fixes: Fixes;
}

async function runReview(b: Business, changed: boolean, log: Log): Promise<BusinessReview> {
  if (!contentCheckEnabled()) {
    await requestApproval(b, changed, log);
    return { business: b, fixes: {} };
  }
  try {
    const text = { name: b.name, kind: b.kind, subtitle: b.subtitle, offerText: b.offerText, address: b.address, websiteUrl: b.websiteUrl };
    const proposed = await checkSpelling(text).catch((err) => {
      log.warn({ businessId: b.id, err: (err as Error).message }, "spelling check failed");
      return {};
    });
    const fixes = acceptableFixes({ name: b.name, subtitle: b.subtitle, offerText: b.offerText }, proposed);
    const result = await checkBusinessContent({ ...text, ...fixes });
    log.info({ businessId: b.id, verdict: result.verdict, reason: result.reason, proposed: Object.keys(proposed), fixes: Object.keys(fixes) }, "automatic check of a business");
    if (result.verdict === "ok") return { business: await approve(b), fixes };
    await requestApproval(b, changed, log, result.reason);
    return { business: b, fixes };
  } catch (err) {
    log.error({ businessId: b.id, err: (err as Error).message }, "automatic check failed, sending to the operators");
    await requestApproval(b, changed, log, "The automatic check could not run.");
    return { business: b, fixes: {} };
  }
}

/**
 * Checks a business that asks to be shown to tourists. A clean one is approved at once; one the check flags, or cannot check,
 * goes to the operators. The check never rejects anyone: only a person does that. Returns the business as it is afterwards.
 */
export async function reviewBusiness(b: Business, changed: boolean, log: Log): Promise<Business> {
  return (await runReview(b, changed, log)).business;
}

export async function recheckBusiness(b: Business, log: Log): Promise<BusinessReview> {
  if (!takeCheckSlot(b.id)) {
    log.warn({ businessId: b.id }, "too many checks for one business, skipped until the hour is over");
    return { business: b, fixes: {} };
  }
  return runReview(b, true, log);
}

type CouponOwner = Pick<Business, "name" | "kind" | "ownerId">;

async function holdCoupon(c: Coupon, b: CouponOwner, log: Log, note?: string) {
  try {
    const to = operatorList(config.OPERATOR_EMAILS);
    if (!to.length) return;
    const owner = await prisma.user.findUnique({ where: { id: b.ownerId }, select: { email: true } });
    const link = `${config.APP_URL}/operator/review?c=${c.id}&k=${couponReviewKey(c.id, config.JWT_SECRET)}`;
    const mail = couponReviewMail({ businessName: b.name, title: c.title, description: c.description, ownerEmail: owner?.email ?? "(unknown)", link, note });
    for (const address of to) {
      await sendMail({ to: address, ...mail }, log).catch((err) => log.error({ err: (err as Error).message, toDomain: address.split("@")[1] }, "operator email could not be sent"));
    }
  } catch (err) {
    log.error({ couponId: c.id, err: (err as Error).message }, "a coupon could not be sent to the operators");
  }
}

export async function reviewCoupon(c: Coupon, b: CouponOwner, log: Log): Promise<Coupon> {
  if (!contentCheckEnabled()) {
    await holdCoupon(c, b, log);
    return c;
  }
  try {
    const result = await checkCouponContent({ businessName: b.name, kind: b.kind, title: c.title, description: c.description });
    log.info({ couponId: c.id, verdict: result.verdict, reason: result.reason }, "automatic check of a coupon");
    if (result.verdict === "ok") return await prisma.coupon.update({ where: { id: c.id }, data: { clearedAt: new Date() } });
    await holdCoupon(c, b, log, result.reason);
  } catch (err) {
    log.error({ couponId: c.id, err: (err as Error).message }, "automatic check of a coupon failed, sending to the operators");
    await holdCoupon(c, b, log, "The automatic check could not run.");
  }
  return c;
}

/** Fields that change what TouristAsk guests read about a business. Changing them after approval needs a new check. */
export const REVIEWED_FIELDS = ["name", "offerText", "subtitle"] as const;