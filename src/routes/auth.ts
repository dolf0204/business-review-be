import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { TokenKind } from "../generated/prisma/enums.js";
import { sendMail } from "../lib/mail.js";
import { hashToken, newToken } from "../lib/tokens.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { UI_LANGS } from "../schemas.js";

const DAY = 24 * 60 * 60 * 1000;
const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(8).max(200);

async function issueToken(userId: string, kind: TokenKind, ttlMs: number) {
  const { token, hash } = newToken();
  await prisma.authToken.create({ data: { userId, kind, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

/** Email trouble must never turn into a failed request or a leaked error. The owner can always ask for a new link. */
async function trySend(req: { log: { error: (o: object, m: string) => void; info: (o: object, m: string) => void } }, mail: Parameters<typeof sendMail>[0]) {
  try {
    await sendMail(mail, req.log);
  } catch (err) {
    req.log.error({ err: (err as Error).message, toDomain: mail.to.split("@")[1] }, "email could not be sent");
  }
}

async function consumeToken(token: string, kind: TokenKind) {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) return null;
  await prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

const verifyMail = (to: string, token: string) => {
  const link = `${config.APP_URL}/verify-email?token=${token}`;
  return { to, subject: "Confirm your email", html: `<p>Welcome to BusinessAsk.</p><p><a href="${link}">Confirm your email</a></p>` };
};

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  r.post("/auth/register", {
    ...strict,
    schema: { body: z.object({ email, password, name: z.string().trim().max(100).optional(), uiLang: z.string().max(5).optional(), turnstileToken: z.string().max(4000).optional() }) },
  }, async (req, reply) => {
    const { email: addr, password: pw, name, uiLang } = req.body;
    // Sign-up sends a mail to any address given, so it is checked for robots first.
    if (!(await verifyTurnstile(req.body.turnstileToken, req.ip))) return reply.code(400).send({ error: "captcha_failed" });
    const existing = await prisma.user.findUnique({ where: { email: addr } });
    // Same response either way so the endpoint cannot be used to probe for accounts.
    if (!existing) {
      const user = await prisma.user.create({
        data: { email: addr, name, uiLang: (UI_LANGS as readonly string[]).includes(uiLang ?? "") ? uiLang! : "en", passwordHash: await argon2.hash(pw) },
      });
      await trySend(req, verifyMail(addr, await issueToken(user.id, "VERIFY_EMAIL", 2 * DAY)));
    }
    return reply.code(202).send({ ok: true });
  });

  // Same answer whether or not the address exists, so it cannot be used to find out who has an account.
  r.post("/auth/resend-verification", { ...strict, schema: { body: z.object({ email }) } }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (user && !user.emailVerifiedAt) await trySend(req, verifyMail(user.email, await issueToken(user.id, "VERIFY_EMAIL", 2 * DAY)));
    return reply.code(202).send({ ok: true });
  });

  r.post("/auth/verify-email", { schema: { body: z.object({ token: z.string().min(10) }) } }, async (req, reply) => {
    const userId = await consumeToken(req.body.token, "VERIFY_EMAIL");
    if (!userId) return reply.code(400).send({ error: "invalid_or_expired_token" });
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return { ok: true };
  });

  r.post("/auth/login", { ...strict, schema: { body: z.object({ email, password }) } }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    const valid = user?.passwordHash ? await argon2.verify(user.passwordHash, req.body.password) : false;
    if (!user || !valid) return reply.code(401).send({ error: "invalid_credentials" });
    if (!user.emailVerifiedAt) return reply.code(403).send({ error: "email_not_verified" });
    const jwt = app.jwt.sign({ sub: user.id }, { expiresIn: "7d" });
    reply.setCookie("session", jwt, { path: "/", httpOnly: true, sameSite: "lax", secure: config.COOKIE_SECURE, maxAge: (7 * DAY) / 1000 });
    return { ok: true };
  });

  r.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  r.post("/auth/forgot-password", { ...strict, schema: { body: z.object({ email, turnstileToken: z.string().max(4000).optional() }) } }, async (req, reply) => {
    if (!(await verifyTurnstile(req.body.turnstileToken, req.ip))) return reply.code(400).send({ error: "captcha_failed" });
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (user) {
      const token = await issueToken(user.id, "RESET_PASSWORD", 60 * 60 * 1000);
      const link = `${config.APP_URL}/reset-password?token=${token}`;
      await trySend(req, { to: user.email, subject: "Reset your password", html: `<p><a href="${link}">Choose a new password</a>. The link works for one hour.</p>` });
    }
    return reply.code(202).send({ ok: true });
  });

  r.post("/auth/reset-password", { schema: { body: z.object({ token: z.string().min(10), password }) } }, async (req, reply) => {
    const userId = await consumeToken(req.body.token, "RESET_PASSWORD");
    if (!userId) return reply.code(400).send({ error: "invalid_or_expired_token" });
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(req.body.password), emailVerifiedAt: new Date() } });
    return { ok: true };
  });

  r.get("/auth/me", { onRequest: [app.authenticate] }, async (req) =>
    prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { id: true, email: true, name: true, uiLang: true } }),
  );
}
