import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  guest: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  guestToken: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  membership: { upsert: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../src/lib/mail.js", () => mail);

import { buildApp } from "../src/app.js";
import { hashToken } from "../src/lib/tokens.js";

const GUEST = { id: "g1", email: "tourist@example.com", name: null, lang: "en", emailVerifiedAt: null };
const BIZ = { id: "b1", code: "abcd2345", name: "Konoba <Ribar>", publishedAt: new Date() };

async function call(method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: object, cookie?: string) {
  const app = await buildApp();
  const res = await app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
  await app.close();
  return res;
}
const guestCookie = async (kind: string | null = "guest") => {
  const app = await buildApp();
  const jwt = app.jwt.sign({ sub: "g1", ...(kind ? { kind } : {}) } as never);
  await app.close();
  return jwt;
};

describe("joining a business by email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    db.business.findUnique.mockResolvedValue(BIZ);
    db.guest.findUnique.mockResolvedValue(null);
    db.guest.create.mockResolvedValue(GUEST);
    db.guestToken.count.mockResolvedValue(0);
  });

  it("creates the guest, stores only a hash of the link, and emails a link to the business page", async () => {
    const res = await call("POST", "/public/b/abcd2345/join", { email: " Tourist@Example.com ", lang: "hr", marketingOptIn: true });
    expect(res.statusCode).toBe(202);
    expect(db.guest.create.mock.calls[0]![0].data).toMatchObject({ email: "tourist@example.com", lang: "hr" });
    const stored = db.guestToken.create.mock.calls[0]![0].data;
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.marketingOptIn).toBe(true);
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    const sent = mail.sendMail.mock.calls[0]![0];
    expect(sent.to).toBe("tourist@example.com");
    expect(sent.html).toContain("http://localhost:5190/b/abcd2345?token=");
    expect(sent.subject).toContain("Potvrdite");
    expect(sent.html).toContain("Konoba &lt;Ribar&gt;");
  });

  it("answers the same for an existing guest, and stops after five links in an hour", async () => {
    db.guest.findUnique.mockResolvedValue(GUEST);
    expect((await call("POST", "/public/b/abcd2345/join", { email: "tourist@example.com" })).statusCode).toBe(202);
    expect(db.guest.create).not.toHaveBeenCalled();
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    db.guestToken.count.mockResolvedValue(5);
    const res = await call("POST", "/public/b/abcd2345/join", { email: "tourist@example.com" });
    expect(res.statusCode).toBe(202);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it("refuses an unpublished business, a bad address, and an unknown language falls back through validation", async () => {
    db.business.findUnique.mockResolvedValue({ ...BIZ, publishedAt: null });
    expect((await call("POST", "/public/b/abcd2345/join", { email: "tourist@example.com" })).statusCode).toBe(404);
    db.business.findUnique.mockResolvedValue(BIZ);
    expect((await call("POST", "/public/b/abcd2345/join", { email: "not-an-email" })).statusCode).toBe(400);
    expect((await call("POST", "/public/b/abcd2345/join", { email: "tourist@example.com", lang: "xx" })).statusCode).toBe(400);
  });

  it("still answers when the mail provider fails", async () => {
    mail.sendMail.mockRejectedValue(new Error("Brevo responded 401: secret detail"));
    const res = await call("POST", "/public/b/abcd2345/join", { email: "tourist@example.com" });
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('{"ok":true}');
  });
});

