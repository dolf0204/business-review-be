import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", async (original) => {
  const actual = await original<typeof import("../src/config.js")>();
  return { ...actual, config: { ...actual.config, SLUG_BASE_DOMAIN: "businessask.eu", APP_URL: "https://businessask.eu" } };
});

import type { Business } from "../src/generated/prisma/client.js";
import { businessView, publicBusiness } from "../src/lib/businessView.js";

const business = (over: Partial<Business> = {}) =>
  ({
    id: "b-1", ownerId: "u1", code: "abcd2345", slug: null, slugLockedAt: null, name: "Točkica", kind: "restaurant", subtitle: null, offerText: null,
    address: null, lat: null, lng: null, googlePlaceId: null, googleMapsUrl: null, googleReviewUrl: null, tripadvisorReviewUrl: null, websiteUrl: null,
    instagramUrl: null, facebookUrl: null, phone: null, contactEmail: null, logoUrl: null, backgroundUrl: null, rating: null, ratingCount: null, theme: {},
    publishedAt: null, approvedAt: null, paidUntil: null, ...over,
  }) as Business;

describe("the owner's view", () => {
  it("shows the full address as soon as one is chosen", () => {
    expect(businessView(business({ slug: "tockica" })).siteUrl).toBe("https://tockica.businessask.eu");
  });

  it("has no address before one is chosen, and never exposes the owner", () => {
    const view = businessView(business());
    expect(view.siteUrl).toBeNull();
    expect("ownerId" in view).toBe(false);
  });
});

describe("the guests' view", () => {
  it("gives the readable address once it is locked", () => {
    const page = publicBusiness(business({ slug: "tockica", slugLockedAt: new Date() }));
    expect(page).toMatchObject({ code: "abcd2345", slug: "tockica", siteUrl: "https://tockica.businessask.eu" });
  });

  it("keeps an address that can still change to itself", () => {
    const page = publicBusiness(business({ slug: "tockica" }));
    expect(page.slug).toBeNull();
    expect(page.siteUrl).toBeNull();
  });
});