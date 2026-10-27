import { KINDS, type Kind } from "../schemas.js";

/** The kinds TouristAsk already knows. A business of a newer kind is shown there as the closest of these. */
const PARTNER_KIND: Record<Kind, string> = {
  restaurant: "restaurant",
  cafe: "cafe",
  bar: "bar",
  cocktail: "bar",
  beauty: "beauty",
  barber: "beauty",
  hairdresser: "beauty",
  shop: "shop",
  florist: "shop",
  grocery: "shop",
  sport: "sport",
  sight: "sight",
  beach: "beach",
  other: "other",
};

const isKind = (k: string): k is Kind => (KINDS as readonly string[]).includes(k);

/** What TouristAsk calls a business of this kind. */
export const partnerKind = (kind: string | null): string | null => (kind !== null && isKind(kind) ? PARTNER_KIND[kind] : kind);

/** Every kind that TouristAsk shows under the given name, so asking for "shop" also finds florists and grocers. */
export const kindsShownAs = (partner: string): string[] => {
  const own = KINDS.filter((k) => PARTNER_KIND[k] === partner);
  return own.length ? own : [partner];
};