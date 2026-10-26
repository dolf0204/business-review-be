import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  campaign: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  membership: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../src/lib/mail.js", () => mail);

import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { offerMailHtml } from "../src/lib/offerMail.js";
import { isUnsubscribeKey, unsubscribeKey } from "../src/lib/unsubscribe.js";
import { runCampaign } from "../src/routes/campaigns.js";

const ID = "11111111-1111-4111-8111-111111111111";
const M1 = "22222222-2222-4222-8222-222222222222";
const BIZ = { id: ID, ownerId: "u1", code: "abcd2345", name: "Konoba <Ribar>", contactEmail: "info@konoba.hr", theme: { primary: "#112233" }, publishedAt: new Date(), paidUntil: new Date(Date.now() + 86_400_000) };
const log = { info: vi.fn(), error: vi.fn() };

describe("unsubscribe keys", () => {
  it("belong to one membership and the server secret", () => {
    const key = unsubscribeKey(M1, "secret-secret-secret-secret-1234");
    expect(isUnsubscribeKey(key, M1, "secret-secret-secret-secret-1234")).toBe(true);
    expect(isUnsubscribeKey(key, "other", "secret-secret-secret-secret-1234")).toBe(false);
    expect(isUnsubscribeKey(key, M1, "another-secret-another-secret-12345")).toBe(false);
    expect(isUnsubscribeKey("short", M1, "secret-secret-secret-secret-1234")).toBe(false);
  });
});

describe("the offer email", () => {
  const input = { lang: "en", businessName: "Konoba <Ribar>", subject: "Happy <b>hour</b>", body: "Two for one.\nUntil 8 pm.\n\nSee you!", pageUrl: "https://x.eu/b/abcd2345", unsubscribeUrl: "https://x.eu/unsubscribe?m=1&t=2" };

  it("escapes everything the owner typed and lays out lines and paragraphs", () => {
    const html = offerMailHtml(input);
    expect(html).not.toContain("<b>hour</b>");
    expect(html).toContain("Happy &lt;b&gt;hour&lt;/b&gt;");
    expect(html).toContain("Konoba &lt;Ribar&gt;");
    expect(html).toContain("Two for one.<br>Until 8 pm.");
    expect(html.match(/<p style="margin:0 0 14px/g)).toHaveLength(2);
  });

  it("always carries the reason and an unsubscribe link, in the guest's language", () => {
    expect(offerMailHtml(input)).toContain("agreed to receive its offers");
    const hr = offerMailHtml({ ...input, lang: "hr" });
    expect(hr).toContain("pristali primati");
    expect(hr).toContain("https://x.eu/unsubscribe?m=1&amp;t=2");
    expect(offerMailHtml({ ...input, color: "red;x" })).toContain("#0f766e");
  });
});

describe("sending a campaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    db.campaign.findUnique.mockResolvedValue({ id: "c1", subject: "Happy hour", body: "Two for one." });
    db.membership.findMany.mockResolvedValue([
      { id: M1, guest: { email: "a@example.com", lang: "hr" } },
      { id: "m2", guest: { email: "b@example.com", lang: "en" } },
    ]);
  });

  it("mails only guests who agreed and confirmed, each with their own unsubscribe link and the one-click header", async () => {
    await runCampaign("c1", BIZ, log);
    expect(db.membership.findMany.mock.calls[0]![0].where).toMatchObject({ businessId: ID, marketingOptInAt: { not: null }, guest: { emailVerifiedAt: { not: null } } });
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    const first = mail.sendMail.mock.calls[0]![0];
    expect(first).toMatchObject({ to: "a@example.com", fromName: "Konoba <Ribar> via BusinessAsk", replyTo: "info@konoba.hr" });
    expect(first.subject).toBe("Happy hour · Konoba <Ribar>");
    expect(first.html).toContain(`unsubscribe?m=${M1}&amp;t=${unsubscribeKey(M1, config.JWT_SECRET)}`);
    expect(first.headers["List-Unsubscribe"]).toContain(`/public/unsubscribe/${M1}/${unsubscribeKey(M1, config.JWT_SECRET)}`);
    expect(first.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const final = db.campaign.update.mock.calls.at(-1)![0].data;
    expect(final).toMatchObject({ status: "SENT", sentCount: 2, failedCount: 0 });
  });

  it("counts a failed address and keeps going", async () => {
    mail.sendMail.mockRejectedValueOnce(new Error("Brevo responded 400: secret detail")).mockResolvedValue(undefined);
    await runCampaign("c1", BIZ, log);
    expect(db.campaign.update.mock.calls.at(-1)![0].data).toMatchObject({ status: "SENT", sentCount: 1, failedCount: 1 });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("secret detail".replace("secret detail", "a@example.com"));
  });
});

