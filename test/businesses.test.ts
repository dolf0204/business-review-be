import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/lib/sessionCookie.js";

const db = vi.hoisted(() => ({
  business: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../src/lib/mail.js", () => mail);
vi.mock("../src/db.js", () => ({ prisma: db }));
const places = vi.hoisted(() => ({ findPlaces: vi.fn(), placeDetails: vi.fn() }));
vi.mock("../src/lib/googlePlaces.js", async (orig) => ({ ...(await orig<typeof import("../src/lib/googlePlaces.js")>()), ...places }));

import { buildApp } from "../src/app.js";
import { PlacesError } from "../src/lib/googlePlaces.js";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (over = {}) => ({
  id: ID, ownerId: "u1", code: "abcd2345", name: "Konoba", kind: "restaurant", subtitle: null, offerText: null, address: null, lat: null, lng: null,
  googlePlaceId: null, googleMapsUrl: null, googleReviewUrl: null, tripadvisorReviewUrl: null, websiteUrl: null, instagramUrl: null, facebookUrl: null,
  phone: null, contactEmail: null, logoUrl: null, backgroundUrl: null, rating: null, ratingCount: null, theme: {}, publishedAt: null, approvedAt: null, paidUntil: null, ...over,
});
const PAID = new Date(Date.now() + 30 * 86_400_000);

async function call(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) {
  const app = await buildApp();
  const jwt = app.jwt.sign({ sub: "u1" });
  const res = await app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE}=${jwt}` } });
  await app.close();
  return res;
}

describe("businesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue(row());
    db.business.update.mockImplementation(async ({ data }: { data: object }) => row(data));
  });

  it("needs a session", async () => {
    const app = await buildApp();
    expect((await app.inject({ url: "/businesses" })).statusCode).toBe(401);
    await app.close();
  });

  it("creates a business with a short code and hides the owner id", async () => {
    db.business.count.mockResolvedValue(0);
    db.business.create.mockImplementation(async ({ data }: { data: object }) => row(data));
    const res = await call("POST", "/businesses", { name: " Konoba Ribar ", kind: "restaurant" });
    expect(res.statusCode).toBe(201);
    expect(db.business.create.mock.calls[0]![0].data).toMatchObject({ ownerId: "u1", name: "Konoba Ribar" });
    expect(db.business.create.mock.calls[0]![0].data.code).toMatch(/^[2-9a-hj-km-np-z]{8}$/);
    expect(res.json().ownerId).toBeUndefined();
  });

  it("caps how many businesses one owner can create", async () => {
    db.business.count.mockResolvedValue(5);
    const res = await call("POST", "/businesses", { name: "One more" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("business_limit_reached");
  });

  it("retries when the short code is already taken", async () => {
    db.business.count.mockResolvedValue(0);
    db.business.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" })).mockImplementation(async ({ data }: { data: object }) => row(data));
    expect((await call("POST", "/businesses", { name: "Cafe" })).statusCode).toBe(201);
    expect(db.business.create).toHaveBeenCalledTimes(2);
  });

  it("answers not found for another owner's business", async () => {
    db.business.findFirst.mockResolvedValue(null);
    for (const [m, u] of [["GET", `/businesses/${ID}`], ["POST", `/businesses/${ID}/publish`], ["PUT", `/businesses/${ID}/google`]] as const) {
      expect((await call(m, u, m === "PUT" ? { placeId: "ChIJabcdefghij123" } : undefined)).statusCode).toBe(404);
    }
    expect(db.business.findFirst.mock.calls[0]![0].where).toEqual({ id: ID, ownerId: "u1" });
  });

  it("updates the profile, merges the design into the theme, and turns empty fields into none", async () => {
    db.business.findFirst.mockResolvedValue(row({ theme: { template: "classic", primary: "#111111" } }));
    const res = await call("PATCH", `/businesses/${ID}`, { subtitle: "  ", offerText: "10% off", template: "warm", instagramUrl: "https://www.instagram.com/konoba", websiteUrl: "" });
    expect(res.statusCode).toBe(200);
    const data = db.business.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ subtitle: null, offerText: "10% off", websiteUrl: null, instagramUrl: "https://www.instagram.com/konoba" });
    expect(data.theme).toEqual({ template: "warm", primary: "#111111" });
  });

  it("refuses links that do not belong to the named site, and positions cannot be set by hand", async () => {
    expect((await call("PATCH", `/businesses/${ID}`, { instagramUrl: "https://evil.example.com/x" })).statusCode).toBe(400);
    expect((await call("PATCH", `/businesses/${ID}`, { facebookUrl: "javascript:alert(1)" })).statusCode).toBe(400);
    await call("PATCH", `/businesses/${ID}`, { name: "Konoba", lat: 1, lng: 2, googlePlaceId: "x" });
    const data = db.business.update.mock.calls[0]![0].data;
    expect(data.lat).toBeUndefined();
    expect(data.googlePlaceId).toBeUndefined();
  });

  it("publishes only once connected to Google", async () => {
    const no = await call("POST", `/businesses/${ID}/publish`);
    expect(no.statusCode).toBe(422);
    expect(no.json().error).toBe("google_not_connected");
    db.business.findFirst.mockResolvedValue(row({ googlePlaceId: "ChIJabcdefghij123", lat: 44.1, lng: 15.2 }));
    const unpaid = await call("POST", `/businesses/${ID}/publish`);
    expect(unpaid.statusCode).toBe(402);
    expect(unpaid.json().error).toBe("payment_required");
    db.business.findFirst.mockResolvedValue(row({ googlePlaceId: "ChIJabcdefghij123", lat: 44.1, lng: 15.2, paidUntil: new Date(Date.now() - 1000) }));
    expect((await call("POST", `/businesses/${ID}/publish`)).json().error).toBe("payment_required");
    db.business.findFirst.mockResolvedValue(row({ googlePlaceId: "ChIJabcdefghij123", lat: 44.1, lng: 15.2, paidUntil: PAID }));
    const yes = await call("POST", `/businesses/${ID}/publish`);
    expect(yes.statusCode).toBe(200);
    expect(db.business.update.mock.calls.at(-1)![0].data.publishedAt).toBeInstanceOf(Date);
    const off = await call("POST", `/businesses/${ID}/unpublish`);
    expect(db.business.update.mock.calls.at(-1)![0].data.publishedAt).toBeNull();
    expect(off.statusCode).toBe(200);
  });
});

describe("operator approval", () => {
  const live = (over = {}) => row({ googlePlaceId: "ChIJabcdefghij123", lat: 44.1, lng: 15.2, paidUntil: PAID, ...over });
  // The database answers with the row as it was plus what was changed.
  const found = (r: ReturnType<typeof row>) => {
    db.business.findFirst.mockResolvedValue(r);
    db.business.update.mockImplementation(async ({ data }: { data: object }) => ({ ...r, ...data }));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    db.user.findUnique.mockResolvedValue({ email: "owner@example.com" });
  });

  it("asks the operators to look at a business the first time it goes live", async () => {
    found(live());
    await call("POST", `/businesses/${ID}/publish`);
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    const sent = mail.sendMail.mock.calls[0]![0];
    expect(sent.to).toBe("boss@example.com");
    expect(sent.html).toContain(`/operator/review?b=${ID}&amp;k=`);
    expect(sent.html).toContain("owner@example.com");
  });

  it("does not ask again for a business that is already live or already approved", async () => {
    found(live({ publishedAt: new Date(), paidUntil: new Date(Date.now() + 86_400_000) }));
    await call("POST", `/businesses/${ID}/publish`);
    found(live({ approvedAt: new Date() }));
    await call("POST", `/businesses/${ID}/publish`);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it("takes the approval back when an approved business changes what guests read, and asks again if it is live", async () => {
    found(live({ approvedAt: new Date(), publishedAt: new Date(), paidUntil: new Date(Date.now() + 86_400_000), offerText: "10% off" }));
    await call("PATCH", `/businesses/${ID}`, { offerText: "Everything free" });
    expect(db.business.update.mock.calls[0]![0].data.approvedAt).toBeNull();
    expect(mail.sendMail.mock.calls[0]![0].subject).toContain("Changed");
  });

  it("keeps the approval for changes that do not touch what guests read, or an unchanged value", async () => {
    found(live({ approvedAt: new Date(), publishedAt: new Date(), paidUntil: new Date(Date.now() + 86_400_000), offerText: "10% off" }));
    await call("PATCH", `/businesses/${ID}`, { phone: "023 1", offerText: "10% off" });
    expect(db.business.update.mock.calls[0]![0].data.approvedAt).toBeUndefined();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});

describe("connecting to Google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue(row({ websiteUrl: "https://own.example.com" }));
    db.business.update.mockImplementation(async ({ data }: { data: object }) => row(data));
  });

  it("looks a place up from a link or a name", async () => {
    places.findPlaces.mockResolvedValue([{ placeId: "ChIJabcdefghij123", name: "Konoba", address: "Obala 1", lat: 44.1, lng: 15.2, rating: 4.7, ratingCount: 300 }]);
    const res = await call("POST", "/google/lookup", { url: "https://maps.app.goo.gl/abc" });
    expect(res.json().candidates).toHaveLength(1);
    expect((await call("POST", "/google/lookup", {})).statusCode).toBe(400);
  });

  it("passes on what went wrong", async () => {
    places.findPlaces.mockRejectedValue(new PlacesError("link_not_recognised"));
    expect((await call("POST", "/google/lookup", { url: "https://evil.example.com" })).statusCode).toBe(422);
    places.findPlaces.mockRejectedValue(new PlacesError("google_unavailable"));
    expect((await call("POST", "/google/lookup", { query: "Konoba Zadar" })).statusCode).toBe(503);
    places.findPlaces.mockRejectedValue(new PlacesError("place_not_found"));
    expect((await call("POST", "/google/lookup", { query: "Nothing here" })).statusCode).toBe(404);
  });

  it("copies position, rating and review link from Google, and keeps the owner's own website", async () => {
    places.placeDetails.mockResolvedValue({
      placeId: "ChIJabcdefghij123", name: "Konoba", address: "Obala 1, Zadar", lat: 44.12, lng: 15.23, rating: 4.7, ratingCount: 300,
      mapsUrl: "https://maps.google.com/?cid=1", reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJabcdefghij123", websiteUrl: "https://google.example.com", phone: "023 123 456",
    });
    const res = await call("PUT", `/businesses/${ID}/google`, { placeId: "ChIJabcdefghij123" });
    expect(res.statusCode).toBe(200);
    const data = db.business.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ googlePlaceId: "ChIJabcdefghij123", lat: 44.12, lng: 15.23, rating: 4.7, address: "Obala 1, Zadar", phone: "023 123 456", websiteUrl: "https://own.example.com" });
    expect(data.googleReviewUrl).toContain("writereview");
    expect(res.json().googleConnected).toBe(true);
  });
});
