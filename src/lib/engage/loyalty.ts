import { createHmac, timingSafeEqual } from 'node:crypto';
import { distanceKm } from '../places/geo.js';

export const DEFAULT_RADIUS_METERS = 150;
// Phone positions indoors are off by tens of metres; the reported accuracy is allowed for, but only up to this much.
const MAX_ACCURACY_BONUS_METERS = 100;

const DAY_MS = 86_400_000;
export const MAX_CARD_VALID_DAYS = 730;
export const MAX_PROGRAMS_PER_BUSINESS = 24;

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export type WindowState = 'upcoming' | 'active' | 'ended';

/** Is the program running now? A missing start or end means no limit on that side. */
export function windowState(
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
): WindowState {
  if (startsAt && now < startsAt) return 'upcoming';
  if (endsAt && now > endsAt) return 'ended';
  return 'active';
}

export type CarryOver = 'RESET' | 'TRANSFER';
export type Period = { startsAt: Date | null; endsAt: Date | null };
export type CardFate = 'keep' | 'transfer' | 'drop';

/** Two periods of one business may not share time. A missing start or end means no limit on that side. */
export function periodsOverlap(a: Period, b: Period): boolean {
  const aStart = a.startsAt?.getTime() ?? -Infinity;
  const aEnd = a.endsAt?.getTime() ?? Infinity;
  const bStart = b.startsAt?.getTime() ?? -Infinity;
  const bEnd = b.endsAt?.getTime() ?? Infinity;
  return aStart < bEnd && bStart < aEnd;
}

/** The running offers of a business, split: the dated ones (one is picked for guests) and the single standing one with no end. */
export function splitPrograms<T extends Period & { standing: boolean }>(
  programs: T[],
  now: Date,
): { dated: T | null; standing: T | null } {
  return {
    dated: pickProgram(
      programs.filter((p) => !p.standing),
      now,
    ),
    standing: programs.find((p) => p.standing) ?? null,
  };
}

/** The period guests deal with now: the running one, else the next to start, else the one that ended last. */
export function pickProgram<T extends Period>(
  programs: T[],
  now: Date,
): T | null {
  const running = programs.find(
    (p) => windowState(p.startsAt, p.endsAt, now) === 'active',
  );
  if (running) return running;
  const upcoming = programs
    .filter((p) => windowState(p.startsAt, p.endsAt, now) === 'upcoming')
    .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
  if (upcoming[0]) return upcoming[0];
  const ended = programs
    .slice()
    .sort((a, b) => (b.endsAt?.getTime() ?? 0) - (a.endsAt?.getTime() ?? 0));
  return ended[0] ?? null;
}

/**
 * What happens to a guest's card when the current period is not the one it was started in: a full card is always kept (the reward is earned),
 * an unfinished one moves on only when the owner chose to transfer stars at the end of its period, otherwise it is left behind.
 */
export function cardFate(
  card: { programId: string | null; completedAt: Date | null },
  currentProgramId: string,
  ownProgram: { carryOver: CarryOver } | null,
): CardFate {
  if (
    card.programId === null ||
    card.programId === currentProgramId ||
    card.completedAt !== null
  )
    return 'keep';
  return ownProgram?.carryOver === 'TRANSFER' ? 'transfer' : 'drop';
}

export function cardExpiry(validDays: number | null, from: Date): Date | null {
  return validDays ? new Date(from.getTime() + validDays * DAY_MS) : null;
}

export type CardView = {
  goal: number;
  rewardText: string;
  complete: boolean;
  expiresAt: Date | null;
  expired: boolean;
};

export function cardView(
  card: {
    goal: number;
    rewardText: string;
    completedAt: Date | null;
    createdAt: Date;
  },
  punches: number,
  rules: { goal: number; rewardText: string; cardValidDays: number | null },
  now: Date,
): CardView {
  if (card.completedAt !== null)
    return {
      goal: card.goal,
      rewardText: card.rewardText,
      complete: true,
      expiresAt: null,
      expired: false,
    };
  const expiresAt = cardExpiry(rules.cardValidDays, card.createdAt);
  const complete = punches >= rules.goal;
  return {
    goal: rules.goal,
    rewardText: rules.rewardText,
    complete,
    expiresAt,
    expired: !complete && expiresAt !== null && now > expiresAt,
  };
}

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  return Math.round(distanceKm(a, b) * 1000);
}

/** Near enough: inside the radius, with the phone's own reported accuracy allowed for (up to 100 m). */
export function isNearEnough(
  distanceM: number,
  radiusM: number,
  accuracyM: number | undefined,
): boolean {
  const bonus = Math.min(
    Math.max(accuracyM ?? 0, 0),
    MAX_ACCURACY_BONUS_METERS,
  );
  return distanceM <= radiusM + bonus;
}

/**
 * The code staff show to a guest who cannot share a location, and enter to redeem a reward. Six digits, different every day and
 * for every business, derived from the server secret, so nothing is stored and a guest cannot work out tomorrow's code.
 */
export function staffCode(
  businessId: string,
  day: string,
  secret: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`staff:${businessId}:${day}`)
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function isStaffCode(
  given: string | undefined,
  businessId: string,
  day: string,
  secret: string,
): boolean {
  if (!given || !/^\d{6}$/.test(given)) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(staffCode(businessId, day, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
