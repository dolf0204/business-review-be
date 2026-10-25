// The email a guest gets when a business sends an offer. Plain text from the owner is escaped and laid out; nothing the owner types is trusted as HTML.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const TEXT = {
  en: { open: (n: string) => `Open ${n}`, why: (n: string) => `You get this email because you joined ${n} and agreed to receive its offers.`, stop: "Unsubscribe", test: "This is a test. Guests see the same mail with their own unsubscribe link." },
  hr: { open: (n: string) => `Otvori ${n}`, why: (n: string) => `Ovu poruku primate jer ste se pridružili obrtu ${n} i pristali primati njegove ponude.`, stop: "Odjava", test: "Ovo je probna poruka. Gosti vide istu poruku sa svojom poveznicom za odjavu." },
} as const;

export interface OfferMailInput {
  lang: string;
  businessName: string;
  subject: string;
  body: string;
  pageUrl: string;
  unsubscribeUrl: string;
  color?: string;
  test?: boolean;
}

export function offerMailHtml(i: OfferMailInput): string {
  const t = TEXT[i.lang === "hr" ? "hr" : "en"];
  const color = /^#[0-9a-fA-F]{6}$/.test(i.color ?? "") ? i.color! : "#0f766e";
  const paragraphs = i.body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
<div style="background:${color};color:#fff;padding:18px 20px;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">${esc(i.businessName)}</div>
<div style="padding:20px;border:1px solid #eee;border-top:0;border-radius:0 0 12px 12px">
${i.test ? `<p style="background:#fff7e6;padding:8px 10px;border-radius:8px;font-size:13px">${esc(t.test)}</p>` : ""}
<h2 style="margin:0 0 14px;font-size:20px">${esc(i.subject)}</h2>
${paragraphs}
<p style="margin:20px 0"><a href="${esc(i.pageUrl)}" style="background:${color};color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(t.open(i.businessName))}</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#777">${esc(t.why(i.businessName))} <a href="${esc(i.unsubscribeUrl)}" style="color:#777">${esc(t.stop)}</a></p>
</div></div>`;
}
