import type { Business } from "../generated/prisma/client.js";

export const MAX_BUSINESSES_PER_OWNER = 5;

/** What the business admin receives: everything except the owner link. */
export function businessView(b: Business) {
  const { ownerId: _owner, ...rest } = b;
  return { ...rest, googleConnected: !!b.googlePlaceId, published: b.publishedAt !== null, paid: !!b.paidUntil && b.paidUntil > new Date(), paidUntil: b.paidUntil, approved: b.approvedAt !== null };
}

/** A business can be shown to guests once it has a name and is connected to its Google page (that gives the position). */
export function publishProblem(b: Pick<Business, "name" | "googlePlaceId" | "lat" | "lng">): "google_not_connected" | "name_required" | null {
  if (!b.name.trim()) return "name_required";
  if (!b.googlePlaceId || b.lat === null || b.lng === null) return "google_not_connected";
  return null;
}

const DEFAULT_THEME = { template: "classic", primary: "#0f766e", accent: "#f97316" };

/** What a guest receives about a published business: the page content, nothing about the owner or the account. */
type LoyaltyTeaser = { enabled: boolean; goal: number; rewardText: string; startsAt: Date | null; endsAt: Date | null } | null;

type PublicCoupon = { id: string; title: string; description: string | null; startsAt: Date | null; endsAt: Date | null };

export function publicBusiness(b: Business, posts: { id: string; title: string; body: string | null; endsAt: Date | null; createdAt: Date }[] = [], loyalty: LoyaltyTeaser = null, coupons: PublicCoupon[] = []) {
  const theme = { ...DEFAULT_THEME, ...(b.theme as Record<string, string>) };
  return {
    code: b.code,
    name: b.name,
    kind: b.kind,
    subtitle: b.subtitle,
    offerText: b.offerText,
    address: b.address,
    lat: b.lat,
    lng: b.lng,
    logoUrl: b.logoUrl,
    backgroundUrl: b.backgroundUrl,
    rating: b.rating,
    ratingCount: b.ratingCount,
    googleMapsUrl: b.googleMapsUrl,
    websiteUrl: b.websiteUrl,
    instagramUrl: b.instagramUrl,
    facebookUrl: b.facebookUrl,
    phone: b.phone,
    contactEmail: b.contactEmail,
    theme: { template: theme.template, primary: theme.primary, accent: theme.accent },
    loyalty: loyalty?.enabled ? { goal: loyalty.goal, rewardText: loyalty.rewardText, startsAt: loyalty.startsAt, endsAt: loyalty.endsAt } : null,
    coupons: coupons.map((c) => ({ id: c.id, title: c.title, description: c.description, startsAt: c.startsAt, endsAt: c.endsAt })),
    posts: posts.map((p) => ({ id: p.id, title: p.title, body: p.body, endsAt: p.endsAt, createdAt: p.createdAt })),
  };
}
