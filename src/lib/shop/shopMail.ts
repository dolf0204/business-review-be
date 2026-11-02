import { esc, MAIL_COLORS, MAIL_IMAGE_PX, MAIL_STYLE, mailLayout } from "../mail/layout.js";
import { DESIGN_LABELS, FINISH_COLORS, FINISH_LABELS, shopImageUrl } from "./catalog.js";
import { euro, orderRef } from "./order.js";

const SHOP_PAGE_PATH = "/shop";
const GAP_PX = 14;
const INVOICE_NOTE = "You will get an invoice by email. The seller is not in the VAT system.";
const FREE_LABEL = "FREE";
const NEXT_STEPS = [
  { title: "We make it", text: "Your stand is handmade and engraved with your text." },
  { title: "We post it", text: "It goes to the address above, and we email you the moment it is on its way." },
  { title: "You put it out", text: "Guests scan the QR code or tap the NFC tag and land straight on your page." },
] as const;

const label = (labels: Readonly<Record<string, string>>, key: string) => labels[key] ?? key;
const countryName = (code: string) => new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
const orderDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shopLink = (appUrl: string, businessId: string) => `${appUrl.replace(/\/+$/, "")}${SHOP_PAGE_PATH}?business=${businessId}`;
const button = (href: string, text: string) => `<a href="${esc(href)}" style="${MAIL_STYLE.button}">${esc(text)}</a>`;
const gap = `<div style="height:${GAP_PX}px;line-height:${GAP_PX}px;font-size:0">&nbsp;</div>`;

export interface ReceivedItem {
  design: string;
  finish: string;
  size: string;
  printText: string;
  listCents: number;
  unitCents: number;
}

export interface ShopReceivedInput {
  appUrl: string;
  orderId: string;
  businessId: string;
  business: string;
  createdAt: Date;
  items: readonly ReceivedItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  paidOnline: boolean;
  name: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: string;
  phone: string | null;
}

function priceCell(i: ReceivedItem): string {
  if (i.unitCents === 0) return `<span style="${MAIL_STYLE.freePill}">${FREE_LABEL}</span><div style="${MAIL_STYLE.small};padding-top:6px;text-decoration:line-through">${esc(euro(i.listCents))}</div>`;
  const was = i.unitCents < i.listCents ? `<div style="${MAIL_STYLE.small};padding-top:2px;text-decoration:line-through">${esc(euro(i.listCents))}</div>` : "";
  return `<span style="${MAIL_STYLE.text};${MAIL_STYLE.strong}">${esc(euro(i.unitCents))}</span>${was}`;
}

function itemRow(i: ReceivedItem, appUrl: string): string {
  const name = label(DESIGN_LABELS, i.design);
  const finish = label(FINISH_LABELS, i.finish);
  const dot = `<span style="${MAIL_STYLE.dot};background:${label(FINISH_COLORS, i.finish)}"></span>`;
  return `<tr>
<td width="${MAIL_IMAGE_PX}" valign="top" style="padding:14px 16px 14px 0;border-top:1px solid ${MAIL_COLORS.line}"><img src="${esc(shopImageUrl(appUrl, i.design, i.finish))}" width="${MAIL_IMAGE_PX}" height="${MAIL_IMAGE_PX}" alt="${esc(name)}" style="${MAIL_STYLE.image}"></td>
<td valign="top" style="padding:14px 0;border-top:1px solid ${MAIL_COLORS.line}"><p style="${MAIL_STYLE.text};${MAIL_STYLE.strong}">${esc(name)}</p><p style="${MAIL_STYLE.small};padding-top:4px">${dot}${esc(finish)} &middot; Size ${esc(i.size)}</p><p style="${MAIL_STYLE.small};padding-top:4px">Engraved: <span style="${MAIL_STYLE.strong}">${esc(i.printText)}</span></p></td>
<td valign="top" align="right" style="padding:14px 0 14px 12px;border-top:1px solid ${MAIL_COLORS.line};white-space:nowrap">${priceCell(i)}</td>
</tr>`;
}

const totalRow = (text: string, value: string, strong = false) =>
  `<tr><td style="padding:4px 0;${strong ? `${MAIL_STYLE.text};${MAIL_STYLE.strong};font-size:17px` : MAIL_STYLE.small}">${esc(text)}</td><td align="right" style="padding:4px 0;${strong ? `${MAIL_STYLE.text};${MAIL_STYLE.strong};font-size:17px` : MAIL_STYLE.small}">${esc(value)}</td></tr>`;

