// The emails a guest receives. Written in the guest's language; unknown languages get English.
type Lang = "en" | "hr";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function joinMail(lang: string, businessName: string, link: string) {
  const l: Lang = lang === "hr" ? "hr" : "en";
  const name = esc(businessName);
  if (l === "hr") {
    return {
      subject: `Potvrdite prijavu: ${businessName}`,
      html: `<p>Dobrodošli u ${name}!</p><p><a href="${link}">Otvorite stranicu i potvrdite e-poštu</a></p><p>Poveznica vrijedi 30 minuta. Ako se niste prijavili vi, slobodno zanemarite ovu poruku.</p>`,
    };
  }
  return {
    subject: `Confirm your sign-in: ${businessName}`,
    html: `<p>Welcome to ${name}!</p><p><a href="${link}">Open the page and confirm your email</a></p><p>The link works for 30 minutes. If you did not ask for it, you can ignore this message.</p>`,
  };
}
