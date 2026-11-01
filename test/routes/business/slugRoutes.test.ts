import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../../src/lib/auth/sessionCookie.js";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock("../../../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../../../src/app.js";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (over = {}) => ({
  id: ID, ownerId: "u1", code: "abcd2345", slug: null, slugLockedAt: null, name: "Točkica", kind: "restaurant", subtitle: null, offerText: null,
  address: "Maceljska ul. 21, 10000, Zagreb, Croatia", lat: null, lng: null, googlePlaceId: null, googleMapsUrl: null, googleReviewUrl: null,
  tripadvisorReviewUrl: null, websiteUrl: null, instagramUrl: null, facebookUrl: null, phone: null, contactEmail: null, logoUrl: null,
  backgroundUrl: null, rating: null, ratingCount: null, theme: {}, publishedAt: null, approvedAt: null, paidUntil: null, ...over,
});

async function call(method: "GET" | "PUT", url: string, payload?: object) {
  const app = await buildApp();
  const jwt = app.jwt.sign({ sub: "u1" });
  const res = await app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE}=${jwt}` } });
  await app.close();
  return res;
}

const usedSlugs = (...used: string[]) =>
  db.business.findMany.mockImplementation(async ({ where }: { where: { slug: { in: string[] } } }) => where.slug.in.filter((s) => used.includes(s)).map((slug) => ({ slug })));

describe("business address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue(row());
    db.user.findUnique.mockResolvedValue({ uiLang: "hr" });
    db.business.updateMany.mockResolvedValue({ count: 1 });
    usedSlugs();
  });

  it("needs a session", async () => {
    const app = await buildApp();
    expect((await app.inject({ url: `/businesses/${ID}/slug` })).statusCode).toBe(401);
    await app.close();
  });

  it("suggests addresses in the owner's language before one is chosen", async () => {
    const res = await call("GET", `/businesses/${ID}/slug`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ slug: null, locked: false, suggestions: ["tockica", "tockica-restoran", "tockica-zagreb"] });
  });

  it("shows a locked address without suggestions", async () => {
    db.business.findFirst.mockResolvedValue(row({ slug: "tockica", slugLockedAt: new Date() }));
    expect((await call("GET", `/businesses/${ID}/slug`)).json()).toEqual({ slug: "tockica", locked: true, suggestions: [] });
  });

  it("answers not found for another owner's business", async () => {
    db.business.findFirst.mockResolvedValue(null);
    expect((await call("GET", `/businesses/${ID}/slug`)).statusCode).toBe(404);
    expect((await call("PUT", `/businesses/${ID}/slug`, { slug: "tockica" })).statusCode).toBe(404);
  });

  describe("check", () => {
    it("accepts a free address and cleans up what was typed", async () => {
      const res = await call("GET", `/businesses/${ID}/slug/check?slug=${encodeURIComponent("Točkica Zagreb")}`);
      expect(res.json()).toEqual({ slug: "tockica-zagreb", status: "ok", suggestions: [] });
    });

    it("says when an address is taken and offers others", async () => {
      usedSlugs("tockica");
      const res = await call("GET", `/businesses/${ID}/slug/check?slug=tockica`);
      expect(res.json()).toEqual({ slug: "tockica", status: "taken", suggestions: ["tockica-restoran", "tockica-zagreb", "tockica-restoran-zagreb"] });
    });

    it("refuses reserved and unusable addresses", async () => {
      expect((await call("GET", `/businesses/${ID}/slug/check?slug=www`)).json().status).toBe("reserved");
      expect((await call("GET", `/businesses/${ID}/slug/check?slug=!!`)).json().status).toBe("invalid");
      expect((await call("GET", `/businesses/${ID}/slug/check?slug=ab`)).json().status).toBe("invalid");
    });

    it("does not check a locked address", async () => {
      db.business.findFirst.mockResolvedValue(row({ slug: "tockica", slugLockedAt: new Date() }));
      const res = await call("GET", `/businesses/${ID}/slug/check?slug=other`);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("slug_locked");
    });
  });

  describe("choose", () => {
    it("saves a free address and leaves it open to change while the page is not live", async () => {
      const res = await call("PUT", `/businesses/${ID}/slug`, { slug: "Točkica Zagreb" });
      expect(res.statusCode).toBe(200);
      expect(db.business.updateMany).toHaveBeenCalledTimes(1);
      expect(db.business.updateMany).toHaveBeenCalledWith({ where: { id: ID, slugLockedAt: null }, data: { slug: "tockica-zagreb" } });
    });

    it("locks the address at once when the page is already live", async () => {
      db.business.findFirst.mockResolvedValue(row({ publishedAt: new Date() }));
      expect((await call("PUT", `/businesses/${ID}/slug`, { slug: "tockica" })).statusCode).toBe(200);
      expect(db.business.updateMany).toHaveBeenCalledTimes(2);
      expect(db.business.updateMany).toHaveBeenLastCalledWith({ where: { id: ID, slugLockedAt: null, slug: { not: null } }, data: { slugLockedAt: expect.any(Date) } });
    });

    it("offers other addresses when the one asked for is taken", async () => {
      usedSlugs("tockica");
      const res = await call("PUT", `/businesses/${ID}/slug`, { slug: "tockica" });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "slug_taken", suggestions: ["tockica-restoran", "tockica-zagreb", "tockica-restoran-zagreb"] });
      expect(db.business.updateMany).not.toHaveBeenCalled();
    });

    it("handles someone taking the address at the same moment", async () => {
      db.business.updateMany.mockRejectedValueOnce({ code: "P2002" });
      const res = await call("PUT", `/businesses/${ID}/slug`, { slug: "tockica" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("slug_taken");
    });

    it("refuses reserved and unusable addresses", async () => {
      const reserved = await call("PUT", `/businesses/${ID}/slug`, { slug: "admin" });
      expect(reserved.statusCode).toBe(422);
      expect(reserved.json().error).toBe("slug_reserved");
      const invalid = await call("PUT", `/businesses/${ID}/slug`, { slug: "!!" });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().error).toBe("slug_invalid");
      expect(db.business.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to change a locked address", async () => {
      db.business.findFirst.mockResolvedValue(row({ slug: "tockica", slugLockedAt: new Date() }));
      const res = await call("PUT", `/businesses/${ID}/slug`, { slug: "other-name" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("slug_locked");
      expect(db.business.updateMany).not.toHaveBeenCalled();
    });
  });
});