import { randomBytes } from "node:crypto";

// No 0/o/1/l/i so a printed code is hard to misread.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function newCode(length = 8) {
  return Array.from(randomBytes(length), (b) => ALPHABET.charAt(b % ALPHABET.length)).join("");
}

/**
 * The address guests open: the front end's /b/<code>. The source (qr or nfc) is a short hint in the address, so later we can
 * tell which of the two brings guests; the code itself is what identifies the business.
 */
export function shareUrl(appUrl: string, code: string, source: "qr" | "nfc"): string {
  return `${appUrl.replace(/\/+$/, "")}/b/${code}?s=${source === "nfc" ? "n" : "q"}`;
}
