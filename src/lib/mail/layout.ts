export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const MAIL_COLORS = {
  brand: "#0f766e",
  brandSoft: "#ccfbf1",
  header: "#0b1f1d",
  ink: "#1f2937",
  muted: "#6b7280",
  line: "#e5e7eb",
  page: "#f3f4f6",
  card: "#ffffff",
  panel: "#f0fdfa",
  free: "#15803d",
  freeSoft: "#dcfce7",
} as const;

const FONT = "Arial,Helvetica,sans-serif";
export const MAIL_WIDTH_PX = 600;
export const MAIL_IMAGE_PX = 88;
const C = MAIL_COLORS;

export const MAIL_STYLE = {
  heading: `margin:0 0 8px;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:700;color:${C.ink}`,
  lead: `margin:0 0 24px;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.muted}`,
  label: `margin:0 0 10px;font-family:${FONT};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:${C.brand}`,
  text: `margin:0;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.ink}`,
  small: `margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted}`,
  strong: `font-weight:700;color:${C.ink}`,
  button: `display:inline-block;background:${C.brand};color:#ffffff;padding:14px 28px;border-radius:10px;font-family:${FONT};font-size:16px;font-weight:700;text-decoration:none`,
  pill: `display:inline-block;background:${C.brandSoft};color:${C.brand};padding:5px 12px;border-radius:999px;font-family:${FONT};font-size:13px;font-weight:700`,
  freePill: `display:inline-block;background:${C.freeSoft};color:${C.free};padding:3px 10px;border-radius:999px;font-family:${FONT};font-size:12px;font-weight:700`,
  panel: `background:${C.panel};border:1px solid ${C.brandSoft};border-radius:14px;padding:20px`,
  section: "padding:0 32px 28px",
  rule: `border-top:1px solid ${C.line};font-size:0;line-height:0`,
  image: "display:block;border-radius:12px;background:#0b0f14",
  dot: `display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid ${C.line};margin-right:6px`,
  step: `display:inline-block;width:26px;height:26px;border-radius:50%;background:${C.brand};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:700;line-height:26px;text-align:center`,
} as const;

export interface MailLayoutInput {
  preheader: string;
  appUrl: string;
  body: string;
  footerNote: string;
}

export function mailLayout(i: MailLayoutInput): string {
  const host = new URL(i.appUrl).host;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px">${esc(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="${MAIL_WIDTH_PX}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${MAIL_WIDTH_PX}px">
<tr><td style="background:${C.header};border-radius:16px 16px 0 0;padding:28px 32px">
<a href="${esc(i.appUrl)}" style="text-decoration:none;font-family:${FONT};font-size:26px;font-weight:700;color:#ffffff">Business<span style="color:#5eead4">Ask</span></a>
<div style="font-family:${FONT};font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#99f6e4;padding-top:6px">Handmade review stands</div>
</td></tr>
<tr><td style="background:${C.card}">
${i.body}
</td></tr>
<tr><td style="background:${C.card};border-radius:0 0 16px 16px;padding:0 32px 28px">
<div style="${MAIL_STYLE.rule}">&nbsp;</div>
<p style="${MAIL_STYLE.small};padding-top:20px">${esc(i.footerNote)}</p>
<p style="${MAIL_STYLE.small};padding-top:10px">BusinessAsk &middot; <a href="${esc(i.appUrl)}" style="color:${C.muted}">${esc(host)}</a></p>
</td></tr>
</table></td></tr></table></body></html>`;
}