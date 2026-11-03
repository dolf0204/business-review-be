import type { ShopOrderStatus } from "../../generated/prisma/enums.js";

export const ADMIN_STATUSES = ["PAID", "SHIPPED", "DELIVERED"] as const satisfies readonly ShopOrderStatus[];

export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export interface OrderTimes {
  status: ShopOrderStatus;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  trackingUrl: string | null;
}

export interface StatusChange {
  data: { status: AdminStatus; shippedAt: Date | null; deliveredAt: Date | null; trackingUrl: string | null };
  notifyOwner: boolean;
}

export const isAdminStatus = (status: ShopOrderStatus): status is AdminStatus => (ADMIN_STATUSES as readonly ShopOrderStatus[]).includes(status);

export function statusChange(current: OrderTimes, target: AdminStatus, now: Date, trackingUrl?: string | null): StatusChange | null {
  if (!isAdminStatus(current.status)) return null;
  if (target === "PAID") return { data: { status: target, shippedAt: null, deliveredAt: null, trackingUrl: null }, notifyOwner: false };
  return {
    data: {
      status: target,
      shippedAt: current.shippedAt ?? now,
      deliveredAt: target === "DELIVERED" ? (current.deliveredAt ?? now) : null,
      trackingUrl: trackingUrl === undefined ? current.trackingUrl : trackingUrl,
    },
    notifyOwner: target === "SHIPPED" && current.shippedAt === null,
  };
}