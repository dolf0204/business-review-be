import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/lib/sessionCookie.js";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  businessSubscription: { findUnique: vi.fn(), upsert: vi.fn() },
  user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));

const stripeApi = vi.hoisted(() => ({
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  subscriptions: { retrieve: vi.fn() },
  prices: { retrieve: vi.fn() },
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

import { buildApp } from "../src/app.js";
import { clearPriceCache, syncSubscription } from "../src/billing/stripe.js";
import { statusFromStripe } from "../src/billing/map.js";
import { isLive } from "../src/lib/live.js";

const ID = "11111111-1111-4111-8111-111111111111";
const FUTURE = new Date(Date.now() + 30 * 86_400_000);
const subscription = (over = {}) => ({
  id: "sub_1", status: "active", cancel_at_period_end: false, metadata: { businessId: ID },
  items: { data: [{ price: { id: "price_month", recurring: { interval: "month" } }, current_period_end: Math.floor(FUTURE.getTime() / 1000) }] }, ...over,
});

async function owner(method: "GET" | "POST", url: string, payload?: object) {
  const app = await buildApp();
  const res = await app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE}=${app.jwt.sign({ sub: "u1" })}` } });
  await app.close();
  return res;
}

describe("rules", () => {
  it("a page is live only when published and paid up", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(isLive({ publishedAt: new Date(), paidUntil: new Date("2026-07-01") }, now)).toBe(true);
    expect(isLive({ publishedAt: null, paidUntil: new Date("2026-07-01") }, now)).toBe(false);
    expect(isLive({ publishedAt: new Date(), paidUntil: new Date("2026-05-01") }, now)).toBe(false);
    expect(isLive({ publishedAt: new Date(), paidUntil: null }, now)).toBe(false);
  });
  it("reads Stripe's states", () => {
    expect(["active", "trialing"].map(statusFromStripe)).toEqual(["ACTIVE", "ACTIVE"]);
    expect(["past_due", "unpaid", "incomplete"].map(statusFromStripe)).toEqual(["PAST_DUE", "PAST_DUE", "PAST_DUE"]);
    expect(["canceled", "incomplete_expired", "paused"].map(statusFromStripe)).toEqual(["CANCELED", "CANCELED", "CANCELED"]);
  });
});

describe("syncing a subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findUnique.mockResolvedValue({ id: ID });
  });

  it("marks the business paid until the end of the period", async () => {
    stripeApi.subscriptions.retrieve.mockResolvedValue(subscription());
    const res = await syncSubscription("sub_1");
    expect(res).toEqual({ businessId: ID, paid: true });
    expect(db.businessSubscription.upsert.mock.calls[0]![0].create).toMatchObject({ businessId: ID, stripeSubscriptionId: "sub_1", status: "ACTIVE", interval: "MONTH" });
    expect(db.business.update.mock.calls[0]![0].data.paidUntil).toEqual(new Date(Math.floor(FUTURE.getTime() / 1000) * 1000));
  });

  it("counts a year price as a yearly subscription", async () => {
    const s = subscription();
    s.items.data[0]!.price.recurring.interval = "year";
    stripeApi.subscriptions.retrieve.mockResolvedValue(s);
    await syncSubscription("sub_1");
    expect(db.businessSubscription.upsert.mock.calls[0]![0].create.interval).toBe("YEAR");
  });

  it("takes the page off the guests' screens when the subscription ends, or the paid period is over", async () => {
    stripeApi.subscriptions.retrieve.mockResolvedValue(subscription({ status: "canceled" }));
    expect((await syncSubscription("sub_1"))?.paid).toBe(false);
    expect(db.business.update.mock.calls[0]![0].data).toEqual({ paidUntil: null, publishedAt: null });
    expect(db.businessSubscription.upsert.mock.calls[0]![0].create.stripeSubscriptionId).toBeNull();
    const past = subscription({ status: "past_due" });
    past.items.data[0]!.current_period_end = Math.floor(Date.now() / 1000) - 3600;
    stripeApi.subscriptions.retrieve.mockResolvedValue(past);
    expect((await syncSubscription("sub_1"))?.paid).toBe(false);
  });

  it("keeps a page up while a failed payment is being retried inside the paid period", async () => {
    stripeApi.subscriptions.retrieve.mockResolvedValue(subscription({ status: "past_due" }));
    expect((await syncSubscription("sub_1"))?.paid).toBe(true);
  });

  it("ignores a subscription that does not belong to any business", async () => {
    stripeApi.subscriptions.retrieve.mockResolvedValue(subscription({ metadata: {} }));
    expect(await syncSubscription("sub_x")).toBeNull();
    db.business.findUnique.mockResolvedValue(null);
    stripeApi.subscriptions.retrieve.mockResolvedValue(subscription());
    expect(await syncSubscription("sub_x")).toBeNull();
    expect(db.business.update).not.toHaveBeenCalled();
  });
});

describe("the owner's billing screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPriceCache();
    db.business.findFirst.mockResolvedValue({ id: ID, ownerId: "u1", paidUntil: null });
    db.businessSubscription.findUnique.mockResolvedValue(null);
    stripeApi.prices.retrieve.mockImplementation(async (id: string) => ({ unit_amount: id === "price_month" ? 1900 : 19000, currency: "eur" }));
  });

  it("shows the two prices read from Stripe and that the page is not paid", async () => {
    const res = await owner("GET", `/businesses/${ID}/billing`);
    expect(res.json()).toMatchObject({ available: true, paid: false, prices: [{ interval: "MONTH", amountCents: 1900, currency: "eur" }, { interval: "YEAR", amountCents: 19000 }] });
  });

  it("shows the prices to visitors who are not signed in, and nothing when Stripe fails", async () => {
    const app = await buildApp();
    const ok = await app.inject({ url: "/public/pricing" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().prices).toEqual([{ interval: "MONTH", amountCents: 1900, currency: "eur" }, { interval: "YEAR", amountCents: 19000, currency: "eur" }]);
    expect(ok.headers["cache-control"]).toContain("max-age=300");
    clearPriceCache();
    stripeApi.prices.retrieve.mockRejectedValue(new Error("down"));
    expect((await app.inject({ url: "/public/pricing" })).json()).toEqual({ prices: [] });
    await app.close();
  });

  it("starts a checkout for the chosen price, with return addresses from config and the business in the metadata", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ email: "o@example.com", stripeCustomerId: null });
    stripeApi.customers.create.mockResolvedValue({ id: "cus_1" });
    stripeApi.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/x" });
    const res = await owner("POST", `/businesses/${ID}/billing/checkout`, { interval: "YEAR" });
    expect(res.json()).toEqual({ url: "https://checkout.stripe.com/c/x" });
    const args = stripeApi.checkout.sessions.create.mock.calls[0]![0];
    expect(args).toMatchObject({ mode: "subscription", customer: "cus_1", client_reference_id: ID, line_items: [{ price: "price_year", quantity: 1 }] });
    expect(args.success_url).toBe(`http://localhost:5190/businesses/${ID}?session_id={CHECKOUT_SESSION_ID}`);
    expect(args.subscription_data.metadata).toEqual({ businessId: ID });
    expect(db.user.update.mock.calls[0]![0].data).toEqual({ stripeCustomerId: "cus_1" });
  });

  it("refuses a price that is not one of the two, and a second subscription", async () => {
    expect((await owner("POST", `/businesses/${ID}/billing/checkout`, { interval: "WEEK" })).statusCode).toBe(400);
    db.businessSubscription.findUnique.mockResolvedValue({ stripeSubscriptionId: "sub_1", status: "ACTIVE" });
    expect((await owner("POST", `/businesses/${ID}/billing/checkout`, { interval: "MONTH" })).json().error).toBe("already_subscribed");
  });

  it("keeps other owners out", async () => {
    db.business.findFirst.mockResolvedValue(null);
    for (const [m, u] of [["GET", "billing"], ["POST", "billing/portal"]] as const) expect((await owner(m, `/businesses/${ID}/${u}`)).statusCode).toBe(404);
  });

  it("confirms a finished checkout of this business, and refuses one of another", async () => {
    stripeApi.checkout.sessions.retrieve.mockResolvedValue({ client_reference_id: ID, status: "complete", subscription: "sub_1" });
    stripeApi.subscriptions.retrieve.mockResolvedValue(subscription());
    db.business.findUnique.mockResolvedValue({ id: ID });
    expect((await owner("POST", `/businesses/${ID}/billing/confirm`, { sessionId: "cs_test_12345678" })).json()).toEqual({ ok: true });
    stripeApi.checkout.sessions.retrieve.mockResolvedValue({ client_reference_id: "22222222-2222-4222-8222-222222222222", status: "complete", subscription: "sub_1" });
    expect((await owner("POST", `/businesses/${ID}/billing/confirm`, { sessionId: "cs_test_12345678" })).statusCode).toBe(403);
  });

  it("opens the customer portal only for an owner who has a billing account", async () => {
    db.user.findUnique.mockResolvedValue({ stripeCustomerId: null });
    expect((await owner("POST", `/businesses/${ID}/billing/portal`)).json().error).toBe("no_billing_account");
    db.user.findUnique.mockResolvedValue({ stripeCustomerId: "cus_1" });
    stripeApi.billingPortal.sessions.create.mockResolvedValue({ url: "https://billing.stripe.com/p/x" });
    expect((await owner("POST", `/businesses/${ID}/billing/portal`)).json().url).toBe("https://billing.stripe.com/p/x");
  });
});

