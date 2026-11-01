import { describe, expect, it, vi } from "vitest";
import { hintFromMapsUrl, parseMapsLink } from "../src/lib/mapsUrl.js";

vi.mock("../src/db.js", () => ({ prisma: {} }));

import { expandMapsLink } from "../src/lib/googlePlaces.js";

describe("pasted Google Maps links", () => {
  it("accepts Google's own https addresses only", () => {
    expect(parseMapsLink("https://maps.app.goo.gl/AbC123")).not.toBeNull();
    expect(parseMapsLink("https://www.google.com/maps/place/Konoba+Ribar/@44.11,15.23,17z")).not.toBeNull();
    expect(parseMapsLink("http://www.google.com/maps/place/x")).toBeNull();
    expect(parseMapsLink("https://evil.example.com/maps/place/x")).toBeNull();
    expect(parseMapsLink("https://www.google.com/search?q=x")).toBeNull();
    expect(parseMapsLink("https://maps.app.goo.gl.evil.com/x")).toBeNull();
    expect(parseMapsLink("not a link")).toBeNull();
  });

  it("reads the name, the pin and the place id from a full address", () => {
    const u = new URL("https://www.google.com/maps/place/Konoba+Ribar+%C5%A0ibenik/@44.1,15.2,17z/data=!3m1!4b1!4m6!3m5!1s0x1:0x2!8m2!3d44.12345!4d15.23456");
    expect(hintFromMapsUrl(u)).toMatchObject({ name: "Konoba Ribar Šibenik", lat: 44.12345, lng: 15.23456 });
    expect(hintFromMapsUrl(new URL("https://www.google.com/maps/place/Cafe/@44.5,16.5,15z")).lat).toBe(44.5);
    expect(hintFromMapsUrl(new URL("https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJabcdefghij123")).placeId).toBe("ChIJabcdefghij123");
    expect(hintFromMapsUrl(new URL("https://www.google.com/maps/place/Bad%ZZname")).name).toBeUndefined();
  });
});

describe("short links", () => {
  const redirect = (to: string) => vi.fn(async () => new Response(null, { status: 302, headers: { location: to } }));

  it("follows a short link to the full Google address", async () => {
    const fetchImpl = redirect("https://www.google.com/maps/place/Cafe/@44.5,16.5,15z");
    const url = await expandMapsLink(new URL("https://maps.app.goo.gl/AbC123"), fetchImpl as never);
    expect(url.hostname).toBe("www.google.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect that leaves Google, so the server never fetches a stranger's address", async () => {
    const fetchImpl = redirect("https://evil.example.com/steal");
    await expect(expandMapsLink(new URL("https://maps.app.goo.gl/AbC123"), fetchImpl as never)).rejects.toMatchObject({ code: "link_not_recognised" });
  });

  it("gives up on endless redirects", async () => {
    const fetchImpl = redirect("https://goo.gl/loop");
    await expect(expandMapsLink(new URL("https://goo.gl/loop"), fetchImpl as never)).rejects.toMatchObject({ code: "link_not_recognised" });
  });
});
