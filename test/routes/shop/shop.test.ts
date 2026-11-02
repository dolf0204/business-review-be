import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../../src/lib/auth/sessionCookie.js";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn() },
  businessSubscription: { findUnique: vi.fn() },
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  shopOrder: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("../../../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../../../src/lib/mail/mail.js", () => mail);
const stripeApi = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() } },
  webhooks: { constructEvent: vi.fn() },
}));
vi.mock("stripe", () => {
  class StripeError extends Error {}
  class Stripe {
    static errors = { StripeError };
    constructor() {
      return stripeApi as never;
    }
  }
  return { default: Stripe };
});

import { buildApp } from "../../../src/app.js";
import { config } from "../../../src/config.js";
import { shopKey } from "../../../src/lib/shop/order.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OID = "44444444-4444-4444-8444-444444444444";
const BIZ = { id: ID, ownerId: "u1", code: "abcd2345", name: "Salon <Lana>" };
const YEAR_END = new Date(Date.now() + 200 * 86_400_000);
const YEARLY = { interval: "YEAR", status: "ACTIVE", currentPeriodEnd: YEAR_END };
const address = { name: "Ana Horvat", line1: "Obala 1", postalCode: "23000", city: "Zadar", country: "hr" };
const stand = (size: "S" | "M" | "L", printText = "Salon Lana") => ({ design: "halo", finish: "amber", size, printText });

