import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/lib/sessionCookie.js";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn(), findUnique: vi.fn() },
  guest: { findUnique: vi.fn() },
  membership: { findUnique: vi.fn() },
  loyaltyProgram: { findUnique: vi.fn(), upsert: vi.fn() },
  loyaltyCard: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  loyaltyPunch: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { cardExpired, cardExpiry, isNearEnough, isStaffCode, staffCode, utcDay, windowState } from "../src/lib/loyalty.js";

const B = "11111111-1111-4111-8111-111111111111";
const TODAY = utcDay(new Date());
const DAY_MS = 86_400_000;

describe("loyalty rules", () => {
  it("makes a six digit code that differs per business and per day, and checks it", () => {
    const code = staffCode(B, "2026-06-01", "secret-secret-secret-secret-1234");
    expect(code).toMatch(/^\d{6}$/);
    expect(staffCode(B, "2026-06-02", "secret-secret-secret-secret-1234")).not.toBe(code);
    expect(staffCode("other", "2026-06-01", "secret-secret-secret-secret-1234")).not.toBe(code);
    expect(isStaffCode(code, B, "2026-06-01", "secret-secret-secret-secret-1234")).toBe(true);
    expect(isStaffCode(code, B, "2026-06-02", "secret-secret-secret-secret-1234")).toBe(false);
    expect(isStaffCode("12345", B, "2026-06-01", "secret-secret-secret-secret-1234")).toBe(false);
    expect(isStaffCode(undefined, B, "2026-06-01", "secret-secret-secret-secret-1234")).toBe(false);
  });

  it("allows for the phone's own accuracy, but only up to 100 m", () => {
    expect(isNearEnough(100, 150, undefined)).toBe(true);
    expect(isNearEnough(200, 150, undefined)).toBe(false);
    expect(isNearEnough(200, 150, 60)).toBe(true);
    expect(isNearEnough(400, 150, 5000)).toBe(false);
  });

  it("knows when the program runs", () => {
    const now = new Date("2026-04-02T12:00:00Z");
    expect(windowState(new Date("2026-04-01T00:00:00Z"), new Date("2026-04-03T23:59:59Z"), now)).toBe("active");
    expect(windowState(new Date("2026-04-05T00:00:00Z"), null, now)).toBe("upcoming");
    expect(windowState(null, new Date("2026-04-01T00:00:00Z"), now)).toBe("ended");
    expect(windowState(null, null, now)).toBe("active");
  });

  it("gives a card an end only when the program limits how long a card lasts", () => {
    const from = new Date("2026-04-01T10:00:00Z");
    expect(cardExpiry(null, from)).toBeNull();
    expect(cardExpiry(30, from)).toEqual(new Date("2026-05-01T10:00:00Z"));
  });

  it("runs out an unfinished card after its end, never a finished one", () => {
    const now = new Date("2026-04-10T12:00:00Z");
    const before = new Date("2026-04-09T12:00:00Z");
    const after = new Date("2026-04-11T12:00:00Z");
    expect(cardExpired({ completedAt: null, expiresAt: before }, now)).toBe(true);
    expect(cardExpired({ completedAt: null, expiresAt: after }, now)).toBe(false);
    expect(cardExpired({ completedAt: null, expiresAt: null }, now)).toBe(false);
    expect(cardExpired({ completedAt: new Date(), expiresAt: before }, now)).toBe(false);
  });
});

