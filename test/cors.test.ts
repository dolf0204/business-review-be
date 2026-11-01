import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", async (original) => {
  const actual = await original<typeof import("../src/config.js")>();
  return { ...actual, config: { ...actual.config, SLUG_BASE_DOMAIN: "businessask.eu", APP_URL: "https://businessask.eu" } };
});
vi.mock("../src/db.js", () => ({ prisma: {} }));

import { buildApp } from "../src/app.js";

async function allowedFor(origin: string) {
  const app = await buildApp();
  const res = await app.inject({ method: "OPTIONS", url: "/health", headers: { origin, "access-control-request-method": "GET" } });
  await app.close();
  return res.headers["access-control-allow-origin"];
}

describe("which sites may call the API", () => {
  it("allows the app and the page of any business", async () => {
    expect(await allowedFor("https://businessask.eu")).toBe("https://businessask.eu");
    expect(await allowedFor("https://tockica.businessask.eu")).toBe("https://tockica.businessask.eu");
  });

  it("refuses everything else", async () => {
    expect(await allowedFor("https://evil.com")).toBeUndefined();
    expect(await allowedFor("https://tockica.businessask.eu.evil.com")).toBeUndefined();
    expect(await allowedFor("http://tockica.businessask.eu")).toBeUndefined();
    expect(await allowedFor("https://a.b.businessask.eu")).toBeUndefined();
  });
});