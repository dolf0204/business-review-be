import { createHmac, timingSafeEqual } from "node:crypto";
import { SHIPPING_CENTS, SIZE_PRICE_CENTS, YEARLY_DISCOUNT_PERCENT, type ShopDesignId, type ShopFinish, type ShopSize } from "./catalog.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const euro = (cents: number) => `${(cents / 100).toFixed(2)} EUR`;

export interface ShopItemInput {
  design: ShopDesignId;
  finish: ShopFinish;
  size: ShopSize;
  printText: string;
}

export interface PricedItem extends ShopItemInput {
  listCents: number;
  unitCents: number;
  free: boolean;
}

export interface PricedOrder {
  items: PricedItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  freeApplied: boolean;
}

export interface PricingContext {
  yearly: boolean;
  freeAvailable: boolean;
}

export function priceOrder(inputs: readonly ShopItemInput[], ctx: PricingContext): PricedOrder {
  const lists = inputs.map((i) => SIZE_PRICE_CENTS[i.size]);
  const freeIndex = ctx.freeAvailable && lists.length > 0 ? lists.indexOf(Math.max(...lists)) : -1;
  const items = inputs.map((input, index): PricedItem => {
    const listCents = lists[index]!;
    const free = index === freeIndex;
    const unitCents = free ? 0 : ctx.yearly ? Math.round((listCents * (100 - YEARLY_DISCOUNT_PERCENT)) / 100) : listCents;
    return { ...input, listCents, unitCents, free };
  });
  const subtotalCents = items.reduce((sum, i) => sum + i.unitCents, 0);
  return { items, subtotalCents, shippingCents: SHIPPING_CENTS, totalCents: subtotalCents + SHIPPING_CENTS, freeApplied: freeIndex >= 0 };
}

export interface SubscriptionState {
  interval: "MONTH" | "YEAR";
  status: "ACTIVE" | "PAST_DUE" | "CANCELED";
  currentPeriodEnd: Date | null;
}

export function freePeriodEnd(sub: SubscriptionState | null, now: Date): Date | null {
  if (!sub || sub.interval !== "YEAR" || sub.status !== "ACTIVE" || !sub.currentPeriodEnd) return null;
  return sub.currentPeriodEnd > now ? sub.currentPeriodEnd : null;
}

export function shopKey(orderId: string, secret: string): string {
  return createHmac("sha256", secret).update(`shop-shipped:${orderId}`).digest("base64url");
}

export function isShopKey(given: string, orderId: string, secret: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(shopKey(orderId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface MailItem {
  design: string;
  finish: string;
  size: string;
  printText: string;
  unitCents: number;
  free: boolean;
}

export interface ShopMailInput {
  business: string;
  ownerEmail: string;
  items: readonly MailItem[];
  totalCents: number;
  paidOnline: boolean;
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

const itemLine = (i: MailItem) =>
  `<li><strong>${esc(i.design)}</strong>, finish ${esc(i.finish)}, size ${esc(i.size)}, engrave: <strong>${esc(i.printText)}</strong> (${i.free ? "FREE, yearly plan" : euro(i.unitCents)})</li>`;

export function shopOperatorMail(i: ShopMailInput) {
  const money = i.totalCents === 0 ? "Nothing to invoice, the whole order is free with the yearly plan." : i.paidOnline ? `Paid online: ${euro(i.totalCents)}. Issue the invoice in eRacuni.` : `Total: ${euro(i.totalCents)}.`;
  return {
    subject: `Stand order: ${i.business}`,
    html: `<p>A business ordered handmade stands.</p>
<h3>Make</h3>
<ul>${i.items.map(itemLine).join("")}</ul>
<p>QR code: see the attached PNG (print) and SVG (vector). It opens <code>${esc(i.qrUrl)}</code></p>
<h3>Write on the NFC tag</h3>
<p>One URL record: <code>${esc(i.nfcUrl)}</code></p>
<h3>Money</h3>
<p>${esc(money)}</p>
<h3>Post to</h3>
<p>${esc(i.name)}<br>${esc(i.line1)}<br>${i.line2 ? `${esc(i.line2)}<br>` : ""}${esc(i.postalCode)} ${esc(i.city)}<br>${esc(i.country)}${i.phone ? `<br>Phone: ${esc(i.phone)}` : ""}</p>
<p>Business: ${esc(i.business)}, owner ${esc(i.ownerEmail)}</p>
<p><a href="${esc(i.link)}">When it is posted, open this and mark it as posted</a> (the owner is told, with the tracking link if you add one).</p>`,
  };
}

export const shopOwnerReceivedMail = (business: string, count: number, totalCents: number) => ({
  subject: `We got your stand order: ${business}`,
  html: `<p>Thank you! We will handmake ${count} stand${count === 1 ? "" : "s"} for <strong>${esc(business)}</strong>, sign ${count === 1 ? "it" : "them"} with the B-ask mark and post ${count === 1 ? "it" : "them"} to the address you gave. Total: ${esc(euro(totalCents))}. We will email you when ${count === 1 ? "it is" : "they are"} on the way.</p>`,
});

export const shopShippedMail = (business: string, trackingUrl: string | null) => ({
  subject: `Your stand is on its way: ${business}`,
  html: `<p>The handmade stand order for <strong>${esc(business)}</strong> is posted.${trackingUrl ? ` You can follow it here: <a href="${esc(trackingUrl)}">${esc(trackingUrl)}</a>` : ""}</p>`,
});