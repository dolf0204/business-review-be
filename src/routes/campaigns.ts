import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { isLive } from "../lib/live.js";
import { sendMail } from "../lib/mail.js";
import { offerMailHtml } from "../lib/offerMail.js";
import { isUnsubscribeKey, unsubscribeKey } from "../lib/unsubscribe.js";
import { idParam } from "../schemas.js";

export const MAX_CAMPAIGNS_PERIOD_DAYS = 7;
export const MAX_RECIPIENTS = 1000;
const PARALLEL = 5;
const DAY = 24 * 60 * 60 * 1000;

const subjectOf = (business: string, subject: string) => `${subject} · ${business}`;
const fromName = (business: string) => `${business} via BusinessAsk`;

/** The address in a mail's unsubscribe link, and in the one-click header that mail programs show as an "Unsubscribe" button. */
const unsubscribeUrls = (membershipId: string) => {
  const key = unsubscribeKey(membershipId, config.JWT_SECRET);
  return { page: `${config.APP_URL}/unsubscribe?m=${membershipId}&t=${key}`, oneClick: `${config.PUBLIC_API_URL}/public/unsubscribe/${membershipId}/${key}` };
};

type Sender = { name: string; code: string; contactEmail: string | null; theme: unknown };

/** Sends one campaign to the guests who agreed to receive offers and still have a confirmed address. Updates the counters as it goes. */
export async function runCampaign(campaignId: string, business: Sender & { id: string }, log: Pick<FastifyBaseLogger, "info" | "error">) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;
  const members = await prisma.membership.findMany({
    where: { businessId: business.id, marketingOptInAt: { not: null }, guest: { emailVerifiedAt: { not: null } } },
    select: { id: true, guest: { select: { email: true, lang: true } } },
    take: MAX_RECIPIENTS,
  });
  const color = (business.theme as { primary?: string } | null)?.primary;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < members.length; i += PARALLEL) {
    await Promise.all(
      members.slice(i, i + PARALLEL).map(async (m) => {
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
          sent++;
        } catch (err) {
          failed++;
          log.error({ err: (err as Error).message, toDomain: m.guest.email.split("@")[1] }, "offer email could not be sent");
        }
      }),
    );
    await prisma.campaign.update({ where: { id: campaign.id }, data: { sentCount: sent, failedCount: failed } });
  }
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENT", sentCount: sent, failedCount: failed, finishedAt: new Date() } });
  log.info({ campaignId, sent, failed }, "campaign finished");
}

export async function campaignRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };
  const body = z.object({ subject: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(1000) });

  r.get("/businesses/:id/campaigns", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const [campaigns, audience] = await Promise.all([
      prisma.campaign.findMany({ where: { businessId: b.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.membership.count({ where: { businessId: b.id, marketingOptInAt: { not: null }, guest: { emailVerifiedAt: { not: null } } } }),
    ]);
    const last = campaigns[0];
    const nextAt = last ? new Date(last.createdAt.getTime() + MAX_CAMPAIGNS_PERIOD_DAYS * DAY) : null;
    return { campaigns, audience, nextSendAt: nextAt && nextAt > new Date() ? nextAt : null };
  });

  // A preview mail to the owner's own address. It does not count against the weekly limit.
  r.post("/businesses/:id/campaigns/test", { ...auth, schema: { params: idParam, body }, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const owner = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { email: true, uiLang: true } });
    if (!owner) return reply.code(404).send({ error: "not_found" });
    await sendMail({
      to: owner.email,
      subject: `[Test] ${subjectOf(b.name, req.body.subject)}`,
      html: offerMailHtml({ lang: owner.uiLang, businessName: b.name, subject: req.body.subject, body: req.body.body, pageUrl: `${config.APP_URL}/b/${b.code}`, unsubscribeUrl: `${config.APP_URL}/unsubscribe`, color: (b.theme as { primary?: string }).primary, test: true }),
      fromName: fromName(b.name),
    }, req.log);
    return { ok: true };
  });

  r.post("/businesses/:id/campaigns", { ...auth, schema: { params: idParam, body }, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    if (!isLive(b)) return reply.code(422).send({ error: "not_published" });
    const since = new Date(Date.now() - MAX_CAMPAIGNS_PERIOD_DAYS * DAY);
    if ((await prisma.campaign.count({ where: { businessId: b.id, createdAt: { gte: since } } })) > 0) return reply.code(429).send({ error: "campaign_limit_week" });
    const audience = await prisma.membership.count({ where: { businessId: b.id, marketingOptInAt: { not: null }, guest: { emailVerifiedAt: { not: null } } } });
    if (audience === 0) return reply.code(422).send({ error: "no_recipients" });
    const campaign = await prisma.campaign.create({ data: { businessId: b.id, subject: req.body.subject, body: req.body.body, recipients: Math.min(audience, MAX_RECIPIENTS) } });
    // The mails go out after the answer, a few at a time; the owner sees the progress in the list.
    void runCampaign(campaign.id, b, req.log).catch((err) => req.log.error({ err: (err as Error).message }, "campaign failed"));
    return reply.code(202).send(campaign);
  });

  // ---- unsubscribing: no login, the key in the link is the proof ----
  // Mail programs send the one-click request as a small form; its content does not matter, the address is the proof.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, _body, done) => done(null, {}));

  const stop = async (membershipId: string, key: string) => {
    if (!isUnsubscribeKey(key, membershipId, config.JWT_SECRET)) return null;
    const m = await prisma.membership.findUnique({ where: { id: membershipId }, select: { id: true, business: { select: { name: true } } } });
    if (!m) return null;
    await prisma.membership.update({ where: { id: m.id }, data: { marketingOptInAt: null } });
    return m.business.name;
  };
  const limit = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  r.post("/public/unsubscribe", { ...limit, schema: { body: z.object({ m: z.uuid(), t: z.string().min(10).max(100) }) } }, async (req, reply) => {
    const business = await stop(req.body.m, req.body.t);
    return business ? { ok: true, business } : reply.code(400).send({ error: "invalid_link" });
  });

  // What a mail program calls when the reader presses its own "Unsubscribe" button (RFC 8058 one-click).
  r.post("/public/unsubscribe/:m/:t", { ...limit, schema: { params: z.object({ m: z.uuid(), t: z.string().min(10).max(100) }) } }, async (req, reply) => {
    const business = await stop(req.params.m, req.params.t);
    return business ? { ok: true } : reply.code(400).send({ error: "invalid_link" });
  });
}
