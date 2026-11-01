import { createHmac, timingSafeEqual } from "node:crypto";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The key in the "mark as posted" link of the kit mail: whoever holds the mail may mark that one request as posted. Nothing is stored. */
export function kitKey(requestId: string, secret: string): string {
  return createHmac("sha256", secret).update(`kit-shipped:${requestId}`).digest("base64url");
}

export function isKitKey(given: string, requestId: string, secret: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(kitKey(requestId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const shipCountries = (raw: string) => [...new Set(raw.split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];

export interface KitMailInput {
  business: string;
  ownerEmail: string;
  printText: string;
  name: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: string;
  phone: string | null;
  qrUrl: string;
  nfcUrl: string;
  link: string;
}

/** The mail to the person who makes and posts the kit: what to print, where to send it, what to write on the tag. Everything typed by the owner is escaped. */
export function kitOperatorMail(i: KitMailInput) {
  return {
    subject: `Free kit to make: ${i.business}`,
    html: `<p>A paid business asked for its free kit (plastic sign with the QR code and an NFC tag).</p>
<h3>Print on the sign</h3>
<p><strong>${esc(i.printText)}</strong><br>QR code: see the attached PNG (print) and SVG (vector). It opens <code>${esc(i.qrUrl)}</code></p>
<h3>Write on the NFC tag</h3>
<p>One URL record: <code>${esc(i.nfcUrl)}</code></p>
<h3>Post to</h3>
<p>${esc(i.name)}<br>${esc(i.line1)}<br>${i.line2 ? `${esc(i.line2)}<br>` : ""}${esc(i.postalCode)} ${esc(i.city)}<br>${esc(i.country)}${i.phone ? `<br>Phone: ${esc(i.phone)}` : ""}</p>
<p>Business: ${esc(i.business)}, owner ${esc(i.ownerEmail)}</p>
<p><a href="${esc(i.link)}">When it is posted, open this and mark it as posted</a> (the owner is told, with the tracking link if you add one).</p>`,
  };
}

export const kitOwnerReceivedMail = (business: string) => ({
  subject: `We got your kit request: ${business}`,
  html: `<p>Thank you! We will make the sign with your QR code and the NFC tag for <strong>${esc(business)}</strong> and post it to the address you gave. We will email you when it is on its way.</p>`,
});

export const kitShippedMail = (business: string, trackingUrl: string | null) => ({
  subject: `Your kit is on its way: ${business}`,
  html: `<p>The sign with the QR code and the NFC tag for <strong>${esc(business)}</strong> is posted.${trackingUrl ? ` You can follow it here: <a href="${esc(trackingUrl)}">${esc(trackingUrl)}</a>` : ""}</p>`,
});
