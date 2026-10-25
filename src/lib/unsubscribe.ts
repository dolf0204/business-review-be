import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The key in an unsubscribe link. It is derived from the membership and the server secret, so the link needs no login and no stored
 * token, nobody can make one for somebody else's membership, and it keeps working for as long as the mail is in the inbox.
 */
export function unsubscribeKey(membershipId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${membershipId}`).digest("base64url");
}

export function isUnsubscribeKey(given: string, membershipId: string, secret: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(unsubscribeKey(membershipId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
