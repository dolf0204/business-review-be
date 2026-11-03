import { describe, expect, it } from "vitest";
import { isAdminStatus, statusChange, type OrderTimes } from "../../../src/lib/shop/orderStatus.js";

const NOW = new Date("2026-11-03T10:00:00Z");
const EARLIER = new Date("2026-11-01T10:00:00Z");
const order = (over: Partial<OrderTimes> = {}): OrderTimes => ({ status: "PAID", shippedAt: null, deliveredAt: null, trackingUrl: null, ...over });

describe("statusChange", () => {
  it("posts a paid order, stamps the date, keeps the tracking link and tells the owner", () => {
    const change = statusChange(order(), "SHIPPED", NOW, "https://track.example.com/1");
    expect(change).toEqual({ data: { status: "SHIPPED", shippedAt: NOW, deliveredAt: null, trackingUrl: "https://track.example.com/1" }, notifyOwner: true });
  });

  it("does not tell the owner twice, and keeps the first posting date and link", () => {
    const change = statusChange(order({ status: "SHIPPED", shippedAt: EARLIER, trackingUrl: "https://t.example.com" }), "SHIPPED", NOW);
    expect(change).toEqual({ data: { status: "SHIPPED", shippedAt: EARLIER, deliveredAt: null, trackingUrl: "https://t.example.com" }, notifyOwner: false });
  });

  it("replaces or clears the tracking link only when one is given", () => {
    const shipped = order({ status: "SHIPPED", shippedAt: EARLIER, trackingUrl: "https://old.example.com" });
    expect(statusChange(shipped, "SHIPPED", NOW, "https://new.example.com")?.data.trackingUrl).toBe("https://new.example.com");
    expect(statusChange(shipped, "SHIPPED", NOW, null)?.data.trackingUrl).toBeNull();
  });

  it("marks delivered, and fills the posting date when the step was skipped", () => {
    expect(statusChange(order({ status: "SHIPPED", shippedAt: EARLIER }), "DELIVERED", NOW)).toEqual({
      data: { status: "DELIVERED", shippedAt: EARLIER, deliveredAt: NOW, trackingUrl: null },
      notifyOwner: false,
    });
    expect(statusChange(order(), "DELIVERED", NOW)?.data).toMatchObject({ shippedAt: NOW, deliveredAt: NOW });
  });

  it("keeps the first delivery date when marked delivered again", () => {
    const delivered = order({ status: "DELIVERED", shippedAt: EARLIER, deliveredAt: EARLIER });
    expect(statusChange(delivered, "DELIVERED", NOW)?.data.deliveredAt).toBe(EARLIER);
  });

  it("steps back and clears what no longer applies", () => {
    const delivered = order({ status: "DELIVERED", shippedAt: EARLIER, deliveredAt: EARLIER, trackingUrl: "https://t.example.com" });
    expect(statusChange(delivered, "SHIPPED", NOW)?.data).toEqual({ status: "SHIPPED", shippedAt: EARLIER, deliveredAt: null, trackingUrl: "https://t.example.com" });
    expect(statusChange(delivered, "PAID", NOW)).toEqual({ data: { status: "PAID", shippedAt: null, deliveredAt: null, trackingUrl: null }, notifyOwner: false });
  });

  it("refuses an order that was never paid or was canceled", () => {
    expect(statusChange(order({ status: "PENDING_PAYMENT" }), "SHIPPED", NOW)).toBeNull();
    expect(statusChange(order({ status: "CANCELED" }), "PAID", NOW)).toBeNull();
  });
});

describe("isAdminStatus", () => {
  it("accepts the three states of a paid order only", () => {
    expect(["PAID", "SHIPPED", "DELIVERED"].every((s) => isAdminStatus(s as never))).toBe(true);
    expect(isAdminStatus("PENDING_PAYMENT")).toBe(false);
    expect(isAdminStatus("CANCELED")).toBe(false);
  });
});