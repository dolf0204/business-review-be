import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { isNewVisitDay, nextStep, platformState, type PlatformState, type PromptRow } from "../lib/reviews.js";
import { idParam } from "../schemas.js";
import { guestOf } from "./guests.js";

const code = z.string().min(4).max(32);
const platform = z.enum(["google", "tripadvisor"]);
const toDb = (p: "google" | "tripadvisor") => (p === "google" ? ("GOOGLE" as const) : ("TRIPADVISOR" as const));

type Membership = { id: string; visits: number; reviewPrompts: { platform: "GOOGLE" | "TRIPADVISOR"; status: "DONE" | "DECLINED"; declinedAtVisit: number }[] };

/** What the page should ask this guest now. Tripadvisor is null when the business has no Tripadvisor link. */
export function reviewState(m: Membership, hasTripadvisor: boolean) {
  const row = (p: "GOOGLE" | "TRIPADVISOR"): PromptRow | undefined => m.reviewPrompts.find((r) => r.platform === p);
  const google: PlatformState = platformState(row("GOOGLE"), m.visits);
  const tripadvisor: PlatformState | null = hasTripadvisor ? platformState(row("TRIPADVISOR"), m.visits) : null;
  return { visits: m.visits, google, tripadvisor, step: nextStep(google, tripadvisor) };
}

const withPrompts = { reviewPrompts: { select: { platform: true, status: true, declinedAtVisit: true } } } as const;

export async function reviewRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function memberOf(req: FastifyRequest, businessCode: string) {
    const guest = await guestOf(app, req);
    if (!guest) return { ok: false as const, status: 401 as const };
    const business = await prisma.business.findUnique({ where: { code: businessCode }, select: { id: true, publishedAt: true, tripadvisorReviewUrl: true } });
    if (!business || !business.publishedAt) return { ok: false as const, status: 404 as const };
    const membership = await prisma.membership.findUnique({ where: { guestId_businessId: { guestId: guest.id, businessId: business.id } }, include: withPrompts });
    if (!membership) return { ok: false as const, status: 403 as const };
    return { ok: true as const, guest, business, membership };
  }

  // The guest opened the page: count the visit (once a day) and say what to ask.
  r.post("/guest/b/:code/visit", { schema: { params: z.object({ code }) }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const found = await memberOf(req, req.params.code);
    if (!found.ok) return reply.code(found.status).send({ error: found.status === 401 ? "unauthenticated" : found.status === 403 ? "not_member" : "not_found" });
    const { membership, business } = found;
    const now = new Date();
    let current = membership;
    if (isNewVisitDay(membership.lastVisitAt, now)) {
      current = await prisma.membership.update({ where: { id: membership.id }, data: { visits: { increment: 1 }, lastVisitAt: now }, include: withPrompts });
    }
    return reviewState(current, !!business.tripadvisorReviewUrl);
  });

  // "No thanks": ask again after a few more visits.
  r.post("/guest/b/:code/review/:platform/decline", { schema: { params: z.object({ code, platform }) } }, async (req, reply) => {
    const found = await memberOf(req, req.params.code);
    if (!found.ok) return reply.code(found.status).send({ error: found.status === 401 ? "unauthenticated" : found.status === 403 ? "not_member" : "not_found" });
    const { membership, business } = found;
    const p = toDb(req.params.platform);
    // A review that was already left is never turned back into a "no".
    const existing = membership.reviewPrompts.find((x) => x.platform === p);
    if (existing?.status !== "DONE") {
      await prisma.reviewPrompt.upsert({
        where: { membershipId_platform: { membershipId: membership.id, platform: p } },
        create: { membershipId: membership.id, platform: p, status: "DECLINED", declinedAtVisit: membership.visits },
        update: { status: "DECLINED", declinedAtVisit: membership.visits },
      });
    }
    const rows = [...membership.reviewPrompts.filter((x) => x.platform !== p), ...(existing?.status === "DONE" ? [existing] : [{ platform: p, status: "DECLINED" as const, declinedAtVisit: membership.visits }])];
    return reviewState({ ...membership, reviewPrompts: rows }, !!business.tripadvisorReviewUrl);
  });

  // The review link. Following it counts as a review left; the guest is then sent on to Google or Tripadvisor.
  // The target comes only from our own database, never from the address, so this cannot be used as an open redirect.
  r.get("/r/:code/:platform", { schema: { params: z.object({ code, platform }) }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const business = await prisma.business.findUnique({ where: { code: req.params.code }, select: { id: true, publishedAt: true, googleReviewUrl: true, tripadvisorReviewUrl: true } });
    const target = req.params.platform === "google" ? business?.googleReviewUrl : business?.tripadvisorReviewUrl;
    if (!business || !business.publishedAt || !target) return reply.code(404).send({ error: "not_found" });
    const guest = await guestOf(app, req);
    if (guest) {
      const m = await prisma.membership.findUnique({ where: { guestId_businessId: { guestId: guest.id, businessId: business.id } }, select: { id: true } });
      if (m) {
        const p = toDb(req.params.platform);
        await prisma.reviewPrompt.upsert({
          where: { membershipId_platform: { membershipId: m.id, platform: p } },
          create: { membershipId: m.id, platform: p, status: "DONE" },
          update: { status: "DONE" },
        });
      }
    }
    reply.header("cache-control", "no-store");
    return reply.redirect(target, 302);
  });

  // Numbers for the business owner.
  r.get("/businesses/:id/stats", { onRequest: [app.authenticate], schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const [members, offers, visits, google, tripadvisor] = await Promise.all([
      prisma.membership.count({ where: { businessId: b.id } }),
      prisma.membership.count({ where: { businessId: b.id, marketingOptInAt: { not: null } } }),
      prisma.membership.aggregate({ where: { businessId: b.id }, _sum: { visits: true } }),
      prisma.reviewPrompt.count({ where: { membership: { businessId: b.id }, platform: "GOOGLE", status: "DONE" } }),
      prisma.reviewPrompt.count({ where: { membership: { businessId: b.id }, platform: "TRIPADVISOR", status: "DONE" } }),
    ]);
    return { members, offersOptIn: offers, visits: visits._sum.visits ?? 0, googleReviewClicks: google, tripadvisorReviewClicks: tripadvisor };
  });
}
