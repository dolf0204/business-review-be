import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../src/lib/mail.js", () => mail);

import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { isReviewKey, operatorList, reviewKey, reviewMail } from "../src/lib/operator.js";

const ID = "11111111-1111-4111-8111-111111111111";
const key = () => reviewKey(ID, config.JWT_SECRET);

describe("operator review mail", () => {
  it("lists the operators, lower case and trimmed", () => {
    expect(operatorList(" Boss@Example.com, ,second@example.com ")).toEqual(["boss@example.com", "second@example.com"]);
    expect(operatorList("")).toEqual([]);
  });
  it("escapes everything the owner typed", () => {
    const m = reviewMail({ name: "<script>x</script>", offerText: "a & b", address: null, googleMapsUrl: "https://maps.google.com/?cid=1", ownerEmail: "o@example.com", link: "https://x.eu/?b=1&k=2", changed: false });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("a &amp; b");
    expect(m.subject).toContain("New business");
  });
  it("keys belong to one business and the server secret", () => {
    expect(isReviewKey(key(), ID, config.JWT_SECRET)).toBe(true);
    expect(isReviewKey(key(), "other", config.JWT_SECRET)).toBe(false);
    expect(isReviewKey("nope", ID, config.JWT_SECRET)).toBe(false);
  });
});

describe("operator decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    db.business.findUnique.mockResolvedValue({ id: ID, name: "Konoba <b>", ownerId: "u1", offerText: "10% off", subtitle: null, address: "Obala 1", googleMapsUrl: null, publishedAt: new Date(), paidUntil: new Date(Date.now() + 86_400_000), approvedAt: null });
    db.user.findUnique.mockResolvedValue({ email: "owner@example.com" });
  });
  const post = async (payload: object) => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/public/operator/decision", payload });
    await app.close();
    return res;
  };

  it("shows the business to someone with the key, and to nobody else", async () => {
    const app = await buildApp();
    const ok = await app.inject({ url: `/public/operator/review?b=${ID}&k=${key()}` });
    const bad = await app.inject({ url: `/public/operator/review?b=${ID}&k=${"x".repeat(43)}` });
    await app.close();
    expect(ok.json()).toMatchObject({ name: "Konoba <b>", approved: false, published: true });
    expect(bad.statusCode).toBe(400);
  });

  it("approves, and tells the owner", async () => {
    const res = await post({ b: ID, k: key(), action: "approve" });
    expect(res.json()).toEqual({ ok: true, approved: true });
    expect(db.business.update.mock.calls[0]![0].data.approvedAt).toBeInstanceOf(Date);
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ to: "owner@example.com" });
    expect(mail.sendMail.mock.calls[0]![0].html).toContain("Konoba &lt;b&gt;");
  });

  it("rejects by taking the approval away, without a mail", async () => {
    const res = await post({ b: ID, k: key(), action: "reject" });
    expect(res.json().approved).toBe(false);
    expect(db.business.update.mock.calls[0]![0].data).toEqual({ approvedAt: null });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it("refuses a wrong key or another business's key", async () => {
    expect((await post({ b: ID, k: "x".repeat(43), action: "approve" })).statusCode).toBe(400);
    expect((await post({ b: "22222222-2222-4222-8222-222222222222", k: key(), action: "approve" })).statusCode).toBe(400);
    expect(db.business.update).not.toHaveBeenCalled();
  });
});
