import type { Business } from "../generated/prisma/client.js";

export const MAX_BUSINESSES_PER_OWNER = 5;

/** What the business admin receives: everything except the owner link. */
export function businessView(b: Business) {
  const { ownerId: _owner, ...rest } = b;
  return { ...rest, googleConnected: !!b.googlePlaceId, published: b.publishedAt !== null };
}

/** A business can be shown to guests once it has a name and is connected to its Google page (that gives the position). */
export function publishProblem(b: Pick<Business, "name" | "googlePlaceId" | "lat" | "lng">): "google_not_connected" | "name_required" | null {
  if (!b.name.trim()) return "name_required";
  if (!b.googlePlaceId || b.lat === null || b.lng === null) return "google_not_connected";
  return null;
}
