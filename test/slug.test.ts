import { describe, expect, it } from "vitest";
import { KINDS, UI_LANGS } from "../src/schemas.js";
import { SLUG_MAX_LENGTH, cityFromAddress, isReservedSlug, isValidSlug, numberedSlug, slugCandidates, slugify, typeWord } from "../src/lib/slug.js";

describe("slugify", () => {
  it("turns names into plain lowercase words joined by hyphens", () => {
    expect(slugify("Točkica")).toBe("tockica");
    expect(slugify("Đuro's Frizer & Co")).toBe("djuros-frizer-co");
    expect(slugify("  Café   Müller  ")).toBe("cafe-muller");
    expect(slugify("Łódź Straße")).toBe("lodz-strasse");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(slugify("!!")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidSlug("tockica")).toBe(true);
    expect(isValidSlug("villa-zara-zadar")).toBe(true);
  });

  it("rejects bad shapes, bad lengths and reserved words", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
    expect(isValidSlug("-tockica")).toBe(false);
    expect(isValidSlug("tockica-")).toBe(false);
    expect(isValidSlug("tockica--bar")).toBe(false);
    expect(isValidSlug("Tockica")).toBe(false);
    expect(isValidSlug("www")).toBe(false);
    expect(isValidSlug("google")).toBe(false);
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("google-bar")).toBe(false);
  });
});

describe("typeWord", () => {
  it("speaks the owner's language and falls back to English", () => {
    expect(typeWord("restaurant", "hr")).toBe("restoran");
    expect(typeWord("hairdresser", "hr")).toBe("frizerski-salon");
    expect(typeWord("restaurant", "de")).toBe("restaurant");
    expect(typeWord("restaurant", "xx")).toBe("restaurant");
  });

  it("has no word for other or unknown kinds", () => {
    expect(typeWord("other", "hr")).toBeNull();
    expect(typeWord("spaceship", "hr")).toBeNull();
  });

  it("gives every kind a valid word in every language", () => {
    for (const kind of KINDS.filter((k) => k !== "other")) {
      for (const lang of UI_LANGS) {
        const word = typeWord(kind, lang);
        expect(word, `${kind}/${lang}`).not.toBeNull();
        expect(isValidSlug(word ?? ""), `${kind}/${lang}`).toBe(true);
      }
    }
  });
});

describe("cityFromAddress", () => {
  it("finds the city in Google style addresses", () => {
    expect(cityFromAddress("Maceljska ul. 21, 10000, Zagreb, Croatia")).toBe("zagreb");
    expect(cityFromAddress("Ulica 1, 23000 Zadar, Croatia")).toBe("zadar");
    expect(cityFromAddress("Ulica 1, 21000 Split, Hrvatska")).toBe("split");
  });

  it("gives nothing when the address is too short to tell", () => {
    expect(cityFromAddress("Zagreb")).toBeNull();
    expect(cityFromAddress("Ulica 1, Zagreb")).toBeNull();
    expect(cityFromAddress(null)).toBeNull();
    expect(cityFromAddress("")).toBeNull();
  });
});

describe("slugCandidates", () => {
  it("offers the name, then with the type, the city, and both, in that order", () => {
    expect(slugCandidates({ name: "Točkica", kind: "restaurant", address: "Maceljska ul. 21, 10000, Zagreb, Croatia", lang: "hr" })).toEqual([
      "tockica",
      "tockica-restoran",
      "tockica-zagreb",
      "tockica-restoran-zagreb",
    ]);
  });

  it("skips what is missing", () => {
    expect(slugCandidates({ name: "Villa Zara", kind: "other", address: "Ulica 1, 23000 Zadar, Croatia", lang: "en" })).toEqual(["villa-zara", "villa-zara-zadar"]);
    expect(slugCandidates({ name: "Villa Zara", kind: "other", address: null, lang: "en" })).toEqual(["villa-zara"]);
  });

  it("does not repeat a word the name already holds", () => {
    expect(slugCandidates({ name: "Zagreb Bistro", kind: "cafe", address: "X 1, 10000 Zagreb, Croatia", lang: "de" })).toEqual(["zagreb-bistro", "zagreb-bistro-cafe"]);
  });

  it("never offers a reserved name on its own", () => {
    expect(slugCandidates({ name: "Google", kind: "bar", address: null, lang: "en" })).toEqual(["google-bar"]);
  });

  it("offers nothing for a name with no usable letters", () => {
    expect(slugCandidates({ name: "!!", kind: "other", address: null, lang: "en" })).toEqual([]);
  });

  it("keeps every candidate within the length limit", () => {
    const long = slugCandidates({ name: "Restoran kod Ivana i Marije na obali mora", kind: "restaurant", address: "Obala 1, 23000 Zadar, Croatia", lang: "hr" });
    expect(long.length).toBeGreaterThan(0);
    for (const slug of long) expect(isValidSlug(slug)).toBe(true);
  });
});

describe("numberedSlug", () => {
  it("adds a number and still fits", () => {
    expect(numberedSlug("tockica", 2)).toBe("tockica-2");
    const long = numberedSlug("a".repeat(SLUG_MAX_LENGTH), 12);
    expect(long.endsWith("-12")).toBe(true);
    expect(long.length).toBe(SLUG_MAX_LENGTH);
    expect(isValidSlug(long)).toBe(true);
  });
});