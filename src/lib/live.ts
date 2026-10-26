/** Is the business's page open to guests? Published, and paid up (the subscription has not run out). */
export function isLive(b: { publishedAt: Date | null; paidUntil: Date | null }, now = new Date()): boolean {
  return b.publishedAt !== null && b.paidUntil !== null && b.paidUntil > now;
}

/** The same condition for a database query. */
export const liveWhere = (now = new Date()) => ({ publishedAt: { not: null }, paidUntil: { gt: now } });
