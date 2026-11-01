import { createHmac, timingSafeEqual } from "node:crypto";

/** The key in the link of the review mail: whoever holds the mail may approve or reject that one business. Nothing is stored. */
export function reviewKey(businessId: string, secret: string): string {
  return createHmac("sha256", secret).update(`operator-review:${businessId}`).digest("base64url");
}

export function isReviewKey(given: string, businessId: string, secret: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(reviewKey(businessId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function couponReviewKey(couponId: string, secret: string): string {
  return createHmac("sha256", secret).update(`operator-coupon:${couponId}`).digest("base64url");
}

export function isCouponReviewKey(given: string, couponId: string, secret: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(couponReviewKey(couponId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const operatorList =(raw: string) => raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface ReviewMailInput {
  name: string;
  offerText: string | null;
  address: string | null;
  googleMapsUrl: string | null;
  ownerEmail: string;
  link: string;
  changed: boolean;
  note?: string;
}

export interface CouponMailInput {
  businessName: string;
  title: string;
  description: string | null;
  ownerEmail: string;
  link: string;
  note?: string;
}

export function couponReviewMail(i: CouponMailInput) {
  return {
    subject: `Coupon to approve: ${i.businessName}`,
    html: `<p><strong>${esc(i.businessName)}</strong> created a coupon that is not shown to tourists yet.</p>
<ul>
<li>Title: ${esc(i.title)}</li>
<li>Description: ${esc(i.description ?? "(none)")}</li>
<li>Owner: ${esc(i.ownerEmail)}</li>
${i.note ? `<li>Automatic check: ${esc(i.note)}</li>\n` : ""}</ul>
<p>The coupon stays visible on the business's own page. Decide if tourists may see it too:</p>
<p><a href="${esc(i.link)}">Review and decide</a></p>`,
  };
}

/** The mail that asks the operator to look at a business before TouristAsk shows it. Everything the owner typed is escaped. */
export function reviewMail(i: ReviewMailInput) {
  return {
    subject: `${i.changed ? "Changed" : "New"} business to approve: ${i.name}`,
    html: `<p><strong>${esc(i.name)}</strong> ${i.changed ? "changed its page and needs a new check" : "has published its page"}.</p>
<ul>
<li>Offer: ${esc(i.offerText ?? "(none)")}</li>
<li>Address: ${esc(i.address ?? "(none)")}</li>
<li>Google page: ${i.googleMapsUrl ? `<a href="${esc(i.googleMapsUrl)}">open</a>` : "(none)"}</li>
<li>Owner: ${esc(i.ownerEmail)}</li>
${i.note ? `<li>Automatic check: ${esc(i.note)}</li>\n` : ""}</ul>
<p>Check that the offer belongs to this business and is fine to show to tourists, then decide:</p>
<p><a href="${esc(i.link)}">Review and decide</a></p>`,
  };
}