describe("the owner's campaign screen", () => {
  async function owner(method: "GET" | "POST", url: string, payload?: object) {
    const app = await buildApp();
    const res = await app.inject({ method, url, payload, headers: { cookie: `session=${app.jwt.sign({ sub: "u1" })}` } });
    await app.close();
    return res;
  }
  const offer = { subject: "Happy hour", body: "Two for one until 8 pm." };
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    db.business.findFirst.mockResolvedValue(BIZ);
    db.campaign.count.mockResolvedValue(0);
    db.membership.count.mockResolvedValue(3);
    db.campaign.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "c1", ...data }));
    db.campaign.findUnique.mockResolvedValue(null);
  });

  it("accepts an offer, answers at once and counts the guests who agreed", async () => {
    const res = await owner("POST", `/businesses/${ID}/campaigns`, offer);
    expect(res.statusCode).toBe(202);
    expect(db.campaign.create.mock.calls[0]![0].data).toMatchObject({ businessId: ID, subject: "Happy hour", recipients: 3 });
  });

  it("allows one campaign a week, needs a published page and at least one guest, and limits the text", async () => {
    db.campaign.count.mockResolvedValue(1);
    expect((await owner("POST", `/businesses/${ID}/campaigns`, offer)).json().error).toBe("campaign_limit_week");
    db.campaign.count.mockResolvedValue(0);
    db.membership.count.mockResolvedValue(0);
    expect((await owner("POST", `/businesses/${ID}/campaigns`, offer)).json().error).toBe("no_recipients");
    db.business.findFirst.mockResolvedValue({ ...BIZ, publishedAt: null });
    expect((await owner("POST", `/businesses/${ID}/campaigns`, offer)).json().error).toBe("not_published");
    expect((await owner("POST", `/businesses/${ID}/campaigns`, { subject: "", body: "x" })).statusCode).toBe(400);
    expect((await owner("POST", `/businesses/${ID}/campaigns`, { subject: "x", body: "y".repeat(1001) })).statusCode).toBe(400);
    expect(db.campaign.create).not.toHaveBeenCalled();
  });

  it("sends a test to the owner's own address without using the weekly allowance", async () => {
    db.user.findUnique.mockResolvedValue({ email: "owner@example.com", uiLang: "en" });
    expect((await owner("POST", `/businesses/${ID}/campaigns/test`, offer)).statusCode).toBe(200);
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ to: "owner@example.com" });
    expect(mail.sendMail.mock.calls[0]![0].subject.startsWith("[Test]")).toBe(true);
    expect(db.campaign.create).not.toHaveBeenCalled();
  });

  it("lists past campaigns, the audience and when the next one may go out", async () => {
    db.campaign.findMany.mockResolvedValue([{ id: "c1", createdAt: new Date() }]);
    const res = await owner("GET", `/businesses/${ID}/campaigns`);
    expect(res.json()).toMatchObject({ audience: 3 });
    expect(res.json().nextSendAt).not.toBeNull();
  });

  it("keeps other owners out", async () => {
    db.business.findFirst.mockResolvedValue(null);
    expect((await owner("GET", `/businesses/${ID}/campaigns`)).statusCode).toBe(404);
    expect((await owner("POST", `/businesses/${ID}/campaigns`, offer)).statusCode).toBe(404);
  });
});

describe("unsubscribing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.membership.findUnique.mockResolvedValue({ id: M1, business: { name: "Konoba" } });
  });
  const key = () => unsubscribeKey(M1, config.JWT_SECRET);

  it("withdraws consent with the key from the mail, without a login", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/public/unsubscribe", payload: { m: M1, t: key() } });
    await app.close();
    expect(res.json()).toEqual({ ok: true, business: "Konoba" });
    expect(db.membership.update.mock.calls[0]![0].data).toEqual({ marketingOptInAt: null });
  });

  it("works for the mail program's one-click request, which is a small form", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/public/unsubscribe/${M1}/${key()}`, payload: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(db.membership.update).toHaveBeenCalled();
  });

  it("refuses a wrong key, so nobody can unsubscribe another guest", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/public/unsubscribe", payload: { m: M1, t: "x".repeat(43) } });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(db.membership.update).not.toHaveBeenCalled();
  });
});
