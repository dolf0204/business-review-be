import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/lib/sessionCookie.js";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn(), findUnique: vi.fn() },
  guest: { findUnique: vi.fn() },
  membership: { findUnique: vi.fn() },
  coupon: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  couponUse: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { staffCode, utcDay } from "../src/lib/loyalty.js";
import { couponOpen } from "../src/routes/coupons.js";

const B = "11111111-1111-4111-8111-111111111111";
const C = "44444444-4444-4444-8444-444444444444";
const TODAY = utcDay(new Date());
const code = () => staffCode(B, TODAY, config.JWT_SECRET);
const DAY = 86_400_000;

describe("when a coupon can be used", () => {
  const now = new Date("2026-04-02T12:00:00Z");
  it("needs it switched on and inside its dates", () => {
    expect(couponOpen({ active: true, startsAt: null, endsAt: null }, now)).toBe(true);
    expect(couponOpen({ active: false, startsAt: null, endsAt: null }, now)).toBe(false);
    expect(couponOpen({ active: true, startsAt: new Date("2026-04-05"), endsAt: null }, now)).toBe(false);
    expect(couponOpen({ active: true, startsAt: null, endsAt: new Date("2026-04-01") }, now)).toBe(false);
    expect(couponOpen({ active: true, startsAt: new Date("2026-04-01"), endsAt: new Date("2026-04-03") }, now)).toBe(true);
  });
});