describe("the Stripe webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findUnique.mockResolvedValue({ id: ID });
    stripeApi.subscriptions.retrieve.mockResolvedValue(subscription());
  });
  const post = async (headers: Record<string, string>) => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/stripe/webhook", payload: JSON.stringify({ id: "evt_1" }), headers: { "content-type": "application/json", ...headers } });
    await app.close();
    return res;
  };

  it("refuses a request without a valid signature", async () => {
    expect((await post({})).statusCode).toBe(400);
    stripeApi.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    expect((await post({ "stripe-signature": "t=1,v1=bad" })).statusCode).toBe(400);
    expect(db.business.update).not.toHaveBeenCalled();
  });

  it("re-reads the subscription from Stripe for every subscription event", async () => {
    stripeApi.webhooks.constructEvent.mockReturnValue({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    expect((await post({ "stripe-signature": "t=1,v1=ok" })).statusCode).toBe(200);
    expect(stripeApi.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(db.business.update).toHaveBeenCalled();
    stripeApi.webhooks.constructEvent.mockReturnValue({ type: "charge.succeeded", data: { object: {} } });
    db.business.update.mockClear();
    expect((await post({ "stripe-signature": "t=1,v1=ok" })).statusCode).toBe(200);
    expect(db.business.update).not.toHaveBeenCalled();
  });
});