async function owner(method: "GET" | "POST", url: string, payload?: object) {
  const app = await buildApp();
  const res = await app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE}=${app.jwt.sign({ sub: "u1" })}` } });
  await app.close();
  return res;
}

const orderRow = (over = {}) => ({
  id: OID, status: "PENDING_PAYMENT", subtotalCents: 2500, shippingCents: 0, totalCents: 2500, createdAt: new Date("2026-11-02T12:00:00Z"), name: "Ana", line1: "Obala 1", line2: null, postalCode: "23000", city: "Zadar", country: "HR", phone: null,
  items: [{ design: "halo", finish: "amber", size: "M", printText: "Salon Lana", listCents: 2500, unitCents: 2500 }], business: { ...BIZ, owner: { email: "owner@example.com" } }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mail.sendMail.mockResolvedValue(undefined);
  db.business.findFirst.mockResolvedValue(BIZ);
  db.businessSubscription.findUnique.mockResolvedValue(null);
  db.user.findUniqueOrThrow.mockResolvedValue({ email: "owner@example.com", stripeCustomerId: null });
  db.user.findUnique.mockResolvedValue({ email: "owner@example.com" });
  db.shopOrder.findFirst.mockResolvedValue(null);
  db.shopOrder.findMany.mockResolvedValue([]);
  db.shopOrder.updateMany.mockResolvedValue({ count: 1 });
  db.shopOrder.create.mockImplementation(async ({ data }: { data: object }) => ({ id: OID, ...data }));
  stripeApi.checkout.sessions.create.mockResolvedValue({ id: "cs_test_12345", url: "https://checkout.example.com/pay" });
});

describe("the catalog and quotes", () => {
  it("shows the catalog to anyone", async () => {
    const app = await buildApp();
    const res = await app.inject({ url: "/public/shop" });
    await app.close();
    expect(res.json().sizes).toEqual([{ size: "S", priceCents: 2000 }, { size: "M", priceCents: 2500 }, { size: "L", priceCents: 3000 }]);
  });
  it("quotes full prices without a plan and the discount and the free stand with a yearly plan", async () => {
    expect((await owner("POST", `/businesses/${ID}/shop/quote`, { items: [stand("S"), stand("L")] })).json().totalCents).toBe(5000);
    db.businessSubscription.findUnique.mockResolvedValue(YEARLY);
    const q = (await owner("POST", `/businesses/${ID}/shop/quote`, { items: [stand("S"), stand("L")] })).json();
    expect(q.items.map((i: { unitCents: number }) => i.unitCents)).toEqual([1500, 0]);
    expect(q.freeApplied).toBe(true);
  });
  it("does not offer the free stand again once the period's free stand is taken", async () => {
    db.businessSubscription.findUnique.mockResolvedValue(YEARLY);
    db.shopOrder.findFirst.mockResolvedValue({ id: "old" });
    const q = (await owner("POST", `/businesses/${ID}/shop/quote`, { items: [stand("L")] })).json();
    expect(q.totalCents).toBe(2250);
    expect(q.freeApplied).toBe(false);
  });
  it("tells the owner what the shop offers, and keeps other owners out", async () => {
    db.businessSubscription.findUnique.mockResolvedValue(YEARLY);
    const res = await owner("GET", `/businesses/${ID}/shop`);
    expect(res.json()).toMatchObject({ available: true, payOnline: true, yearly: true, freeAvailable: true, discountPercent: 25 });
    db.business.findFirst.mockResolvedValue(null);
    expect((await owner("GET", `/businesses/${ID}/shop`)).statusCode).toBe(404);
    expect((await owner("POST", `/businesses/${ID}/shop/quote`, { items: [stand("S")] })).statusCode).toBe(404);
  });
});

describe("placing an order", () => {
  it("sends a paying owner to Stripe with the exact amounts from our catalog, and no line for a free stand", async () => {
    db.businessSubscription.findUnique.mockResolvedValue(YEARLY);
    const res = await owner("POST", `/businesses/${ID}/shop/orders`, { items: [stand("M"), stand("L")], address });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: OID, url: "https://checkout.example.com/pay" });
    const data = db.shopOrder.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ businessId: ID, totalCents: 1875, country: "HR", freePeriodEnd: YEAR_END });
    const session = stripeApi.checkout.sessions.create.mock.calls[0]![0];
    expect(session.mode).toBe("payment");
    expect(session.metadata).toEqual({ shopOrderId: OID });
    expect(session.success_url).toBe(`http://localhost:5190/shop?business=${ID}&shop_session={CHECKOUT_SESSION_ID}&order=${OID}`);
    expect(session.cancel_url).toBe(`http://localhost:5190/shop?business=${ID}&shop_canceled=1`);
    expect(session.line_items.map((l: { price_data: { unit_amount: number } }) => l.price_data.unit_amount)).toEqual([1875]);
    expect(db.shopOrder.update.mock.calls[0]![0].data).toEqual({ stripeSessionId: "cs_test_12345" });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
  it("finishes a fully free order at once and mails the maker the QR code and the owner a thank you", async () => {
    db.businessSubscription.findUnique.mockResolvedValue(YEARLY);
    db.shopOrder.findUnique.mockResolvedValue(orderRow({ totalCents: 0, items: [{ design: "halo", finish: "amber", size: "L", printText: "Salon Lana", unitCents: 0 }] }));
    const res = await owner("POST", `/businesses/${ID}/shop/orders`, { items: [stand("L")], address });
    expect(res.json()).toEqual({ id: OID, url: null });
    expect(stripeApi.checkout.sessions.create).not.toHaveBeenCalled();
    const toMaker = mail.sendMail.mock.calls[0]![0];
    expect(toMaker.to).toBe("kits@example.com");
    expect(toMaker.attachments.map((a: { name: string }) => a.name)).toEqual(["qr-abcd2345.png"]);
    expect(toMaker.html).toContain("FREE, yearly plan");
    expect(toMaker.html).toContain("http://localhost:5190/b/abcd2345?s=n");
    expect(toMaker.html).not.toContain("<Lana>");
    expect(mail.sendMail.mock.calls[1]![0].to).toBe("owner@example.com");
  });
  it("sells to an owner without a plan at full price", async () => {
    const res = await owner("POST", `/businesses/${ID}/shop/orders`, { items: [stand("S")], address });
    expect(res.statusCode).toBe(201);
    expect(db.shopOrder.create.mock.calls[0]![0].data).toMatchObject({ totalCents: 2000, freePeriodEnd: null });
  });
  it("answers 409 when two clicks race for the one free stand", async () => {
    db.businessSubscription.findUnique.mockResolvedValue(YEARLY);
    db.shopOrder.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect((await owner("POST", `/businesses/${ID}/shop/orders`, { items: [stand("S")], address })).json().error).toBe("free_stand_already_used");
  });
  it("releases an unpaid earlier order first, so its free stand is not stuck", async () => {
    db.shopOrder.findMany.mockResolvedValue([{ id: "old", stripeSessionId: "cs_old_12345" }]);
    await owner("POST", `/businesses/${ID}/shop/orders`, { items: [stand("S")], address });
    expect(stripeApi.checkout.sessions.expire).toHaveBeenCalledWith("cs_old_12345");
    expect(db.shopOrder.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: "old" }, data: { status: "CANCELED", freePeriodEnd: null } });
  });
  it("refuses a country we do not post to, an empty cart, a long engraving and a made-up design", async () => {
    expect((await owner("POST", `/businesses/${ID}/shop/orders`, { items: [stand("S")], address: { ...address, country: "US" } })).json().error).toBe("country_not_supported");
    expect((await owner("POST", `/businesses/${ID}/shop/orders`, { items: [], address })).statusCode).toBe(400);
    expect((await owner("POST", `/businesses/${ID}/shop/orders`, { items: [stand("S", "x".repeat(33))], address })).statusCode).toBe(400);
    expect((await owner("POST", `/businesses/${ID}/shop/orders`, { items: [{ ...stand("S"), design: "unicorn" }], address })).statusCode).toBe(400);
    expect(db.shopOrder.create).not.toHaveBeenCalled();
  });
});

