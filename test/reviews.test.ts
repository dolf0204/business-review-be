import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), findFirst: vi.fn() },
  guest: { findUnique: vi.fn() },
  membership: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  reviewPrompt: { upsert: vi.fn(), count: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../src/app.js";
import { isNewVisitDay, nextStep, platformState } from "../src/lib/reviews.js";

describe("when to ask for a review", () => {
  it("asks a new guest, never asks again after the link was followed", () => {
    expect(platformState(undefined, 1)).toBe("due");
    expect(platformState({ status: "DONE", declinedAtVisit: 0 }, 50)).toBe("done");
  });

  it("asks again only after three more visits following a no thanks", () => {
    const declined = { status: "DECLINED" as const, declinedAtVisit: 1 };
    expect(platformState(declined, 1)).toBe("snoozed");
    expect(platformState(declined, 3)).toBe("snoozed");
    expect(platformState(declined, 4)).toBe("due");
  });

  it("goes Google first, then Tripadvisor, and does not skip ahead after a no thanks", () => {
    expect(nextStep("due", "due")).toBe("google");
    expect(nextStep("done", "due")).toBe("tripadvisor");
    expect(nextStep("snoozed", "due")).toBeNull();
    expect(nextStep("done", "snoozed")).toBeNull();
    expect(nextStep("done", "done")).toBeNull();
    expect(nextStep("done", null)).toBeNull();
    expect(nextStep("due", null)).toBe("google");
  });

  it("counts a visit once per day", () => {
    const now = new Date("2026-06-02T10:00:00Z");
    expect(isNewVisitDay(null, now)).toBe(true);
    expect(isNewVisitDay(new Date("2026-06-02T01:00:00Z"), now)).toBe(false);
    expect(isNewVisitDay(new Date("2026-06-01T23:59:00Z"), now)).toBe(true);
  });
});

const GUEST = { id: "g1" };
const BIZ = { id: "b1", publishedAt: new Date(), tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant-x", googleReviewUrl: "https://g.page/r/abc/review" };
const member = (over = {}) => ({ id: "m1", visits: 1, lastVisitAt: new Date(), reviewPrompts: [], ...over });

async function call(method: "GET" | "POST", url: string, signedIn = true) {
  const app = await buildApp();
  const headers = signedIn ? { cookie: `guest=${app.jwt.sign({ sub: "g1", kind: "guest" } as never)}` } : {};
  const res = await app.inject({ method, url, headers });
  await app.close();
  return res;
}

describe("visits and review prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.guest.findUnique.mockResolvedValue(GUEST);
    db.business.findUnique.mockResolvedValue(BIZ);
    db.membership.findUnique.mockResolvedValue(member());
  });

  it("needs a signed-in member of a published business", async () => {
    expect((await call("POST", "/guest/b/abcd2345/visit", false)).statusCode).toBe(401);
    db.membership.findUnique.mockResolvedValue(null);
    expect((await call("POST", "/guest/b/abcd2345/visit")).json().error).toBe("not_member");
    db.business.findUnique.mockResolvedValue({ ...BIZ, publishedAt: null });
    expect((await call("POST", "/guest/b/abcd2345/visit")).statusCode).toBe(404);
  });

  it("does not count a second visit on the same day, and asks for Google first", async () => {
    const res = await call("POST", "/guest/b/abcd2345/visit");
    expect(db.membership.update).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({ visits: 1, google: "due", tripadvisor: "due", step: "google" });
  });

  it("counts a visit on a new day", async () => {
    db.membership.findUnique.mockResolvedValue(member({ lastVisitAt: new Date(Date.now() - 2 * 86_400_000) }));
    db.membership.update.mockResolvedValue(member({ visits: 2 }));
    const res = await call("POST", "/guest/b/abcd2345/visit");
    expect(db.membership.update.mock.calls[0]![0].data.visits).toEqual({ increment: 1 });
    expect(res.json().visits).toBe(2);
  });

  it("moves on to Tripadvisor once the Google link was followed, and has no Tripadvisor step without a link", async () => {
    db.membership.findUnique.mockResolvedValue(member({ reviewPrompts: [{ platform: "GOOGLE", status: "DONE", declinedAtVisit: 0 }] }));
    expect((await call("POST", "/guest/b/abcd2345/visit")).json().step).toBe("tripadvisor");
    db.business.findUnique.mockResolvedValue({ ...BIZ, tripadvisorReviewUrl: null });
    const res = await call("POST", "/guest/b/abcd2345/visit");
    expect(res.json()).toMatchObject({ tripadvisor: null, step: null });
  });

  it("remembers a no thanks at the current visit count and asks nothing more for now", async () => {
    db.membership.findUnique.mockResolvedValue(member({ visits: 4 }));
    const res = await call("POST", "/guest/b/abcd2345/review/google/decline");
    expect(db.reviewPrompt.upsert.mock.calls[0]![0].create).toMatchObject({ platform: "GOOGLE", status: "DECLINED", declinedAtVisit: 4 });
    expect(res.json()).toMatchObject({ google: "snoozed", step: null });
  });

  it("never turns a finished review into a no thanks", async () => {
    db.membership.findUnique.mockResolvedValue(member({ reviewPrompts: [{ platform: "GOOGLE", status: "DONE", declinedAtVisit: 0 }] }));
    const res = await call("POST", "/guest/b/abcd2345/review/google/decline");
    expect(db.reviewPrompt.upsert).not.toHaveBeenCalled();
    expect(res.json().google).toBe("done");
  });
});

