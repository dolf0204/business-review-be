import { randomBytes } from "node:crypto";

// No 0/o/1/l/i so a printed code is hard to misread.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function newCode(length = 8) {
  return Array.from(randomBytes(length), (b) => ALPHABET.charAt(b % ALPHABET.length)).join("");
}
