import { config } from "../config.js";

export type Attachment = { name: string; content: Buffer };
export type Mail = { to: string; subject: string; html: string; attachments?: Attachment[] };

export async function sendMail(mail: Mail, log: { info: (o: object, m: string) => void }) {
  if (!config.BREVO_API_KEY) {
    log.info({ to: mail.to, subject: mail.subject, html: mail.html, attachments: mail.attachments?.map((a) => `${a.name} (${a.content.length} bytes)`) }, "mail (not sent, no BREVO_API_KEY)");
    return;
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": config.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: config.MAIL_FROM_EMAIL, name: config.MAIL_FROM_NAME },
      to: [{ email: mail.to }],
      subject: mail.subject,
      htmlContent: mail.html,
      ...(mail.attachments?.length ? { attachment: mail.attachments.map((a) => ({ name: a.name, content: a.content.toString("base64") })) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
}
