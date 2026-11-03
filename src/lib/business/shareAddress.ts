import { siteShareUrl, type ShareSource } from "./code.js";
import { siteUrl } from "./siteUrl.js";

export interface SluggedBusiness {
  slug: string | null;
  slugLockedAt: Date | null;
}

/** The address owners print or write to a tag. Null until the page is published and the business has its own address. */
export function shareAddress(b: SluggedBusiness, source: ShareSource): string | null {
  if (!b.slugLockedAt) return null;
  const site = siteUrl(b.slug);
  return site ? siteShareUrl(site, source) : null;
}