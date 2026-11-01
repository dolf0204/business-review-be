import { createHmac, timingSafeEqual } from "node:crypto";
import { distanceKm } from "./geo.js";

export const DEFAULT_RADIUS_METERS = 150;
// Phone positions indoors are off by tens of metres; the reported accuracy is allowed for, but only up to this much.
const MAX_ACCURACY_BONUS_METERS = 100;

const DAY_MS = 86_400_000;
export const MAX_CARD_VALID_DAYS = 730;

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export type WindowState = "upcoming" | "active" | "ended";

/** Is the program running now? A missing start or end means no limit on that side. */
export function windowState(startsAt: Date | null, endsAt: Date | null, now: Date): WindowState {
  if (startsAt && now < startsAt) return "upcoming";
  if (endsAt && now > endsAt) return "ended";
  return "active";
}

export function cardExpiry(validDays: number | null, from: Date): Date | null {
  return validDays ? new Date(from.getTime() + validDays * DAY_MS) : null;
}

export function cardExpired(card: { completedAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
  return card.completedAt === null && card.expiresAt !== null && now > card.expiresAt;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.round(distanceKm(a, b) * 1000);
}

/** Near enough: inside the radius, with the phone's own reported accuracy allowed for (up to 100 m). */
export function isNearEnough(distanceM: number, radiusM: number, accuracyM: number | undefined): boolean {
  const bonus = Math.min(Math.max(accuracyM ?? 0, 0), MAX_ACCURACY_BONUS_METERS);
  return distanceM <= radiusM + bonus;
}

/**
 * The code staff show to a guest who cannot share a location, and enter to redeem a reward. Six digits, different every day and
 * for every business, derived from the server secret, so nothing is stored and a guest cannot work out tomorrow's code.
 */
export function staffCode(businessId: string, day: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`staff:${businessId}:${day}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function isStaffCode(given: string | undefined, businessId: string, day: string, secret: string): boolean {
  if (!given || !/^\d{6}$/.test(given)) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(staffCode(businessId, day, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}