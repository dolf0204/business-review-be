import argon2 from "argon2";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), delete: vi.fn() },
  business: { findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  upload: { findMany: vi.fn(), deleteMany: vi.fn() },
  businessSubscription: { findMany: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../src/lib/mail.js", () => mail);
const fsApi = vi.hoisted(() => ({ unlink: vi.fn() }));
vi.mock("node:fs/promises", async (orig) => ({ ...(await orig<typeof import("node:fs/promises")>()), unlink: fsApi.unlink }));
const stripeApi = vi.hoisted(() => ({ subscriptions: { cancel: vi.fn() } }));
vi.mock("stripe", () => {
  class StripeError extends Error {
    code?: string;
    constructor(m: string, code?: string) {
      super(m);
      this.code = code;
    }
  }
  class Stripe {
    static errors = { StripeError };
    constructor() {
      return stripeApi as never;
    }
  }
  return { default: Stripe };
});

import Stripe from "stripe";
import { buildApp } from "../src/app.js";

const BID = "11111111-1111-4111-8111-111111111111";
const FILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";

async function call(method: "DELETE", url: string, payload?: object) {
  const app = await buildApp();
  const res = await app.inject({ method, url, payload, headers: { cookie: `session=${app.jwt.sign({ sub: "u1" })}` } });
  await app.close();
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  fsApi.unlink.mockResolvedValue(undefined);
  db.businessSubscription.findMany.mockResolvedValue([{ stripeSubscriptionId: "sub_1" }]);
  stripeApi.subscriptions.cancel.mockResolvedValue({});
});

describe("deleting a business", () => {
  beforeEach(() => {
    db.business.findFirst.mockResolvedValue({ id: BID, ownerId: "u1", logoUrl: `/media/${FILE}`, backgroundUrl: null });
    db.upload.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("ends its subscription first, then deletes it and its picture", async () => {
    const res = await call("DELETE", `/businesses/${BID}`);
    expect(res.statusCode).toBe(204);
    expect(stripeApi.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(db.business.deleteMany).toHaveBeenCalledWith({ where: { id: BID, ownerId: "u1" } });
    expect(fsApi.unlink).toHaveBeenCalledTimes(1);
  });

  it("deletes nothing when Stripe cannot cancel, so the owner is not charged for a page that is gone", async () => {
    stripeApi.subscriptions.cancel.mockRejectedValue(new Stripe.errors.StripeError("down"));
    const res = await call("DELETE", `/businesses/${BID}`);
    expect(res.statusCode).toBe(502);
    expect(db.business.deleteMany).not.toHaveBeenCalled();
  });

  it("treats a subscription Stripe no longer has as already ended", async () => {
    stripeApi.subscriptions.cancel.mockRejectedValue(new Stripe.errors.StripeError("gone", "resource_missing"));
    expect((await call("DELETE", `/businesses/${BID}`)).statusCode).toBe(204);
    expect(db.business.deleteMany).toHaveBeenCalled();
  });

  it("does nothing for a business that is not the owner's", async () => {
    db.business.findFirst.mockResolvedValue(null);
    expect((await call("DELETE", `/businesses/${BID}`)).statusCode).toBe(204);
    expect(stripeApi.subscriptions.cancel).not.toHaveBeenCalled();
    expect(db.business.deleteMany).not.toHaveBeenCalled();
  });
});

describe("deleting an owner account", () => {
  beforeEach(async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", passwordHash: await argon2.hash("correct horse battery") });
    db.business.findMany.mockResolvedValue([{ id: BID }]);
    db.upload.findMany.mockResolvedValue([{ filename: FILE }]);
  });

  it("needs the right password", async () => {
    const res = await call("DELETE", "/auth/me", { password: "wrong password" });
    expect(res.statusCode).toBe(401);
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(stripeApi.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("ends every subscription, deletes the account and its pictures, and signs out", async () => {
    const res = await call("DELETE", "/auth/me", { password: "correct horse battery" });
    expect(res.statusCode).toBe(200);
    expect(stripeApi.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
    expect(fsApi.unlink).toHaveBeenCalledTimes(1);
    expect(String(res.headers["set-cookie"])).toMatch(/session=;/);
  });

  it("keeps the account when Stripe cannot cancel", async () => {
    stripeApi.subscriptions.cancel.mockRejectedValue(new Stripe.errors.StripeError("down"));
    const res = await call("DELETE", "/auth/me", { password: "correct horse battery" });
    expect(res.statusCode).toBe(502);
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/auth/me", payload: { password: "x" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