describe("paying", () => {
  beforeEach(() => {
    db.shopOrder.findFirst.mockResolvedValue({ id: OID, status: "PENDING_PAYMENT", stripeSessionId: "cs_test_12345" });
    db.shopOrder.findUnique.mockResolvedValue(orderRow());
  });
  it("marks the order paid when Stripe says the session is paid and the amount matches", async () => {
    stripeApi.checkout.sessions.retrieve.mockResolvedValue({ payment_status: "paid", amount_total: 2500 });
    const res = await owner("POST", `/businesses/${ID}/shop/orders/${OID}/confirm`, { sessionId: "cs_test_12345" });
    expect(res.json()).toEqual({ ok: true });
    expect(db.shopOrder.updateMany.mock.calls[0]![0].data).toMatchObject({ status: "PAID" });
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    expect(mail.sendMail.mock.calls[0]![0].html).toContain("Paid online: 25.00 EUR");
  });
  it("does nothing while unpaid, and refuses a session that is not this order's", async () => {
    stripeApi.checkout.sessions.retrieve.mockResolvedValue({ payment_status: "unpaid", amount_total: 2500 });
    expect((await owner("POST", `/businesses/${ID}/shop/orders/${OID}/confirm`, { sessionId: "cs_test_12345" })).statusCode).toBe(202);
    expect((await owner("POST", `/businesses/${ID}/shop/orders/${OID}/confirm`, { sessionId: "cs_other_99999" })).statusCode).toBe(403);
    expect(db.shopOrder.updateMany).not.toHaveBeenCalled();
  });
  it("does not accept a payment of a different amount", async () => {
    stripeApi.checkout.sessions.retrieve.mockResolvedValue({ payment_status: "paid", amount_total: 100 });
    await owner("POST", `/businesses/${ID}/shop/orders/${OID}/confirm`, { sessionId: "cs_test_12345" });
    expect(db.shopOrder.updateMany).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});

describe("the Stripe webhook for shop orders", () => {
  const send = async (event: object) => {
    stripeApi.webhooks.constructEvent.mockReturnValue(event);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/stripe/webhook", payload: JSON.stringify({ id: "evt" }), headers: { "content-type": "application/json", "stripe-signature": "sig" } });
    await app.close();
    return res;
  };
  it("fulfils a paid one-off payment of a shop order, once", async () => {
    db.shopOrder.findUnique.mockResolvedValue(orderRow());
    await send({ type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "paid", amount_total: 2500, metadata: { shopOrderId: OID } } } });
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
    db.shopOrder.findUnique.mockResolvedValue(orderRow({ status: "PAID" }));
    await send({ type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "paid", amount_total: 2500, metadata: { shopOrderId: OID } } } });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
  it("cancels the order, and frees its free stand, when the session expires", async () => {
    await send({ type: "checkout.session.expired", data: { object: { metadata: { shopOrderId: OID } } } });
    expect(db.shopOrder.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: OID }, data: { status: "CANCELED", freePeriodEnd: null } });
  });
});

describe("marking it as posted", () => {
  const post = async (payload: object) => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/public/operator/shop/shipped", payload });
    await app.close();
    return res;
  };
  beforeEach(() => {
    db.shopOrder.findUnique.mockResolvedValue({ id: OID, status: "PAID", business: { name: "Salon", ownerId: "u1" } });
  });
  it("marks a paid order posted with the key from the mail and tells the owner, with the tracking link", async () => {
    const res = await post({ id: OID, key: shopKey(OID, config.JWT_SECRET), trackingUrl: "https://track.example.com/1" });
    expect(res.statusCode).toBe(200);
    expect(db.shopOrder.update.mock.calls[0]![0].data).toMatchObject({ status: "SHIPPED", trackingUrl: "https://track.example.com/1" });
    expect(mail.sendMail.mock.calls[0]![0].html).toContain("https://track.example.com/1");
  });
  it("refuses a wrong key, a link that is not a web address and an unpaid order, and does nothing twice", async () => {
    expect((await post({ id: OID, key: "x".repeat(43) })).statusCode).toBe(400);
    expect((await post({ id: OID, key: shopKey(OID, config.JWT_SECRET), trackingUrl: "javascript:alert(1)" })).statusCode).toBe(400);
    db.shopOrder.findUnique.mockResolvedValue({ id: OID, status: "PENDING_PAYMENT", business: { name: "S", ownerId: "u1" } });
    expect((await post({ id: OID, key: shopKey(OID, config.JWT_SECRET) })).statusCode).toBe(409);
    db.shopOrder.findUnique.mockResolvedValue({ id: OID, status: "SHIPPED", business: { name: "S", ownerId: "u1" } });
    await post({ id: OID, key: shopKey(OID, config.JWT_SECRET) });
    expect(db.shopOrder.update).not.toHaveBeenCalled();
  });
  it("shows the maker what the key opens", async () => {
    db.shopOrder.findUnique.mockResolvedValue({ id: OID, status: "PAID", name: "Ana", city: "Zadar", country: "HR", items: [], business: { name: "Salon" } });
    const app = await buildApp();
    const ok = await app.inject({ url: `/public/operator/shop?id=${OID}&key=${shopKey(OID, config.JWT_SECRET)}` });
    const bad = await app.inject({ url: `/public/operator/shop?id=${OID}&key=${"x".repeat(43)}` });
    await app.close();
    expect(ok.json()).toMatchObject({ business: "Salon", city: "Zadar", status: "PAID" });
    expect(bad.statusCode).toBe(400);
  });
});