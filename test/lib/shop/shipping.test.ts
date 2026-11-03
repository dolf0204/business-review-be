import { describe, expect, it } from "vitest";
import { HOME_COUNTRY, isShipCountry, SHIP_COUNTRIES, SHIPPING_ABROAD_CENTS, SHIPPING_HOME_CENTS, shippingCentsFor } from "../../../src/lib/shop/shipping.js";

describe("shipping", () => {
  it("charges the home rate in the home country and the abroad rate everywhere else", () => {
    expect(shippingCentsFor(HOME_COUNTRY)).toBe(SHIPPING_HOME_CENTS);
    expect(shippingCentsFor("DE")).toBe(SHIPPING_ABROAD_CENTS);
    expect(shippingCentsFor("GB")).toBe(SHIPPING_ABROAD_CENTS);
  });

  it("only accepts upper case codes from the list", () => {
    expect(isShipCountry("HR")).toBe(true);
    expect(isShipCountry("hr")).toBe(false);
    expect(isShipCountry("US")).toBe(false);
    expect(isShipCountry("")).toBe(false);
  });

  it("lists the home country once and no duplicates", () => {
    expect(SHIP_COUNTRIES).toContain(HOME_COUNTRY);
    expect(new Set(SHIP_COUNTRIES).size).toBe(SHIP_COUNTRIES.length);
  });
});