describe("setting up the program", () => {
  async function owner(method: "GET" | "PUT", payload?: object) {
    const app = await buildApp();
    const res = await app.inject({ method, url: `/businesses/${B}/loyalty`, payload, headers: { cookie: `${SESSION_COOKIE}=${app.jwt.sign({ sub: "u1" })}` } });
    await app.close();
    return res;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue({ id: B, ownerId: "u1", lat: 44.1, lng: 15.2 });
    db.loyaltyProgram.upsert.mockImplementation(async ({ create }: { create: object }) => create);
  });

  it("shows a blank program and today's staff code", async () => {
    db.loyaltyProgram.findUnique.mockResolvedValue(null);
    const res = await owner("GET");
    expect(res.json().program).toMatchObject({ enabled: false, goal: 10, cardValidDays: null, radiusMeters: 150 });
    expect(res.json().staffCode).toBe(staffCode(B, TODAY, config.JWT_SECRET));
  });

  it("saves the rule, and refuses a period that ends before it starts, a goal outside 2 to 50, and switching on without a location", async () => {
    expect((await owner("PUT", { enabled: true, goal: 10, rewardText: "Free meal", startsAt: "2026-04-01", endsAt: "2026-04-03" })).statusCode).toBe(200);
    expect(db.loyaltyProgram.upsert.mock.calls[0]![0].create).toMatchObject({ businessId: B, goal: 10, rewardText: "Free meal" });
    expect((await owner("PUT", { enabled: true, goal: 10, rewardText: "x", startsAt: "2026-04-03", endsAt: "2026-04-01" })).json().error).toBe("invalid_period");
    expect((await owner("PUT", { enabled: true, goal: 1, rewardText: "x" })).statusCode).toBe(400);
    expect((await owner("PUT", { enabled: true, goal: 51, rewardText: "x" })).statusCode).toBe(400);
    db.business.findFirst.mockResolvedValue({ id: B, ownerId: "u1", lat: null, lng: null });
    expect((await owner("PUT", { enabled: true, goal: 5, rewardText: "x" })).json().error).toBe("google_not_connected");
    expect((await owner("PUT", { enabled: false, goal: 5, rewardText: "x" })).statusCode).toBe(200);
  });

  it("saves how many days a card lasts, clears it with null, leaves it alone when missing, and refuses 0 or more than 730", async () => {
    const rule = { enabled: true, goal: 5, rewardText: "x" };
    await owner("PUT", { ...rule, cardValidDays: 90 });
    expect(db.loyaltyProgram.upsert.mock.calls[0]![0].create).toMatchObject({ cardValidDays: 90 });
    await owner("PUT", { ...rule, cardValidDays: null });
    expect(db.loyaltyProgram.upsert.mock.calls[1]![0].update).toMatchObject({ cardValidDays: null });
    await owner("PUT", rule);
    expect(db.loyaltyProgram.upsert.mock.calls[2]![0].update).not.toHaveProperty("cardValidDays");
    expect((await owner("PUT", { ...rule, cardValidDays: 0 })).statusCode).toBe(400);
    expect((await owner("PUT", { ...rule, cardValidDays: 731 })).statusCode).toBe(400);
  });

  it("keeps other owners out", async () => {
    db.business.findFirst.mockResolvedValue(null);
    expect((await owner("GET")).statusCode).toBe(404);
  });
});

