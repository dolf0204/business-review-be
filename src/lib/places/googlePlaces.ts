import { config } from "../config.js";
import { hintFromMapsUrl, isAllowedMapsHost, isShortMapsLink, parseMapsLink, type MapsHint } from "./mapsUrl.js";

const BASE = "https://places.googleapis.com/v1";
const MAX_HOPS = 4;

export class PlacesError extends Error {
  constructor(public code: "google_unavailable" | "link_not_recognised" | "place_not_found") {
    super(code);
  }
}

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  ratingCount: number | null;
}

export interface PlaceDetails extends PlaceCandidate {
  mapsUrl: string | null;
  reviewUrl: string | null;
  websiteUrl: string | null;
  phone: string | null;
}

type RawPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  googleMapsLinks?: { writeAReviewUri?: string };
  websiteUri?: string;
  nationalPhoneNumber?: string;
};

const headers = (mask: string) => ({ "x-goog-api-key": config.GOOGLE_PLACES_API_KEY, "x-goog-fieldmask": mask, "content-type": "application/json" });

function candidate(p: RawPlace): PlaceCandidate | null {
  if (!p.id || !p.location) return null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? null,
    lat: p.location.latitude,
    lng: p.location.longitude,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
  };
}

/** Follows a short link (maps.app.goo.gl) by hand, checking every hop against Google's hosts. */
export async function expandMapsLink(link: URL, fetchImpl: typeof fetch = fetch): Promise<URL> {
  let current = link;
  for (let hop = 0; hop < MAX_HOPS && isShortMapsLink(current); hop++) {
    const res = await fetchImpl(current, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const next = res.headers.get("location");
    if (!next) throw new PlacesError("link_not_recognised");
    const parsed = parseMapsLink(new URL(next, current).toString());
    if (!parsed || !isAllowedMapsHost(parsed.hostname)) throw new PlacesError("link_not_recognised");
    current = parsed;
  }
  if (isShortMapsLink(current)) throw new PlacesError("link_not_recognised");
  return current;
}

/** Up to three places that match a pasted Google Maps link, or a typed "name and town". */
export async function findPlaces(input: { url?: string; query?: string }, fetchImpl: typeof fetch = fetch): Promise<PlaceCandidate[]> {
  if (!config.GOOGLE_PLACES_API_KEY) throw new PlacesError("google_unavailable");
  let hint: MapsHint = {};
  if (input.url) {
    const link = parseMapsLink(input.url);
    if (!link) throw new PlacesError("link_not_recognised");
    hint = hintFromMapsUrl(await expandMapsLink(link, fetchImpl));
  }
  const text = (input.query ?? hint.name ?? "").trim();
  if (hint.placeId && !text) {
    const one = await placeDetails(hint.placeId, fetchImpl);
    return [one];
  }
  if (!text) throw new PlacesError("link_not_recognised");
  const res = await fetchImpl(`${BASE}/places:searchText`, {
    method: "POST",
    headers: headers("places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount"),
    body: JSON.stringify({
      textQuery: text,
      pageSize: 3,
      ...(hint.lat !== undefined && hint.lng !== undefined ? { locationBias: { circle: { center: { latitude: hint.lat, longitude: hint.lng }, radius: 1500 } } } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new PlacesError("google_unavailable");
  const places = ((await res.json()) as { places?: RawPlace[] }).places ?? [];
  const found = places.flatMap((p) => candidate(p) ?? []);
  if (!found.length) throw new PlacesError("place_not_found");
  return found;
}

/** Everything we copy from Google once the owner has confirmed which place is theirs. */
export async function placeDetails(placeId: string, fetchImpl: typeof fetch = fetch): Promise<PlaceDetails> {
  if (!config.GOOGLE_PLACES_API_KEY) throw new PlacesError("google_unavailable");
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(placeId)) throw new PlacesError("place_not_found");
  const res = await fetchImpl(`${BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: headers("id,displayName,formattedAddress,location,rating,userRatingCount,googleMapsUri,googleMapsLinks,websiteUri,nationalPhoneNumber"),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) throw new PlacesError("place_not_found");
  if (!res.ok) throw new PlacesError("google_unavailable");
  const p = (await res.json()) as RawPlace;
  const base = candidate(p);
  if (!base) throw new PlacesError("place_not_found");
  return {
    ...base,
    mapsUrl: p.googleMapsUri ?? null,
    // Google's own review link when it provides one; otherwise the documented place-id form.
    reviewUrl: p.googleMapsLinks?.writeAReviewUri ?? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    websiteUrl: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? null,
  };
}