describe("the owner's coupons", () => {
  async function owner(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
    const app = await buildApp();
    const res = await app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE}=${app.jwt.sign({ sub: "u1" })}` } });
    await app.close();
    return res;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue({ id: B, ownerId: "u1" });
    db.coupon.count.mockResolvedValue(0);
    db.coupon.create.mockImplementation(async ({ data }: { data: object }) => ({ id: C, active: true, ...data }));
  });

  it("lists the coupons with how often each was used, and today's staff code", async () => {
    db.coupon.findMany.mockResolvedValue([{ id: C, title: "10% off", _count: { uses: 4 } }]);
    const res = await owner("GET", `/businesses/${B}/coupons`);
    expect(res.json().coupons).toEqual([{ id: C, title: "10% off", uses: 4 }]);
    expect(res.json().staffCode).toBe(code());
  });

  it("adds a coupon with optional dates, and refuses a period that ends before it starts and more than ten", async () => {
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: " 10% off lunch ", description: "", endsAt: "2026-12-31" })).statusCode).toBe(201);
    expect(db.coupon.create.mock.calls[0]![0].data).toMatchObject({ businessId: B, title: "10% off lunch", description: null });
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: "x", startsAt: "2026-05-02", endsAt: "2026-05-01" })).json().error).toBe("invalid_period");
    db.coupon.count.mockResolvedValue(10);
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: "x" })).json().error).toBe("coupon_limit_reached");
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: "" })).statusCode).toBe(400);
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: "x".repeat(61) })).statusCode).toBe(400);
  });

  it("stores an optional limit on how many guests may use a coupon", async () => {
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: "First 50", maxUses: 50 })).statusCode).toBe(201);
    expect(db.coupon.create.mock.calls[0]![0].data.maxUses).toBe(50);
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: "No limit" })).statusCode).toBe(201);
    expect(db.coupon.create.mock.calls[1]![0].data.maxUses).toBeNull();
    for (const bad of [0, -3, 1.5, 100_001]) expect((await owner("POST", `/businesses/${B}/coupons`, { title: "x", maxUses: bad })).statusCode).toBe(400);
  });

  it("switches a coupon off or deletes it only for its owner", async () => {
    db.coupon.updateMany.mockResolvedValue({ count: 1 });
    expect((await owner("PATCH", `/coupons/${C}`, { active: false })).statusCode).toBe(200);
    expect(db.coupon.updateMany.mock.calls[0]![0].where).toEqual({ id: C, business: { ownerId: "u1" } });
    db.coupon.updateMany.mockResolvedValue({ count: 0 });
    expect((await owner("PATCH", `/coupons/${C}`, { active: false })).statusCode).toBe(404);
    await owner("DELETE", `/coupons/${C}`);
    expect(db.coupon.deleteMany.mock.calls[0]![0].where).toEqual({ id: C, business: { ownerId: "u1" } });
  });

  it("keeps other owners out", async () => {
    db.business.findFirst.mockResolvedValue(null);
    expect((await owner("GET", `/businesses/${B}/coupons`)).statusCode).toBe(404);
    expect((await owner("POST", `/businesses/${B}/coupons`, { title: "x" })).statusCode).toBe(404);
  });
});

describe("a guest and the coupons", () => {
  const BIZ = { id: B, publishedAt: new Date(), paidUntil: new Date(Date.now() + 30 * DAY) };
  const coupon = (over = {}) => ({ id: C, businessId: B, title: "10% off lunch", description: null, startsAt: null, endsAt: null, active: true, maxUses: null, _count: { uses: 0 }, ...over });
  async function guest(method: "GET" | "POST", url: string, payload?: object, signedIn = true) {
    const app = await buildApp();
    const res = await app.inject({ method, url, payload, headers: signedIn ? { cookie: `guest=${app.jwt.sign({ sub: "g1", kind: "guest" } as never)}` } : {} });
    await app.close();
    return res;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    db.guest.findUnique.mockResolvedValue({ id: "g1" });
    db.business.findUnique.mockResolvedValue(BIZ);
    db.membership.findUnique.mockResolvedValue({ id: "m1" });
    db.coupon.findMany.mockResolvedValue([coupon(), coupon({ id: "other", endsAt: new Date(Date.now() - DAY) })]);
    db.couponUse.findMany.mockResolvedValue([]);
    db.coupon.findFirst.mockResolvedValue(coupon());
    db.couponUse.create.mockResolvedValue({});
    db.couponUse.count.mockResolvedValue(0);
    db.$queryRaw.mockResolvedValue([]);
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  });

  it("lists the coupons that are open now and marks the ones this guest used", async () => {
    db.couponUse.findMany.mockResolvedValue([{ couponId: C }]);
    const res = await guest("GET", "/guest/b/abcd2345/coupons");
    expect(res.json().coupons).toEqual([expect.objectContaining({ id: C, title: "10% off lunch", used: true })]);
  });

  it("tells a member how many uses of a limited coupon are left", async () => {
    db.coupon.findMany.mockResolvedValue([coupon({ maxUses: 50, _count: { uses: 48 } }), coupon({ id: "gone", maxUses: 5, _count: { uses: 9 } }), coupon({ id: "free" })]);
    const left = Object.fromEntries((await guest("GET", "/guest/b/abcd2345/coupons")).json().coupons.map((c: { id: string; left: number | null }) => [c.id, c.left]));
    expect(left).toEqual({ [C]: 2, gone: 0, free: null });
  });

  it("gives a limited coupon to guests only while places are left, counting under a lock", async () => {
    db.coupon.findFirst.mockResolvedValue(coupon({ maxUses: 2 }));
    db.couponUse.count.mockResolvedValue(1);
    expect((await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() })).statusCode).toBe(200);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    db.couponUse.create.mockClear();
    db.couponUse.count.mockResolvedValue(2);
    const late = await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe("coupon_sold_out");
    expect(db.couponUse.create).not.toHaveBeenCalled();
  });

  it("does not count or lock a coupon without a limit", async () => {
    expect((await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() })).statusCode).toBe(200);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.couponUse.count).not.toHaveBeenCalled();
  });

  it("needs a signed-in member of a live business", async () => {
    expect((await guest("GET", "/guest/b/abcd2345/coupons", undefined, false)).statusCode).toBe(401);
    db.membership.findUnique.mockResolvedValue(null);
    expect((await guest("GET", "/guest/b/abcd2345/coupons")).json().error).toBe("not_member");
    db.business.findUnique.mockResolvedValue({ ...BIZ, paidUntil: null });
    expect((await guest("GET", "/guest/b/abcd2345/coupons")).statusCode).toBe(404);
  });

  it("uses a coupon with today's staff code, once per guest", async () => {
    const ok = await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() });
    expect(ok.statusCode).toBe(200);
    expect(db.couponUse.create.mock.calls[0]![0].data).toEqual({ couponId: C, membershipId: "m1" });
    db.couponUse.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect((await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() })).json().error).toBe("coupon_already_used");
  });

  it("refuses a wrong code, and a coupon that is off, ended or from another business", async () => {
    const wrong = await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() === "000000" ? "111111" : "000000" });
    expect(wrong.statusCode).toBe(403);
    expect(db.couponUse.create).not.toHaveBeenCalled();
    db.coupon.findFirst.mockResolvedValue(coupon({ active: false }));
    expect((await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() })).statusCode).toBe(404);
    db.coupon.findFirst.mockResolvedValue(coupon({ endsAt: new Date(Date.now() - DAY) }));
    expect((await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() })).statusCode).toBe(404);
    db.coupon.findFirst.mockResolvedValue(null);
    expect((await guest("POST", `/guest/b/abcd2345/coupons/${C}/use`, { staffCode: code() })).statusCode).toBe(404);
    expect(db.coupon.findFirst.mock.calls[0]![0].where).toEqual({ id: C, businessId: B });
  });
});
