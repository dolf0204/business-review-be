import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ prisma: {} }));

import { findPlaces, placeDetails } from "../src/lib/googlePlaces.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const raw = { id: "ChIJabcdefghij123", displayName: { text: "Konoba Ribar" }, formattedAddress: "Obala 1, Zadar", location: { latitude: 44.12, longitude: 15.23 }, rating: 4.7, userRatingCount: 300 };

describe("Places API calls", () => {
  it("searches by typed text and sends the key only in a header", async () => {
    const fetchImpl = vi.fn(async () => json({ places: [raw] }));
    const found = await findPlaces({ query: "Konoba Ribar Zadar" }, fetchImpl as never);
    expect(found[0]).toMatchObject({ placeId: "ChIJabcdefghij123", name: "Konoba Ribar", lat: 44.12, rating: 4.7, ratingCount: 300 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(url).not.toContain("places-key-for-tests");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("places-key-for-tests");
    expect(JSON.parse(init.body as string)).toEqual({ textQuery: "Konoba Ribar Zadar", pageSize: 3 });
  });

  it("uses the name and pin of a pasted link, biased to that spot", async () => {
    const fetchImpl = vi.fn(async () => json({ places: [raw] }));
    await findPlaces({ url: "https://www.google.com/maps/place/Konoba+Ribar/@44.1,15.2,17z/data=!3d44.12!4d15.23" }, fetchImpl as never);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.textQuery).toBe("Konoba Ribar");
    expect(body.locationBias.circle.center).toEqual({ latitude: 44.12, longitude: 15.23 });
  });

  it("reports when nothing matches or Google fails", async () => {
    await expect(findPlaces({ query: "zzz" }, (async () => json({})) as never)).rejects.toMatchObject({ code: "place_not_found" });
    await expect(findPlaces({ query: "zzz" }, (async () => json({}, 500)) as never)).rejects.toMatchObject({ code: "google_unavailable" });
    await expect(findPlaces({ url: "https://evil.example.com" }, vi.fn() as never)).rejects.toMatchObject({ code: "link_not_recognised" });
  });

  it("reads the details, with a review link even when Google gives none", async () => {
    const fetchImpl = vi.fn(async () => json({ ...raw, googleMapsUri: "https://maps.google.com/?cid=1", websiteUri: "https://k.example.com", nationalPhoneNumber: "023 1" }));
    const d = await placeDetails("ChIJabcdefghij123", fetchImpl as never);
    expect(d).toMatchObject({ mapsUrl: "https://maps.google.com/?cid=1", websiteUrl: "https://k.example.com", phone: "023 1" });
    expect(d.reviewUrl).toBe("https://search.google.com/local/writereview?placeid=ChIJabcdefghij123");
    const withLink = await placeDetails("ChIJabcdefghij123", (async () => json({ ...raw, googleMapsLinks: { writeAReviewUri: "https://g.page/r/abc/review" } })) as never);
    expect(withLink.reviewUrl).toBe("https://g.page/r/abc/review");
  });

  it("refuses odd place ids before calling Google, and maps a 404", async () => {
    const fetchImpl = vi.fn();
    await expect(placeDetails("../../etc", fetchImpl as never)).rejects.toMatchObject({ code: "place_not_found" });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(placeDetails("ChIJabcdefghij123", (async () => json({}, 404)) as never)).rejects.toMatchObject({ code: "place_not_found" });
  });
});
