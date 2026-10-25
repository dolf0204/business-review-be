// Reading a Google Maps link. Pure functions, so they are easy to test; the network part is in googlePlaces.ts.

const ALLOWED_HOSTS = ["maps.app.goo.gl", "goo.gl", "google.com", "www.google.com", "maps.google.com", "google.hr", "www.google.hr"];

export const isAllowedMapsHost = (host: string) => ALLOWED_HOSTS.includes(host.toLowerCase());
export const isShortMapsLink = (u: URL) => u.hostname === "maps.app.goo.gl" || u.hostname === "goo.gl";

/** A link the owner pasted: https only, and only Google's own hosts, so the server never fetches an address chosen by a stranger. */
export function parseMapsLink(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || !isAllowedMapsHost(u.hostname)) return null;
    if (u.hostname.endsWith("google.com") || u.hostname.endsWith("google.hr")) {
      if (!u.pathname.startsWith("/maps") && u.hostname !== "maps.google.com") return null;
    }
    return u;
  } catch {
    return null;
  }
}

export interface MapsHint {
  placeId?: string;
  name?: string;
  lat?: number;
  lng?: number;
}

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

/** What a full Google Maps address tells us: the place name, the position, sometimes the place id. */
export function hintFromMapsUrl(u: URL): MapsHint {
  const hint: MapsHint = {};
  const q = u.searchParams.get("query_place_id") ?? u.searchParams.get("place_id");
  if (q && /^[A-Za-z0-9_-]{10,200}$/.test(q)) hint.placeId = q;
  const name = /\/maps\/place\/([^/@]+)/.exec(u.pathname)?.[1];
  if (name) {
    try {
      hint.name = decodeURIComponent(name.replace(/\+/g, " ")).trim() || undefined;
    } catch {
      /* not valid percent-encoding: no name */
    }
  }
  // The exact pin (!3d..!4d..) is more precise than the map centre (@lat,lng).
  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(u.pathname + u.search);
  const centre = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u.pathname);
  const lat = num(pin?.[1] ?? centre?.[1]);
  const lng = num(pin?.[2] ?? centre?.[2]);
  if (lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    hint.lat = lat;
    hint.lng = lng;
  }
  return hint;
}