describe("opening the link", () => {
  const token = "a-long-enough-token-value";
  const row = (over = {}) => ({ id: "t1", guestId: "g1", businessId: "b1", marketingOptIn: false, usedAt: null, expiresAt: new Date(Date.now() + 60_000), business: { code: "abcd2345", name: "Konoba" }, ...over });
  beforeEach(() => {
    vi.clearAllMocks();
    db.guestToken.findUnique.mockResolvedValue(row());
    db.guest.update.mockResolvedValue({ ...GUEST, emailVerifiedAt: new Date() });
  });

  it("signs the guest in for a long time, records the membership and uses the link up", async () => {
    const res = await call("POST", "/guest/verify", { token });
    expect(res.statusCode).toBe(200);
    expect(db.guestToken.findUnique.mock.calls[0]![0].where.tokenHash).toBe(hashToken(token));
    expect(db.guestToken.update.mock.calls[0]![0].data.usedAt).toBeInstanceOf(Date);
    expect(db.membership.upsert.mock.calls[0]![0].create).toMatchObject({ guestId: "g1", businessId: "b1", marketingOptInAt: null });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/guest=.*HttpOnly/i);
    expect(cookie).toMatch(/Max-Age=15552000/);
    expect(res.json().business.code).toBe("abcd2345");
  });

  it("records consent only when it was ticked, and never removes it", async () => {
    db.guestToken.findUnique.mockResolvedValue(row({ marketingOptIn: true }));
    await call("POST", "/guest/verify", { token });
    expect(db.membership.upsert.mock.calls[0]![0].create.marketingOptInAt).toBeInstanceOf(Date);
    db.guestToken.findUnique.mockResolvedValue(row({ marketingOptIn: false }));
    await call("POST", "/guest/verify", { token });
    expect(db.membership.upsert.mock.calls[1]![0].update).toEqual({});
  });

  it("refuses unknown, used and expired links", async () => {
    db.guestToken.findUnique.mockResolvedValue(null);
    expect((await call("POST", "/guest/verify", { token })).statusCode).toBe(400);
    db.guestToken.findUnique.mockResolvedValue(row({ usedAt: new Date() }));
    expect((await call("POST", "/guest/verify", { token })).statusCode).toBe(400);
    db.guestToken.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    expect((await call("POST", "/guest/verify", { token })).statusCode).toBe(400);
  });
});

describe("a signed-in guest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.guest.findUnique.mockResolvedValue(GUEST);
    db.membership.findMany.mockResolvedValue([{ marketingOptInAt: new Date(), business: { code: "abcd2345" } }]);
  });

  it("is recognised on the next visit, with their memberships", async () => {
    const res = await call("GET", "/guest/me", undefined, `guest=${await guestCookie()}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: "tourist@example.com", memberships: [{ code: "abcd2345", marketingOptIn: true }] });
  });

  it("is not recognised without a session, or with a session that is not a guest's", async () => {
    expect((await call("GET", "/guest/me")).statusCode).toBe(401);
    expect((await call("GET", "/guest/me", undefined, `guest=${await guestCookie(null)}`)).statusCode).toBe(401);
    expect((await call("GET", "/guest/me", undefined, "guest=garbage")).statusCode).toBe(401);
  });

  it("can never open the owner's screens", async () => {
    expect((await call("GET", "/businesses", undefined, `session=${await guestCookie()}`)).statusCode).toBe(401);
  });

  it("changes name and language, and withdraws consent", async () => {
    db.guest.update.mockResolvedValue({ ...GUEST, name: "Ana", lang: "hr" });
    const patch = await call("PATCH", "/guest/me", { name: "Ana", lang: "hr" }, `guest=${await guestCookie()}`);
    expect(patch.json()).toEqual({ email: "tourist@example.com", name: "Ana", lang: "hr" });
    db.membership.findFirst.mockResolvedValue({ id: "m1" });
    const off = await call("PUT", "/guest/b/abcd2345/marketing", { optIn: false }, `guest=${await guestCookie()}`);
    expect(off.statusCode).toBe(200);
    expect(db.membership.update.mock.calls[0]![0].data.marketingOptInAt).toBeNull();
    db.membership.findFirst.mockResolvedValue(null);
    expect((await call("PUT", "/guest/b/abcd2345/marketing", { optIn: true }, `guest=${await guestCookie()}`)).statusCode).toBe(404);
  });

  it("joins another business with one tap, only if it is published", async () => {
    db.business.findUnique.mockResolvedValue({ id: "b2", publishedAt: new Date() });
    const ok = await call("POST", "/guest/b/abcd2345/join", { marketingOptIn: true }, `guest=${await guestCookie()}`);
    expect(ok.statusCode).toBe(200);
    expect(db.membership.upsert.mock.calls[0]![0].create).toMatchObject({ guestId: "g1", businessId: "b2" });
    expect(db.membership.upsert.mock.calls[0]![0].create.marketingOptInAt).toBeInstanceOf(Date);
    db.business.findUnique.mockResolvedValue({ id: "b2", publishedAt: null });
    expect((await call("POST", "/guest/b/abcd2345/join", {}, `guest=${await guestCookie()}`)).statusCode).toBe(404);
    expect((await call("POST", "/guest/b/abcd2345/join", {})).statusCode).toBe(401);
  });

  it("signs out by clearing the cookie", async () => {
    expect(String((await call("POST", "/guest/logout")).headers["set-cookie"])).toMatch(/guest=;/);
  });
});
