import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ business: { findUnique: vi.fn() }, post: { findMany: vi.fn() }, loyaltyProgram: { findUnique: vi.fn() }, coupon: { findMany: vi.fn() } }));
vi.mock("../../../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../../../src/app.js";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (over = {}) => ({
  id: ID, ownerId: "u1", code: "abcd2345", slug: "tockica", slugLockedAt: new Date(), name: "Točkica", kind: "restaurant", subtitle: null, offerText: "10% off",
  address: "Maceljska ul. 21, 10000, Zagreb, Croatia", lat: 45.8, lng: 15.9, googlePlaceId: "ChIJ1", googleMapsUrl: null, googleReviewUrl: "https://g.page/r/x/review",
  tripadvisorReviewUrl: null, websiteUrl: null, instagramUrl: null, facebookUrl: null, phone: null, contactEmail: null, logoUrl: null, backgroundUrl: null,
  rating: 4.7, ratingCount: 1056, theme: {}, publishedAt: new Date(), paidUntil: new Date(Date.now() + 86_400_000), ...over,
});

async function get(url: string) {
  const app = await buildApp();
  const res = await app.inject({ url });
  await app.close();
  return res;
}

describe("the guest page by its readable address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.post.findMany.mockResolvedValue([]);
    db.loyaltyProgram.findUnique.mockResolvedValue(null);
    db.coupon.findMany.mockResolvedValue([]);
    db.business.findUnique.mockResolvedValue(row());
  });

  it("shows a live business and tells the page its permanent code", async () => {
    const res = await get("/public/s/tockica");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Točkica", code: "abcd2345", slug: "tockica" });
    expect(res.json().ownerId).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(db.business.findUnique).toHaveBeenCalledWith({ where: { slug: "tockica" } });
  });

  it("does not care about capital letters in the host name", async () => {
    await get("/public/s/Tockica");
    expect(db.business.findUnique).toHaveBeenCalledWith({ where: { slug: "tockica" } });
  });

  it("answers not found for an unknown address", async () => {
    db.business.findUnique.mockResolvedValue(null);
    expect((await get("/public/s/nobody-here")).statusCode).toBe(404);
  });

  it("answers not found for an unpublished or unpaid page", async () => {
    db.business.findUnique.mockResolvedValue(row({ publishedAt: null }));
    expect((await get("/public/s/tockica")).statusCode).toBe(404);
    db.business.findUnique.mockResolvedValue(row({ paidUntil: new Date(Date.now() - 1000) }));
    expect((await get("/public/s/tockica")).statusCode).toBe(404);
  });

  it("answers not found while the address is not locked yet", async () => {
    db.business.findUnique.mockResolvedValue(row({ slugLockedAt: null }));
    expect((await get("/public/s/tockica")).statusCode).toBe(404);
  });

  it("refuses an address of the wrong length", async () => {
    expect((await get("/public/s/ab")).statusCode).toBe(400);
    expect((await get(`/public/s/${"a".repeat(41)}`)).statusCode).toBe(400);
  });

  it("keeps the code route working, and shows the address only once it is locked", async () => {
    expect((await get("/public/b/abcd2345")).json().slug).toBe("tockica");
    db.business.findUnique.mockResolvedValue(row({ slugLockedAt: null }));
    expect((await get("/public/b/abcd2345")).json().slug).toBeNull();
  });
});