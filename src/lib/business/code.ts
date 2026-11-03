import { randomBytes } from "node:crypto";

// No 0/o/1/l/i so a printed code is hard to misread.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

const SOURCE_HINT = { qr: "q", nfc: "n" } as const;

export type ShareSource = keyof typeof SOURCE_HINT;

export function newCode(length = 8) {
  return Array.from(randomBytes(length), (b) => ALPHABET.charAt(b % ALPHABET.length)).join("");
}

/**
 * The permanent address the front end serves at /b/<code>. It is stored with the business and never changes, but guests are
 * sent on to the business's own address, so it is not shown to owners. The source (qr or nfc) is a short hint in the address.
 */
export function shareUrl(appUrl: string, code: string, source: ShareSource): string {
  return `${appUrl.replace(/\/+$/, "")}/b/${code}?s=${SOURCE_HINT[source]}`;
}

/** The business's own address (for example https://tockica.businessask.eu) with the same source hint. */
export function siteShareUrl(site: string, source: ShareSource): string {
  return `${site.replace(/\/+$/, "")}/?s=${SOURCE_HINT[source]}`;
}