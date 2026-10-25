import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ business: { findFirst: vi.fn(), findUnique: vi.fn() }, post: { findMany: vi.fn() }, loyaltyProgram: { findUnique: vi.fn() } }));
vi.mock("../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../src/app.js";
import { shareUrl } from "../src/lib/code.js";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (over = {}) => ({
  id: ID, ownerId: "u1", code: "abcd2345", name: "Konoba Ribar", kind: "restaurant", subtitle: "Fresh fish", offerText: "10% off", address: "Obala 1, Zadar",
  lat: 44.12, lng: 15.23, googlePlaceId: "ChIJ1", googleMapsUrl: "https://maps.google.com/?cid=1", googleReviewUrl: "https://g.page/r/x/review",
  tripadvisorReviewUrl: null, websiteUrl: "https://k.example.com", instagramUrl: null, facebookUrl: null, phone: "023 1", contactEmail: null, imageUrl: null,
  rating: 4.7, ratingCount: 300, theme: { template: "warm" }, publishedAt: new Date(), ...over,
});

async function owner(url: string) {
  const app = await buildApp();
  const res = await app.inject({ url, headers: { cookie: `session=${app.jwt.sign({ sub: "u1" })}` } });
  await app.close();
  return res;
}

describe("QR code and NFC address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue(row());
    db.post.findMany.mockResolvedValue([]);
  });

  it("builds a stable address with a hint of how it was opened", () => {
    expect(shareUrl("https://businessask.eu/", "abcd2345", "qr")).toBe("https://businessask.eu/b/abcd2345?s=q");
    expect(shareUrl("https://businessask.eu", "abcd2345", "nfc")).toBe("https://businessask.eu/b/abcd2345?s=n");
  });

  it("gives the owner the two addresses", async () => {
    const res = await owner(`/businesses/${ID}/share`);
    expect(res.json()).toEqual({ qrUrl: "http://localhost:5190/b/abcd2345?s=q", nfcUrl: "http://localhost:5190/b/abcd2345?s=n" });
  });

  it("makes an SVG by default and a PNG on request", async () => {
    const svg = await owner(`/businesses/${ID}/qr`);
    expect(svg.statusCode).toBe(200);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    expect(svg.body.startsWith("<?xml") || svg.body.startsWith("<svg")).toBe(true);
    const png = await owner(`/businesses/${ID}/qr?format=png&size=400`);
    expect(png.headers["content-type"]).toContain("image/png");
    expect(png.rawPayload.subarray(1, 4).toString()).toBe("PNG");
  });

  it("refuses sizes outside 200 to 2000, a stranger's business, and a missing session", async () => {
    expect((await owner(`/businesses/${ID}/qr?size=50`)).statusCode).toBe(400);
    expect((await owner(`/businesses/${ID}/qr?size=5000`)).statusCode).toBe(400);
    db.business.findFirst.mockResolvedValue(null);
    expect((await owner(`/businesses/${ID}/qr`)).statusCode).toBe(404);
    expect((await owner(`/businesses/${ID}/share`)).statusCode).toBe(404);
    const app = await buildApp();
    expect((await app.inject({ url: `/businesses/${ID}/qr` })).statusCode).toBe(401);
    await app.close();
  });
});

describe("the guest page data", () => {
  beforeEach(() => {
    db.post.findMany.mockResolvedValue([]);
    db.loyaltyProgram.findUnique.mockResolvedValue(null);
  });
  const get = async (code = "abcd2345") => {
    const app = await buildApp();
    const res = await app.inject({ url: `/public/b/${code}` });
    await app.close();
    return res;
  };

  it("shows a published business without anything about the owner or the account", async () => {
    db.business.findUnique.mockResolvedValue(row());
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ name: "Konoba Ribar", offerText: "10% off", rating: 4.7, theme: { template: "warm", primary: "#0f766e", accent: "#f97316" } });
    for (const secret of ["ownerId", "id", "googlePlaceId", "googleReviewUrl", "publishedAt"]) expect(body[secret]).toBeUndefined();
    expect(res.headers["cache-control"]).toContain("max-age=60");
  });

  it("answers not found for an unknown or unpublished business", async () => {
    db.business.findUnique.mockResolvedValue(null);
    expect((await get("zzzz2222")).statusCode).toBe(404);
    db.business.findUnique.mockResolvedValue(row({ publishedAt: null }));
    expect((await get()).statusCode).toBe(404);
  });
});
