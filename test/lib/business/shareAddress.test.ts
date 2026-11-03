import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config.js", async (original) => {
  const actual = await original<typeof import("../../../src/config.js")>();
  return { ...actual, config: { ...actual.config, SLUG_BASE_DOMAIN: "businessask.eu", APP_URL: "https://businessask.eu" } };
});

import { siteShareUrl } from "../../../src/lib/business/code.js";
import { shareAddress } from "../../../src/lib/business/shareAddress.js";

describe("siteShareUrl", () => {
  it("adds the source hint to the business address", () => {
    expect(siteShareUrl("https://tockica.businessask.eu", "qr")).toBe("https://tockica.businessask.eu/?s=q");
    expect(siteShareUrl("https://tockica.businessask.eu/", "nfc")).toBe("https://tockica.businessask.eu/?s=n");
  });
});

describe("shareAddress", () => {
  it("is the business address once the slug is locked", () => {
    expect(shareAddress({ slug: "tockica", slugLockedAt: new Date() }, "qr")).toBe("https://tockica.businessask.eu/?s=q");
    expect(shareAddress({ slug: "tockica", slugLockedAt: new Date() }, "nfc")).toBe("https://tockica.businessask.eu/?s=n");
  });

  it("is null before the first publish", () => {
    expect(shareAddress({ slug: "tockica", slugLockedAt: null }, "qr")).toBeNull();
    expect(shareAddress({ slug: null, slugLockedAt: null }, "nfc")).toBeNull();
  });
});