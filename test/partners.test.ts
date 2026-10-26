import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ business: { findMany: vi.fn() } }));
vi.mock("../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../src/app.js";

const KEY = "partner-key-for-tests-0123456789abcdef";
const biz = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", code: "abcd2345", name: "Konoba Ribar", kind: "restaurant", subtitle: "Best fish", offerText: "10% off",
  address: "Obala 1, Zadar", lat: 44.12, lng: 15.23, logoUrl: null, rating: 4.7, ratingCount: 300, websiteUrl: null,
  googleMapsUrl: null, googleReviewUrl: null, coupons: [], ...over,
});
const coupon = (over = {}) => ({ id: "c1", title: "Free coffee", description: null, startsAt: null, endsAt: null, active: true, maxUses: null, _count: { uses: 0 }, ...over });

async function get(query: string, headers: Record<string, string> = { "x-api-key": KEY }) {
  const app = await buildApp();
  const res = await app.inject({ url: `/partners?${query}`, headers });
  await app.close();
  return res;
}

describe("GET /partners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findMany.mockResolvedValue([biz()]);
  });

  it("is closed without a valid key", async () => {
    expect((await get("lat=44.1&lng=15.2", {})).statusCode).toBe(401);
    expect((await get("lat=44.1&lng=15.2", { "x-api-key": "wrong" })).statusCode).toBe(401);
    expect(db.business.findMany).not.toHaveBeenCalled();
  });

  it("returns published businesses near the point, nearest first, with their page link", async () => {
    db.business.findMany.mockResolvedValue([biz({ id: "far", name: "Far", lat: 44.3, lng: 15.4 }), biz()]);
    const res = await get("lat=44.1194&lng=15.2314&radiusKm=30");
    expect(res.statusCode).toBe(200);
    const { partners } = res.json();
    expect(partners.map((p: { name: string }) => p.name)).toEqual(["Konoba Ribar", "Far"]);
    expect(partners[0].pageUrl).toBe("http://localhost:5190/b/abcd2345");
    expect(db.business.findMany.mock.calls[0]![0].where.publishedAt).toEqual({ not: null });
    expect(db.business.findMany.mock.calls[0]![0].where.approvedAt).toEqual({ not: null });
  });

  it("leaves out businesses outside the radius and ones without a position", async () => {
    db.business.findMany.mockResolvedValue([biz({ lat: 43.5, lng: 16.44 }), biz({ lat: null, lng: null })]);
    expect((await get("lat=44.1194&lng=15.2314")).json().partners).toEqual([]);
  });

  it("refuses a radius above 50 km and a position that is not on the earth", async () => {
    expect((await get("lat=44&lng=15&radiusKm=500")).statusCode).toBe(400);
    expect((await get("lat=144&lng=15")).statusCode).toBe(400);
  });

  it("lists the coupons guests can use now, and leaves out closed, ended and used-up ones", async () => {
    const gone = new Date(Date.now() - 86_400_000);
    db.business.findMany.mockResolvedValue([biz({ coupons: [
      coupon(),
      coupon({ id: "c2", title: "Ended", endsAt: gone }),
      coupon({ id: "c3", title: "Used up", maxUses: 5, _count: { uses: 5 } }),
      coupon({ id: "c4", title: "Places left", maxUses: 5, _count: { uses: 2 } }),
    ] })]);
    const res = await get("lat=44.12&lng=15.23");
    expect(res.json().partners[0].coupons.map((c: { title: string }) => c.title)).toEqual(["Free coffee", "Places left"]);
    expect(res.json().partners[0].coupons[0]).toEqual({ id: "c1", title: "Free coffee", description: null, endsAt: null });
  });

  it("sends at most three coupons per business", async () => {
    db.business.findMany.mockResolvedValue([biz({ coupons: [1, 2, 3, 4, 5].map((n) => coupon({ id: `c${n}`, title: `Coupon ${n}` })) })]);
    expect((await get("lat=44.12&lng=15.23")).json().partners[0].coupons).toHaveLength(3);
  });
});
