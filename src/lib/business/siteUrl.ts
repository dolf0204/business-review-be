import { config } from "../../config.js";

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

export function buildSiteUrl(slug: string | null, baseDomain: string, appUrl: string): string | null {
  if (!slug || !baseDomain) return null;
  return `${new URL(appUrl).protocol}//${slug}.${baseDomain}`;
}

export function buildSlugOrigin(baseDomain: string, appUrl: string): RegExp | null {
  if (!baseDomain) return null;
  const scheme = new URL(appUrl).protocol.replace(REGEX_SPECIALS, "\\$&");
  return new RegExp(`^${scheme}//[a-z0-9-]+\\.${baseDomain.replace(REGEX_SPECIALS, "\\$&")}$`);
}

export const siteUrl = (slug: string | null) => buildSiteUrl(slug, config.SLUG_BASE_DOMAIN, config.APP_URL);

export const slugOrigin = () => buildSlugOrigin(config.SLUG_BASE_DOMAIN, config.APP_URL);