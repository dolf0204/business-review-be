import { describe, expect, it } from "vitest";
import { shopOwnerReceivedMail, shopShippedMail, type ShopReceivedInput } from "../../../src/lib/shop/shopMail.js";

const base: ShopReceivedInput = {
  appUrl: "https://businessask.eu",
  orderId: "45e51044-ee43-4b75-87e4-de2dbadf8686",
  businessId: "3a5e4bde-b6a7-480e-b1f6-f6766fc025d0",
  business: "Salon <Lana>",
  createdAt: new Date("2026-11-02T12:00:00Z"),
  items: [
    { design: "neon", finish: "midnight", size: "L", printText: "Lana & Co", listCents: 3000, unitCents: 0 },
    { design: "halo", finish: "amber", size: "M", printText: "Salon", listCents: 2500, unitCents: 1875 },
  ],
  subtotalCents: 1875,
  shippingCents: 0,
  totalCents: 1875,
  paidOnline: true,
  name: "Ana <Horvat>",
  line1: "Obala 1",
  line2: null,
  postalCode: "23000",
  city: "Zadar",
  country: "HR",
  phone: "+385 91 123 4567",
};

describe("the order confirmation the customer gets", () => {
  const m = shopOwnerReceivedMail(base);

  it("shows the short order number, the stands, the pictures, the address and the total", () => {
    expect(m.subject).toBe("Order #45E51044 confirmed: Salon <Lana>");
    expect(m.html).toContain("Order #45E51044");
    expect(m.html).toContain("Neon sign");
    expect(m.html).toContain("https://businessask.eu/shop/neon_0.jpg");
    expect(m.html).toContain("https://businessask.eu/shop/halo_1.jpg");
    expect(m.html).toContain("FREE");
    expect(m.html).toContain("18.75 EUR");
    expect(m.html).toContain("Croatia");
    expect(m.html).toContain("2 November 2026");
    expect(m.html).toContain("The seller is not in the VAT system");
    expect(m.html).toContain("https://businessask.eu/shop?business=3a5e4bde-b6a7-480e-b1f6-f6766fc025d0");
  });

  it("escapes everything the customer typed", () => {
    expect(m.html).not.toContain("<Lana>");
    expect(m.html).not.toContain("<Horvat>");
    expect(m.html).toContain("Lana &amp; Co");
    expect(m.html).toContain("Ana &lt;Horvat&gt;");
  });

  it("says nothing about an invoice when the whole order is free", () => {
    const free = shopOwnerReceivedMail({ ...base, items: [base.items[0]!], subtotalCents: 0, totalCents: 0, paidOnline: false });
    expect(free.html).toContain("Free with your yearly plan");
    expect(free.html).not.toContain("VAT");
  });
});

describe("the shipped mail", () => {
  const ship = { appUrl: "https://businessask.eu", orderId: base.orderId, businessId: base.businessId, business: "Salon" };
  it("links the parcel when there is a tracking link, and the order when there is not", () => {
    expect(shopShippedMail({ ...ship, trackingUrl: "https://post.example/track?id=1" }).html).toContain("Track your parcel");
    expect(shopShippedMail({ ...ship, trackingUrl: null }).html).toContain("View your order");
  });
});