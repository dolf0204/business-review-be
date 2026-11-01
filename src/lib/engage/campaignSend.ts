import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { isLive } from "./live.js";
import { sendMail } from "./mail.js";
import { offerMailHtml } from "./offerMail.js";
import { unsubscribeKey } from "./unsubscribe.js";

export const MAX_RECIPIENTS = 1000;
const PARALLEL = 5;

type Log = Pick<FastifyBaseLogger, "info" | "error">;
type Sender = { name: string; code: string; contactEmail: string | null; theme: unknown };

export const subjectOf = (business: string, subject: string) => `${subject} · ${business}`;
export const fromName = (business: string) => `${business} via BusinessAsk`;

/** The address in a mail's unsubscribe link, and in the one-click header that mail programs show as an "Unsubscribe" button. */
const unsubscribeUrls = (membershipId: string) => {
  const key = unsubscribeKey(membershipId, config.JWT_SECRET);
  return { page: `${config.APP_URL}/unsubscribe?m=${membershipId}&t=${key}`, oneClick: `${config.PUBLIC_API_URL}/public/unsubscribe/${membershipId}/${key}` };
};

/** Writes down who gets this campaign: the guests who agreed to offers and confirmed their address, now. */
export async function createDeliveries(campaignId: string, businessId: string): Promise<number> {
  const members = await prisma.membership.findMany({
    where: { businessId, marketingOptInAt: { not: null }, guest: { emailVerifiedAt: { not: null } } },
    select: { id: true },
    take: MAX_RECIPIENTS,
  });
  await prisma.campaignDelivery.createMany({ data: members.map((m) => ({ campaignId, membershipId: m.id })), skipDuplicates: true });
  return members.length;
}

/**
 * Sends the mails of a campaign that are still waiting, a few at a time, and keeps the owner's counters up to date.
 * Each mail is claimed before it is sent, so two runs never send the same one, and a run that was cut off by a restart can simply be started again.
 */
export async function runCampaign(campaignId: string, business: Sender & { id: string }, log: Log) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status === "SENT") return;
  const color = (business.theme as { primary?: string } | null)?.primary;

  const tally = async () => {
    const rows = await prisma.campaignDelivery.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
    const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
    return { sentCount: n("SENT"), failedCount: n("FAILED") };
  };

  for (;;) {
    const batch = await prisma.campaignDelivery.findMany({
      where: { campaignId, status: "PENDING" },
      take: PARALLEL,
      select: { id: true, membership: { select: { id: true, marketingOptInAt: true, guest: { select: { email: true, lang: true, emailVerifiedAt: true } } } } },
    });
    if (!batch.length) break;
    await Promise.all(
      batch.map(async (d) => {
        const claimed = await prisma.campaignDelivery.updateMany({ where: { id: d.id, status: "PENDING" }, data: { status: "SENDING" } });
        if (claimed.count === 0) return;
        const { membership: m } = d;
        // Somebody who stopped the offers since the campaign was made gets nothing.
        if (!m.marketingOptInAt || !m.guest.emailVerifiedAt) {
          await prisma.campaignDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED" } });
          return;
        }
        const urls = unsubscribeUrls(m.id);
        try {
          await sendMail({
            to: m.guest.email,
            subject: subjectOf(business.name, campaign.subject),
            html: offerMailHtml({ lang: m.guest.lang, businessName: business.name, subject: campaign.subject, body: campaign.body, pageUrl: `${config.APP_URL}/b/${business.code}?s=e`, unsubscribeUrl: urls.page, color }),
            fromName: fromName(business.name),
            replyTo: business.contactEmail ?? undefined,
            headers: { "List-Unsubscribe": `<${urls.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          }, log);
          await prisma.campaignDelivery.update({ where: { id: d.id }, data: { status: "SENT" } });
        } catch (err) {
          await prisma.campaignDelivery.update({ where: { id: d.id }, data: { status: "FAILED" } });
          log.error({ err: (err as Error).message, toDomain: m.guest.email.split("@")[1] }, "offer email could not be sent");
        }
      }),
    );
    await prisma.campaign.update({ where: { id: campaign.id }, data: await tally() });
  }
  const done = await tally();
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENT", ...done, finishedAt: new Date() } });
  log.info({ campaignId, sent: done.sentCount, failed: done.failedCount }, "campaign finished");
}

/**
 * Called when the server starts: campaigns that were cut off by a restart carry on with the mails that had not gone out.
 * A mail that was being sent at the moment of the restart is not repeated, because nobody can tell whether it left; it counts as failed.
 */
export async function resumeCampaigns(log: Log) {
  const open = await prisma.campaign.findMany({
    where: { status: "SENDING" },
    select: { id: true, business: { select: { id: true, name: true, code: true, contactEmail: true, theme: true, publishedAt: true, paidUntil: true } } },
  });
  for (const c of open) {
    await prisma.campaignDelivery.updateMany({ where: { campaignId: c.id, status: "SENDING" }, data: { status: "FAILED" } });
    // A page that is no longer live sends no more offers.
    if (!isLive(c.business)) await prisma.campaignDelivery.updateMany({ where: { campaignId: c.id, status: "PENDING" }, data: { status: "SKIPPED" } });
    log.info({ campaignId: c.id }, "resuming campaign");
    void runCampaign(c.id, c.business, log).catch((err) => log.error({ err: (err as Error).message }, "campaign failed"));
  }
}