const stepRow = (n: number, title: string, text: string) =>
  `<tr><td width="40" valign="top" style="padding:8px 0"><span style="${MAIL_STYLE.step}">${n}</span></td><td valign="top" style="padding:8px 0"><p style="${MAIL_STYLE.text};${MAIL_STYLE.strong}">${esc(title)}</p><p style="${MAIL_STYLE.small};padding-top:2px">${esc(text)}</p></td></tr>`;

export function shopOwnerReceivedMail(i: ShopReceivedInput) {
  const ref = orderRef(i.orderId);
  const count = i.items.length;
  const payment = i.totalCents === 0 ? "Free with your yearly plan, nothing to pay." : i.paidOnline ? "Paid online by card." : "";
  const address = [i.name, i.line1, i.line2, `${i.postalCode} ${i.city}`, countryName(i.country), i.phone ? `Phone: ${i.phone}` : null].filter((l): l is string => !!l).map(esc).join("<br>");
  const body = `<div style="padding:36px 32px 8px">
<span style="${MAIL_STYLE.pill}">Order #${esc(ref)}</span>
${gap}
<h1 style="${MAIL_STYLE.heading}">Thank you, your order is in</h1>
<p style="${MAIL_STYLE.lead}">We will handmake ${count} stand${count === 1 ? "" : "s"} for <span style="${MAIL_STYLE.strong}">${esc(i.business)}</span>. Placed on ${esc(orderDate(i.createdAt))}.</p>
</div>
<div style="${MAIL_STYLE.section}">
<p style="${MAIL_STYLE.label}">Your order</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${i.items.map((it) => itemRow(it, i.appUrl)).join("")}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${MAIL_COLORS.line};margin-top:2px">
${totalRow("Subtotal", euro(i.subtotalCents))}${totalRow("Shipping", i.shippingCents === 0 ? "Free" : euro(i.shippingCents))}${totalRow("Total", euro(i.totalCents), true)}
</table>
${payment ? `<p style="${MAIL_STYLE.small};padding-top:8px">${esc(payment)}</p>` : ""}
${i.totalCents > 0 ? `<p style="${MAIL_STYLE.small};padding-top:4px">${esc(INVOICE_NOTE)}</p>` : ""}
</div>
<div style="${MAIL_STYLE.section}"><div style="${MAIL_STYLE.panel}">
<p style="${MAIL_STYLE.label}">Shipping to</p>
<p style="${MAIL_STYLE.text}">${address}</p>
</div></div>
<div style="${MAIL_STYLE.section}">
<p style="${MAIL_STYLE.label}">What happens next</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${NEXT_STEPS.map((s, n) => stepRow(n + 1, s.title, s.text)).join("")}</table>
</div>
<div style="${MAIL_STYLE.section};text-align:center">${button(shopLink(i.appUrl, i.businessId), "View your order")}</div>`;
  return {
    subject: `Order #${ref} confirmed: ${i.business}`,
    html: mailLayout({ appUrl: i.appUrl, preheader: `Order #${ref}: ${count} handmade stand${count === 1 ? "" : "s"}, total ${euro(i.totalCents)}.`, body, footerNote: "Questions about your order? Just reply to this email and quote your order number." }),
  };
}

export interface ShopShippedInput {
  appUrl: string;
  orderId: string;
  businessId: string;
  business: string;
  trackingUrl: string | null;
}

export function shopShippedMail(i: ShopShippedInput) {
  const ref = orderRef(i.orderId);
  const body = `<div style="padding:36px 32px 36px;text-align:center">
<span style="${MAIL_STYLE.pill}">Order #${esc(ref)}</span>
${gap}
<h1 style="${MAIL_STYLE.heading}">Your stand is on its way</h1>
<p style="${MAIL_STYLE.lead}">The handmade stand order for <span style="${MAIL_STYLE.strong}">${esc(i.business)}</span> is posted.${i.trackingUrl ? " Follow the parcel with the button below." : ""}</p>
${button(i.trackingUrl ?? shopLink(i.appUrl, i.businessId), i.trackingUrl ? "Track your parcel" : "View your order")}
</div>`;
  return {
    subject: `Your stand is on its way: ${i.business}`,
    html: mailLayout({ appUrl: i.appUrl, preheader: `Order #${ref} is posted.`, body, footerNote: "Questions about your order? Just reply to this email and quote your order number." }),
  };
}