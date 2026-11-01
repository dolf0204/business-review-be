import { describe, expect, it } from "vitest";
import { buildSiteUrl, buildSlugOrigin, siteUrl, slugOrigin } from "../src/lib/siteUrl.js";

describe("buildSiteUrl", () => {
  it("puts the address in front of the base domain and takes the scheme from the app", () => {
    expect(buildSiteUrl("tockica", "businessask.eu", "https://businessask.eu")).toBe("https://tockica.businessask.eu");
    expect(buildSiteUrl("tockica", "localhost:5190", "http://localhost:5190")).toBe("http://tockica.localhost:5190");
  });

  it("gives nothing without an address or a base domain", () => {
    expect(buildSiteUrl(null, "businessask.eu", "https://businessask.eu")).toBeNull();
    expect(buildSiteUrl("tockica", "", "https://businessask.eu")).toBeNull();
  });
});

describe("buildSlugOrigin", () => {
  const origin = buildSlugOrigin("businessask.eu", "https://businessask.eu");

  it("matches the pages of businesses and nothing else", () => {
    expect(origin?.test("https://tockica.businessask.eu")).toBe(true);
    expect(origin?.test("https://villa-zara-zadar.businessask.eu")).toBe(true);
    expect(origin?.test("http://tockica.businessask.eu")).toBe(false);
    expect(origin?.test("https://businessask.eu")).toBe(false);
    expect(origin?.test("https://a.b.businessask.eu")).toBe(false);
    expect(origin?.test("https://tockica.businessask.eu.evil.com")).toBe(false);
    expect(origin?.test("https://evil.com/.businessask.eu")).toBe(false);
    expect(origin?.test("https://tockicaXbusinessask.eu")).toBe(false);
  });

  it("is off without a base domain", () => {
    expect(buildSlugOrigin("", "https://businessask.eu")).toBeNull();
  });
});

describe("with the settings of the test environment", () => {
  it("is off, so nothing changes until a base domain is set", () => {
    expect(siteUrl("tockica")).toBeNull();
    expect(slugOrigin()).toBeNull();
  });
});