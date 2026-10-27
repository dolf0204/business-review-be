import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { Business } from "../generated/prisma/client.js";
import { checkBusinessContent, contentCheckEnabled } from "./contentCheck.js";
import { sendMail } from "./mail.js";
import { operatorList, reviewKey, reviewMail } from "./operator.js";

type Log = Pick<FastifyBaseLogger, "info" | "error">;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

async function approve(b: Business, log: Log): Promise<Business> {
  const approved = await prisma.business.update({ where: { id: b.id }, data: { approvedAt: new Date() } });
  const owner = await prisma.user.findUnique({ where: { id: b.ownerId }, select: { email: true } });
  if (owner) {
    await sendMail({ to: owner.email, subject: `${b.name} is approved`, html: `<p>Good news: <strong>${esc(b.name)}</strong> is approved and can now be shown to tourists on TouristAsk.</p>` }, log).catch((err) =>
      log.error({ err: (err as Error).message }, "approval email could not be sent"),
    );
  }
  return approved;
}

/**
 * Checks a business that asks to be shown to tourists. A clean one is approved at once; one the check flags, or cannot check,
 * goes to the operators. The check never rejects anyone: only a person does that. Returns the business as it is afterwards.
 */
export async function reviewBusiness(b: Business, changed: boolean, log: Log): Promise<Business> {
  if (!contentCheckEnabled()) {
    await requestApproval(b, changed, log);
    return b;
  }
  try {
    const result = await checkBusinessContent({ name: b.name, kind: b.kind, subtitle: b.subtitle, offerText: b.offerText, address: b.address, websiteUrl: b.websiteUrl });
    log.info({ businessId: b.id, verdict: result.verdict, reason: result.reason }, "automatic check of a business");
    if (result.verdict === "ok") return await approve(b, log);
    await requestApproval(b, changed, log, result.reason);
  } catch (err) {
    log.error({ businessId: b.id, err: (err as Error).message }, "automatic check failed, sending to the operators");
    await requestApproval(b, changed, log, "The automatic check could not run.");
  }
  return b;
}

/** Fields that change what TouristAsk guests read about a business. Changing them after approval needs a new check. */
export const REVIEWED_FIELDS = ["name", "offerText", "subtitle"] as const;