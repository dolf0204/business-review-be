import { config } from "../config.js";

export type Attachment = { name: string; content: Buffer };
export type Mail = {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
  // Shown as the sender's name, for example "Konoba Ribar via BusinessAsk". The address stays ours.
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export async function sendMail(mail: Mail, log: { info: (o: object, m: string) => void }) {
  if (!config.BREVO_API_KEY) {
    log.info({ to: mail.to, subject: mail.subject, html: mail.html, attachments: mail.attachments?.map((a) => `${a.name} (${a.content.length} bytes)`) }, "mail (not sent, no BREVO_API_KEY)");
    return;
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": config.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: config.MAIL_FROM_EMAIL, name: mail.fromName ?? config.MAIL_FROM_NAME },
      ...(mail.replyTo ? { replyTo: { email: mail.replyTo } } : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
      to: [{ email: mail.to }],
      subject: mail.subject,
      htmlContent: mail.html,
      ...(mail.attachments?.length ? { attachment: mail.attachments.map((a) => ({ name: a.name, content: a.content.toString("base64") })) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
  // Brevo accepting the request is not the same as the mail arriving: this id is what to look up under Transactional, Logs in Brevo.
  const messageId = ((await res.json().catch(() => ({}))) as { messageId?: string }).messageId;
  // While developing, the first link of the mail is logged too, so a mail that does not arrive does not block testing. Never in production: it holds a login token.
  const link = config.NODE_ENV === "production" ? undefined : /href="([^"]+)"/.exec(mail.html)?.[1];
  log.info({ toDomain: mail.to.split("@")[1], from: config.MAIL_FROM_EMAIL, messageId, ...(link ? { link } : {}) }, "mail accepted by Brevo");
}