describe("stamps", () => {
  const PROGRAM = { enabled: true, goal: 3, rewardText: "Free meal", startsAt: null, endsAt: null, cardValidDays: null, radiusMeters: 150 };
  const BIZ = { id: B, publishedAt: new Date(), paidUntil: new Date(Date.now() + 86_400_000), lat: 44.12, lng: 15.23, loyaltyProgram: PROGRAM };
  const card = (punches: number, over = {}) => ({ id: "c1", membershipId: "m1", goal: 3, rewardText: "Free meal", completedAt: null, redeemedAt: null, expiresAt: null, _count: { punches }, ...over });

  async function call(url: string, payload?: object, signedIn = true) {
    const app = await buildApp();
    const headers = signedIn ? { cookie: `guest=${app.jwt.sign({ sub: "g1", kind: "guest" } as never)}` } : {};
    const res = await app.inject({ method: payload === undefined && url.endsWith("loyalty") ? "GET" : "POST", url, payload, headers });
    await app.close();
    return res;
  }
  const code = () => staffCode(B, TODAY, config.JWT_SECRET);
  const HERE = { lat: 44.1201, lng: 15.2301 };

  beforeEach(() => {
    vi.clearAllMocks();
    db.guest.findUnique.mockResolvedValue({ id: "g1" });
    db.business.findUnique.mockResolvedValue(BIZ);
    db.membership.findUnique.mockResolvedValue({ id: "m1" });
    db.loyaltyPunch.findFirst.mockResolvedValue(null);
    db.loyaltyCard.findFirst.mockResolvedValue(card(0));
    db.loyaltyPunch.create.mockResolvedValue({});
  });

  it("shows the card and whether today's stamp is taken", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(2));
    db.loyaltyPunch.findFirst.mockResolvedValue({ day: TODAY });
    const res = await call("/guest/b/abcd2345/loyalty");
    expect(res.json()).toMatchObject({ program: { goal: 3, window: "active" }, card: { punches: 2, goal: 3, complete: false }, punchedToday: true });
    db.business.findUnique.mockResolvedValue({ ...BIZ, loyaltyProgram: { ...PROGRAM, enabled: false } });
    expect((await call("/guest/b/abcd2345/loyalty")).json().program).toBeNull();
  });

  it("gives a stamp to a guest who is at the business", async () => {
    const res = await call("/guest/b/abcd2345/loyalty/punch", HERE);
    expect(res.statusCode).toBe(200);
    expect(db.loyaltyPunch.create.mock.calls[0]![0].data).toMatchObject({ cardId: "c1", membershipId: "m1", day: TODAY, method: "LOCATION" });
  });

  it("starts a card with the program's goal and reward when there is none", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(null);
    db.loyaltyCard.create.mockResolvedValue(card(0));
    await call("/guest/b/abcd2345/loyalty/punch", HERE);
    expect(db.loyaltyCard.create.mock.calls[0]![0].data).toMatchObject({ membershipId: "m1", goal: 3, rewardText: "Free meal" });
  });

  it("starts a card that ends after the program's number of days", async () => {
    db.business.findUnique.mockResolvedValue({ ...BIZ, loyaltyProgram: { ...PROGRAM, cardValidDays: 30 } });
    db.loyaltyCard.findFirst.mockResolvedValue(null);
    db.loyaltyCard.create.mockResolvedValue(card(0));
    const before = Date.now();
    await call("/guest/b/abcd2345/loyalty/punch", HERE);
    const expiresAt = db.loyaltyCard.create.mock.calls[0]![0].data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
  });

  it("starts a card without an end when the program has no limit", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(null);
    db.loyaltyCard.create.mockResolvedValue(card(0));
    await call("/guest/b/abcd2345/loyalty/punch", HERE);
    expect(db.loyaltyCard.create.mock.calls[0]![0].data.expiresAt).toBeNull();
  });

  it("starts a new card when the one in progress has run out", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(2, { expiresAt: new Date(Date.now() - 1000) }));
    db.loyaltyCard.create.mockResolvedValue(card(0, { id: "c2" }));
    const res = await call("/guest/b/abcd2345/loyalty/punch", HERE);
    expect(res.statusCode).toBe(200);
    expect(db.loyaltyCard.create).toHaveBeenCalledTimes(1);
    expect(db.loyaltyPunch.create.mock.calls[0]![0].data.cardId).toBe("c2");
  });

  it("shows no card when the one in progress has run out", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(2, { expiresAt: new Date(Date.now() - 1000) }));
    expect((await call("/guest/b/abcd2345/loyalty")).json().card).toBeNull();
  });

  it("tells the guest how long a card lasts and when the current one ends", async () => {
    const expiresAt = new Date(Date.now() + 5 * DAY_MS);
    db.business.findUnique.mockResolvedValue({ ...BIZ, loyaltyProgram: { ...PROGRAM, cardValidDays: 30 } });
    db.loyaltyCard.findFirst.mockResolvedValue(card(1, { expiresAt }));
    const res = await call("/guest/b/abcd2345/loyalty");
    expect(res.json().program.cardValidDays).toBe(30);
    expect(res.json().card.expiresAt).toBe(expiresAt.toISOString());
  });

  it("does not run out a full card", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(3, { completedAt: new Date(), expiresAt: new Date(Date.now() - 1000) }));
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE)).json().error).toBe("card_complete");
  });

  it("refuses a guest who is far away, and one who gave no proof", async () => {
    const far = await call("/guest/b/abcd2345/loyalty/punch", { lat: 44.2, lng: 15.4 });
    expect(far.statusCode).toBe(422);
    expect(far.json().error).toBe("too_far");
    expect((await call("/guest/b/abcd2345/loyalty/punch", {})).json().error).toBe("location_required");
    expect(db.loyaltyPunch.create).not.toHaveBeenCalled();
  });

  it("accepts today's staff code instead of a location, and refuses a wrong or old one", async () => {
    const ok = await call("/guest/b/abcd2345/loyalty/punch", { staffCode: code() });
    expect(ok.statusCode).toBe(200);
    expect(db.loyaltyPunch.create.mock.calls[0]![0].data.method).toBe("STAFF_CODE");
    const wrong = await call("/guest/b/abcd2345/loyalty/punch", { staffCode: code() === "000000" ? "111111" : "000000" });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("wrong_code");
  });

  it("gives one stamp a day, even when two taps arrive together", async () => {
    db.loyaltyPunch.findFirst.mockResolvedValue({ day: TODAY });
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE)).json().error).toBe("already_punched_today");
    db.loyaltyPunch.findFirst.mockResolvedValue({ day: "2020-01-01" });
    db.loyaltyPunch.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE)).json().error).toBe("already_punched_today");
  });

  it("completes the card on the last stamp, and gives no more stamps until it is redeemed", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(2));
    await call("/guest/b/abcd2345/loyalty/punch", HERE);
    expect(db.loyaltyCard.update.mock.calls[0]![0].data.completedAt).toBeInstanceOf(Date);
    db.loyaltyCard.update.mockClear();
    db.loyaltyCard.findFirst.mockResolvedValue(card(3, { completedAt: new Date() }));
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE)).json().error).toBe("card_complete");
  });

  it("does not stamp before the program starts or after it ends", async () => {
    db.business.findUnique.mockResolvedValue({ ...BIZ, loyaltyProgram: { ...PROGRAM, endsAt: new Date(Date.now() - 1000) } });
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE)).json().error).toBe("program_not_active");
    db.business.findUnique.mockResolvedValue({ ...BIZ, loyaltyProgram: { ...PROGRAM, startsAt: new Date(Date.now() + 86_400_000) } });
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE)).json().error).toBe("program_not_active");
  });

  it("needs a signed-in member", async () => {
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE, false)).statusCode).toBe(401);
    db.membership.findUnique.mockResolvedValue(null);
    expect((await call("/guest/b/abcd2345/loyalty/punch", HERE)).json().error).toBe("not_member");
  });

  it("redeems a finished card only with today's staff code", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(3, { completedAt: new Date() }));
    const wrong = await call("/guest/b/abcd2345/loyalty/redeem", { staffCode: "999999" === code() ? "111111" : "999999" });
    expect(wrong.statusCode).toBe(403);
    expect(db.loyaltyCard.update).not.toHaveBeenCalled();
    const ok = await call("/guest/b/abcd2345/loyalty/redeem", { staffCode: code() });
    expect(ok.statusCode).toBe(200);
    expect(db.loyaltyCard.update.mock.calls[0]![0].data.redeemedAt).toBeInstanceOf(Date);
    db.loyaltyCard.findFirst.mockResolvedValue(card(1));
    expect((await call("/guest/b/abcd2345/loyalty/redeem", { staffCode: code() })).json().error).toBe("nothing_to_redeem");
  });
});