describe("the review link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.guest.findUnique.mockResolvedValue(GUEST);
    db.business.findUnique.mockResolvedValue(BIZ);
    db.membership.findUnique.mockResolvedValue({ id: "m1" });
  });

  it("counts the click for a member and sends them to Google", async () => {
    const res = await call("GET", "/r/abcd2345/google");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://g.page/r/abc/review");
    expect(db.reviewPrompt.upsert.mock.calls[0]![0].create).toMatchObject({ membershipId: "m1", platform: "GOOGLE", status: "DONE" });
  });

  it("still redirects a visitor who is not signed in, without counting anything", async () => {
    const res = await call("GET", "/r/abcd2345/tripadvisor", false);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://www.tripadvisor.com/Restaurant-x");
    expect(db.reviewPrompt.upsert).not.toHaveBeenCalled();
  });

  it("is not a way to reach other addresses: only the stored link, only for a published business", async () => {
    db.business.findUnique.mockResolvedValue({ ...BIZ, publishedAt: null });
    expect((await call("GET", "/r/abcd2345/google")).statusCode).toBe(404);
    db.business.findUnique.mockResolvedValue({ ...BIZ, tripadvisorReviewUrl: null });
    expect((await call("GET", "/r/abcd2345/tripadvisor")).statusCode).toBe(404);
    expect((await call("GET", "/r/abcd2345/evil")).statusCode).toBe(400);
  });
});

describe("numbers for the owner", () => {
  it("counts members, offers consent, visits and review clicks, for the owner only", async () => {
    db.business.findFirst.mockResolvedValue({ id: "b1" });
    db.membership.count.mockResolvedValueOnce(12).mockResolvedValueOnce(5);
    db.membership.aggregate.mockResolvedValue({ _sum: { visits: 40 } });
    db.reviewPrompt.count.mockResolvedValueOnce(7).mockResolvedValueOnce(3);
    const app = await buildApp();
    const cookie = `session=${app.jwt.sign({ sub: "u1" })}`;
    const id = "11111111-1111-4111-8111-111111111111";
    const res = await app.inject({ url: `/businesses/${id}/stats`, headers: { cookie } });
    expect(res.json()).toEqual({ members: 12, offersOptIn: 5, visits: 40, googleReviewClicks: 7, tripadvisorReviewClicks: 3 });
    db.business.findFirst.mockResolvedValue(null);
    expect((await app.inject({ url: `/businesses/${id}/stats`, headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });
});
