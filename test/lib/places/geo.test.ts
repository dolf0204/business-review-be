import { describe, expect, it } from "vitest";
import { boundingBox, distanceKm } from "../src/lib/geo.js";
import { newCode } from "../src/lib/code.js";

const zadar = { lat: 44.1194, lng: 15.2314 };
const split = { lat: 43.5081, lng: 16.4402 };

describe("geo", () => {
  it("measures the distance between two towns", () => {
    expect(distanceKm(zadar, split)).toBeGreaterThan(115);
    expect(distanceKm(zadar, split)).toBeLessThan(122);
    expect(distanceKm(zadar, zadar)).toBe(0);
  });
  it("a bounding box contains every point inside the radius", () => {
    const box = boundingBox(zadar, 25);
    const north = { lat: zadar.lat + 24 / 111.19, lng: zadar.lng };
    const east = { lat: zadar.lat, lng: zadar.lng + 24 / (111.19 * Math.cos((zadar.lat * Math.PI) / 180)) };
    for (const p of [north, east]) {
      expect(distanceKm(zadar, p)).toBeLessThan(25);
      expect(p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng).toBe(true);
    }
  });
  it("makes short codes without look-alike characters", () => {
    const code = newCode();
    expect(code).toMatch(/^[2-9a-hj-km-np-z]{8}$/);
  });
});
