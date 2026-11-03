import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../../src/lib/auth/sessionCookie.js";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  shopOrder: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../../../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../../../src/lib/mail/mail.js", () => mail);
vi.mock("../../../src/config.js", async (original) => {
  const actual = await original<typeof import("../../../src/config.js")>();
  return { ...actual, config: { ...actual.config, OPERATOR_EMAILS: "ops@example.com" } };
});

import { buildApp } from "../../../src/app.js";
import { config } from "../../../src/config.js";
import { shopKey } from "../../../src/lib/shop/order.js";

const OID = "44444444-4444-4444-8444-444444444444";
const OPERATOR = "op1";
const OWNER = "u1";
const BUSINESS = { id: "11111111-1111-4111-8111-111111111111", name: "Salon Lana", ownerId: OWNER };
const SHIPPED_AT = new Date("2026-11-02T12:00:00Z");

const orderRow = (over = {}) => ({ id: OID, status: "PAID", shippedAt: null, deliveredAt: null, trackingUrl: null, business: BUSINESS, ...over });

async function call(user: string | null, method: "GET" | "PATCH", url: string, payload?: object) {
  const app = await buildApp();
  const headers = user ? { cookie: `${SESSION_COOKIE}=${app.jwt.sign({ sub: user })}` } : undefined;
  const res = await app.inject({ method, url, payload, headers });
  await app.close();
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ email: where.id === OPERATOR ? "ops@example.com" : "owner@example.com" }));
  db.shopOrder.findUnique.mockResolvedValue(orderRow());
  db.shopOrder.update.mockImplementation(async ({ data }: { data: object }) => ({ id: OID, shippedAt: null, deliveredAt: null, trackingUrl: null, ...data }));
});

describe("who may open the order admin", () => {
  it("lets an operator in and keeps owners and strangers out", async () => {
    db.shopOrder.findMany.mockResolvedValue([]);
    expect((await call(OPERATOR, "GET", "/admin/shop/orders")).statusCode).toBe(200);
    expect((await call(OWNER, "GET", "/admin/shop/orders")).statusCode).toBe(403);
    expect((await call(null, "GET", "/admin/shop/orders")).statusCode).toBe(401);
    expect((await call(OWNER, "PATCH", `/admin/shop/orders/${OID}/status`, { status: "SHIPPED" })).statusCode).toBe(403);
    expect(db.shopOrder.update).not.toHaveBeenCalled();
  });
});

describe("the order list", () => {
  it("shows paid orders with the customer, the business and the owner, newest first", async () => {
    db.shopOrder.findMany.mockResolvedValue([
      {
        id: OID, status: "PAID", totalCents: 2500, currency: "eur", createdAt: SHIPPED_AT, paidAt: SHIPPED_AT, shippedAt: null, deliveredAt: null, trackingUrl: null,
        name: "Ana", line1: "Obala 1", line2: null, postalCode: "23000", city: "Zadar", country: "HR", phone: null,
        items: [{ design: "halo", finish: "amber", size: "M", printText: "Salon Lana" }],
        business: { id: BUSINESS.id, name: BUSINESS.name, owner: { email: "owner@example.com" } },
      },
    ]);
    const res = await call(OPERATOR, "GET", "/admin/shop/orders");
    expect(res.json()[0]).toMatchObject({ id: OID, status: "PAID", business: "Salon Lana", ownerEmail: "owner@example.com", city: "Zadar" });
    const query = db.shopOrder.findMany.mock.calls[0]![0];
    expect(query.where).toEqual({ status: { in: ["PAID", "SHIPPED", "DELIVERED"] } });
    expect(query.orderBy).toEqual({ createdAt: "desc" });
  });

  it("filters by one status and refuses an unknown one", async () => {
    db.shopOrder.findMany.mockResolvedValue([]);
    await call(OPERATOR, "GET", "/admin/shop/orders?status=SHIPPED");
    expect(db.shopOrder.findMany.mock.calls[0]![0].where).toEqual({ status: "SHIPPED" });
    expect((await call(OPERATOR, "GET", "/admin/shop/orders?status=PENDING_PAYMENT")).statusCode).toBe(400);
  });
});

describe("changing the status", () => {
  const patch = (body: object) => call(OPERATOR, "PATCH", `/admin/shop/orders/${OID}/status`, body);

  it("posts a paid order, stores the tracking link and tells the owner once", async () => {
    const res = await patch({ status: "SHIPPED", trackingUrl: "https://track.example.com/1" });
    expect(res.statusCode).toBe(200);
    expect(db.shopOrder.update.mock.calls[0]![0].data).toMatchObject({ status: "SHIPPED", trackingUrl: "https://track.example.com/1" });
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ to: "owner@example.com" });
    expect(mail.sendMail.mock.calls[0]![0].html).toContain("https://track.example.com/1");
  });

  it("marks an order delivered without another email", async () => {
    db.shopOrder.findUnique.mockResolvedValue(orderRow({ status: "SHIPPED", shippedAt: SHIPPED_AT }));
    const res = await patch({ status: "DELIVERED" });
    expect(res.statusCode).toBe(200);
    expect(db.shopOrder.update.mock.calls[0]![0].data).toMatchObject({ status: "DELIVERED", shippedAt: SHIPPED_AT });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it("can undo a mistake by stepping back", async () => {
    db.shopOrder.findUnique.mockResolvedValue(orderRow({ status: "DELIVERED", shippedAt: SHIPPED_AT, deliveredAt: SHIPPED_AT }));
    await patch({ status: "SHIPPED" });
    expect(db.shopOrder.update.mock.calls[0]![0].data).toMatchObject({ status: "SHIPPED", deliveredAt: null });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it("refuses an unpaid order, an unknown order, an unknown status and a link that is not a web address", async () => {
    db.shopOrder.findUnique.mockResolvedValue(orderRow({ status: "PENDING_PAYMENT" }));
    expect((await patch({ status: "SHIPPED" })).statusCode).toBe(409);
    db.shopOrder.findUnique.mockResolvedValue(null);
    expect((await patch({ status: "SHIPPED" })).statusCode).toBe(404);
    expect((await patch({ status: "CANCELED" })).statusCode).toBe(400);
    expect((await patch({ status: "SHIPPED", trackingUrl: "javascript:alert(1)" })).statusCode).toBe(400);
    expect(db.shopOrder.update).not.toHaveBeenCalled();
  });
});

describe("the link in the maker's email after an order was delivered", () => {
  it("does not move a delivered order back to posted", async () => {
    db.shopOrder.findUnique.mockResolvedValue(orderRow({ status: "DELIVERED" }));
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/public/operator/shop/shipped", payload: { id: OID, key: shopKey(OID, config.JWT_SECRET) } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(db.shopOrder.update).not.toHaveBeenCalled();
  });
});