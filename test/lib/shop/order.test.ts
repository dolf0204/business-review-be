import { describe, expect, it } from "vitest";
import { freePeriodEnd, isShopKey, priceOrder, shopKey, shopOperatorMail, type ShopItemInput } from "../../../src/lib/shop/order.js";
import { DESIGN_IDS, DESIGNS, FINISHES, publicCatalog, SIZE_PRICE_CENTS } from "../../../src/lib/shop/catalog.js";
import { HOME_COUNTRY, SHIP_COUNTRIES, SHIPPING_ABROAD_CENTS, SHIPPING_HOME_CENTS } from "../../../src/lib/shop/shipping.js";

const item = (size: ShopItemInput["size"], printText = "Salon Lana"): ShopItemInput => ({ design: "halo", finish: "amber", size, printText });
const NOW = new Date("2026-11-01T12:00:00Z");
const FUTURE = new Date("2027-03-01T00:00:00Z");

describe("catalog", () => {
  it("has 20 unique designs in 6 chapters, and the prices the owner set", () => {
    expect(new Set(DESIGN_IDS).size).toBe(20);
    expect(DESIGNS).toHaveLength(20);
    expect(SIZE_PRICE_CENTS).toEqual({ S: 2000, M: 2500, L: 3000 });
    expect(publicCatalog().chapters.map((c) => c.designs.length)).toEqual([4, 4, 3, 3, 2, 4]);
    expect(FINISHES).toHaveLength(3);
  });
  it("tells the shop what shipping costs and where it goes", () => {
    expect(publicCatalog().shipping).toEqual({ homeCountry: HOME_COUNTRY, homeCents: SHIPPING_HOME_CENTS, abroadCents: SHIPPING_ABROAD_CENTS, countries: SHIP_COUNTRIES });
  });
});

describe("pricing an order", () => {
  it("charges full price without a plan, plus the home shipping", () => {
    const p = priceOrder([item("S"), item("L")], { yearly: false, freeAvailable: false, country: "HR" });
    expect(p.items.map((i) => i.unitCents)).toEqual([2000, 3000]);
    expect(p.subtotalCents).toBe(5000);
    expect(p.shippingCents).toBe(SHIPPING_HOME_CENTS);
    expect(p.totalCents).toBe(5500);
    expect(p.freeApplied).toBe(false);
  });
  it("charges the abroad shipping outside the home country", () => {
    const p = priceOrder([item("M")], { yearly: false, freeAvailable: false, country: "DE" });
    expect(p.shippingCents).toBe(SHIPPING_ABROAD_CENTS);
    expect(p.totalCents).toBe(2500 + SHIPPING_ABROAD_CENTS);
  });
  it("takes 25 percent off for the yearly plan, but not off the shipping", () => {
    const p = priceOrder([item("S"), item("M"), item("L")], { yearly: true, freeAvailable: false, country: "HR" });
    expect(p.items.map((i) => i.unitCents)).toEqual([1500, 1875, 2250]);
    expect(p.subtotalCents).toBe(5625);
    expect(p.totalCents).toBe(5625 + SHIPPING_HOME_CENTS);
  });
  it("makes the dearest stand free when the free one is available, and discounts the rest", () => {
    const p = priceOrder([item("M"), item("L"), item("S")], { yearly: true, freeAvailable: true, country: "HR" });
    expect(p.items.map((i) => i.free)).toEqual([false, true, false]);
    expect(p.items.map((i) => i.unitCents)).toEqual([1875, 0, 1500]);
    expect(p.freeApplied).toBe(true);
  });
  it("makes only the first of equally dear stands free, and a single free stand still pays the shipping", () => {
    const tie = priceOrder([item("M"), item("M")], { yearly: true, freeAvailable: true, country: "HR" });
    expect(tie.items.map((i) => i.free)).toEqual([true, false]);
    const single = priceOrder([item("L")], { yearly: true, freeAvailable: true, country: "AT" });
    expect(single.subtotalCents).toBe(0);
    expect(single.totalCents).toBe(SHIPPING_ABROAD_CENTS);
  });
});

describe("the free stand window", () => {
  it("is the end of the paid yearly period, and only for an active yearly plan", () => {
    expect(freePeriodEnd({ interval: "YEAR", status: "ACTIVE", currentPeriodEnd: FUTURE }, NOW)).toEqual(FUTURE);
    expect(freePeriodEnd({ interval: "MONTH", status: "ACTIVE", currentPeriodEnd: FUTURE }, NOW)).toBeNull();
    expect(freePeriodEnd({ interval: "YEAR", status: "PAST_DUE", currentPeriodEnd: FUTURE }, NOW)).toBeNull();
    expect(freePeriodEnd({ interval: "YEAR", status: "ACTIVE", currentPeriodEnd: new Date("2026-10-01T00:00:00Z") }, NOW)).toBeNull();
    expect(freePeriodEnd({ interval: "YEAR", status: "ACTIVE", currentPeriodEnd: null }, NOW)).toBeNull();
    expect(freePeriodEnd(null, NOW)).toBeNull();
  });
});

describe("keys and mail", () => {
  it("keeps a key to one order and the server secret", () => {
    const key = shopKey("a", "s".repeat(32));
    expect(isShopKey(key, "a", "s".repeat(32))).toBe(true);
    expect(isShopKey(key, "b", "s".repeat(32))).toBe(false);
    expect(isShopKey("short", "a", "s".repeat(32))).toBe(false);
  });
  it("escapes everything the owner typed and says what to invoice", () => {
    const priced = priceOrder([item("L", "<script>x</script>")], { yearly: true, freeAvailable: false, country: "HR" });
    const m = shopOperatorMail({
      orderId: "45e51044-ee43-4b75-87e4-de2dbadf8686", business: "<b>K</b>", ownerEmail: "o@example.com", items: priced.items, totalCents: priced.totalCents, paidOnline: true, name: "A & B", line1: "Obala 1", line2: null,
      postalCode: "1", city: "Z", country: "HR", phone: null, qrUrl: "https://x/b/c?s=q", nfcUrl: "https://x/b/c?s=n", link: "https://x/op?o=1&key=2",
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>K</b>");
    expect(m.html).toContain("A &amp; B");
    expect(m.html).toContain("Paid online: 27.50 EUR");
  });
});