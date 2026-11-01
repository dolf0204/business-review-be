import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { liveWhere } from "../lib/live.js";
import { boundingBox, distanceKm } from "../lib/geo.js";
import { kindsShownAs, partnerKind } from "../lib/partnerKinds.js";
import { couponLeft, couponOpen, MAX_COUPONS_PER_BUSINESS } from "./coupons.js";

const MAX_RADIUS_KM = 50;
const DEFAULT_RADIUS_KM = 25;
const MAX_RESULTS = 500;

const keys = () => config.PARTNER_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean);

export function isPartnerKey(given: string | undefined): boolean {
  if (!given) return false;
  const g = Buffer.from(given);
  return keys().some((k) => {
    const b = Buffer.from(k);
    return b.length === g.length && timingSafeEqual(b, g);
  });
}

const MAX_COUPONS_IN_FEED = 3;
/**
 * The feed TouristAsk reads to show sponsors: published and approved businesses within a radius of a guide.
 * Server to server only: it needs a key from PARTNER_API_KEYS.
 */
export async function partnerRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/partners", {
    schema: {
      querystring: z.object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(1).max(MAX_RADIUS_KM).default(DEFAULT_RADIUS_KM),
        kind: z.string().max(20).optional(),
      }),
    },
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    if (!isPartnerKey(req.headers["x-api-key"] as string | undefined)) return reply.code(401).send({ error: "unauthorized" });
    const { lat, lng, radiusKm, kind } = req.query;
    const now = new Date();
    const box = boundingBox({ lat, lng }, radiusKm);
    const rows = await prisma.business.findMany({
      where: {
        ...liveWhere(),
        approvedAt: { not: null },
        ...(kind ? { kind: { in: kindsShownAs(kind) } } : {}),
        lat: { gte: box.minLat, lte: box.maxLat },
        lng: { gte: box.minLng, lte: box.maxLng },
      },
      take: MAX_RESULTS,
      // Coupons are read with the businesses in one query; which of them are open now is decided below.
      include: { coupons: { where: { active: true, clearedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: MAX_COUPONS_PER_BUSINESS, include: { _count: { select: { uses: true } } } } },
    });
    const partners = rows
      .flatMap((b) => (b.lat === null || b.lng === null ? [] : [{ b, km: distanceKm({ lat, lng }, { lat: b.lat, lng: b.lng }) }]))
      .filter((x) => x.km <= radiusKm)
      .sort((a, c) => a.km - c.km)
      .map(({ b, km }) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        kind: partnerKind(b.kind),
        tagline: b.subtitle,
        offerText: b.offerText,
        address: b.address,
        lat: b.lat,
        lng: b.lng,
        distanceKm: Math.round(km * 10) / 10,
        imageUrl: b.logoUrl,
        rating: b.rating,
        ratingCount: b.ratingCount,
        websiteUrl: b.websiteUrl,
        googleMapsUrl: b.googleMapsUrl,
        googleReviewUrl: b.googleReviewUrl,
        // Coupons that are switched on and inside their dates; one that has expired is not sent. At most a few, so a card stays short.
        coupons: b.coupons
          .filter((c) => couponOpen(c, now) && couponLeft(c.maxUses, c._count.uses) !== 0)
          .slice(0, MAX_COUPONS_IN_FEED)
          .map((c) => ({ id: c.id, title: c.title, description: c.description, endsAt: c.endsAt })),
        pageUrl: `${config.APP_URL}/b/${b.code}`,
      }));
    reply.header("cache-control", "no-store");
    return { partners };
  });
}