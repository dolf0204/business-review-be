import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", async (orig) => {
  const mod = (await orig()) as { config: Record<string, unknown> };
  return { config: { ...mod.config, BREVO_API_KEY: "test-brevo-key", NODE_ENV: "development", MAIL_FROM_EMAIL: "no-reply@businessask.eu", MAIL_FROM_NAME: "BusinessAsk" } };
});

import { sendMail } from "../src/lib/mail.js";

const mail = { to: "guest@example.com", subject: "Confirm", html: '<p><a href="http://localhost:5190/verify-email?token=abc123">Confirm</a></p>' };

afterEach(() => vi.unstubAllGlobals());

describe("sending mail through Brevo", () => {
  it("logs the message id and, while developing, the link, but never the address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messageId: "<abc@smtp-relay.brevo.com>" }), { status: 201 })));
    const log = { info: vi.fn() };
    await sendMail(mail, log);
    const [fields, text] = log.info.mock.calls[0]!;
    expect(text).toBe("mail accepted by Brevo");
    expect(fields).toMatchObject({ toDomain: "example.com", from: "no-reply@businessask.eu", messageId: "<abc@smtp-relay.brevo.com>", link: "http://localhost:5190/verify-email?token=abc123" });
    expect(JSON.stringify(fields)).not.toContain("guest@example.com");
  });

  it("throws with Brevo's answer when it refuses, so the caller can log it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"Sender is not valid"}', { status: 400 })));
    await expect(sendMail(mail, { info: vi.fn() })).rejects.toThrow("Brevo responded 400");
  });
});
