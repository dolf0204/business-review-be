import { prisma } from "../db.js";
import type { Business } from "../generated/prisma/client.js";
import { SLUG_RESULT, claimSlug, freeSlugsFor } from "./slugs.js";

const CLAIM_ATTEMPTS = 5;

type SlugState = Pick<Business, "id" | "name" | "kind" | "address" | "slug" | "slugLockedAt">;

export async function lockSlug(businessId: string): Promise<void> {
  await prisma.business.updateMany({ where: { id: businessId, slugLockedAt: null, slug: { not: null } }, data: { slugLockedAt: new Date() } });
}

export async function settleSlug(business: SlugState, lang: string): Promise<string | null> {
  if (business.slugLockedAt) return business.slug;
  let slug = business.slug;
  for (let attempt = 0; !slug && attempt < CLAIM_ATTEMPTS; attempt++) {
    const [first] = await freeSlugsFor(business.id, { name: business.name, kind: business.kind, address: business.address, lang }, 1);
    if (!first) break;
    const result = await claimSlug(business.id, first);
    if (result === SLUG_RESULT.ok) slug = first;
    if (result === SLUG_RESULT.locked) return (await prisma.business.findUnique({ where: { id: business.id }, select: { slug: true } }))?.slug ?? null;
  }
  if (!slug) return null;
  await lockSlug(business.id);
  return slug;
}