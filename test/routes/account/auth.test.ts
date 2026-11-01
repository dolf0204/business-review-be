import argon2 from "argon2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/lib/sessionCookie.js";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  authToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../src/lib/mail.js", () => mail);
const captcha = vi.hoisted(() => ({ verifyTurnstile: vi.fn() }));
vi.mock("../src/lib/turnstile.js", () => captcha);

import { buildApp } from "../src/app.js";
import { hashToken } from "../src/lib/tokens.js";

async function call(method: "GET" | "POST", url: string, payload?: object, cookie?: string) {
  const app = await buildApp();
  const res = await app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
  await app.close();
  return res;
}

describe("sign up and sign in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    captcha.verifyTurnstile.mockResolvedValue(true);
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "u1" });
  });

  it("creates no account and sends no mail when the robot check fails, on sign-up and on password reset", async () => {
    captcha.verifyTurnstile.mockResolvedValue(false);
    const reg = await call("POST", "/auth/register", { email: "new@example.com", password: "correct horse battery", turnstileToken: "bad" });
    expect(reg.statusCode).toBe(400);
    expect(reg.json()).toEqual({ error: "captcha_failed" });
    const forgot = await call("POST", "/auth/forgot-password", { email: "new@example.com" });
    expect(forgot.statusCode).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it("passes the token the browser sent to the check", async () => {
    await call("POST", "/auth/register", { email: "new@example.com", password: "correct horse battery", turnstileToken: "tok" });
    expect(captcha.verifyTurnstile.mock.calls[0]![0]).toBe("tok");
  });

  it("registers, stores only a hash of the password, and mails a confirm link to the front end", async () => {
    const res = await call("POST", "/auth/register", { email: " New@Example.com ", password: "correct horse battery", uiLang: "hr" });
    expect(res.statusCode).toBe(202);
    const data = db.user.create.mock.calls[0]![0].data;
    expect(data.email).toBe("new@example.com");
    expect(data.uiLang).toBe("hr");
    expect(data.passwordHash).not.toContain("correct");
    expect(mail.sendMail.mock.calls[0]![0].html).toContain("http://localhost:5190/verify-email?token=");
    const stored = db.authToken.create.mock.calls[0]![0].data;
    expect(stored.kind).toBe("VERIFY_EMAIL");
    expect(stored.tokenHash).toHaveLength(64);
  });

  it("answers the same for an address that already has an account, and sends nothing", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", email: "a@example.com" });
    const res = await call("POST", "/auth/register", { email: "a@example.com", password: "correct horse battery" });
    expect(res.statusCode).toBe(202);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it("refuses a short password and an unknown language falls back to English", async () => {
    expect((await call("POST", "/auth/register", { email: "a@example.com", password: "short" })).statusCode).toBe(400);
    await call("POST", "/auth/register", { email: "b@example.com", password: "correct horse battery", uiLang: "xx" });
    expect(db.user.create.mock.calls[0]![0].data.uiLang).toBe("en");
  });

  it("signs in only with the right password and a confirmed email, and sets a session cookie", async () => {
    const passwordHash = await argon2.hash("correct horse battery");
    db.user.findUnique.mockResolvedValue({ id: "u1", email: "a@example.com", passwordHash, emailVerifiedAt: null });
    expect((await call("POST", "/auth/login", { email: "a@example.com", password: "correct horse battery" })).statusCode).toBe(403);
    db.user.findUnique.mockResolvedValue({ id: "u1", email: "a@example.com", passwordHash, emailVerifiedAt: new Date() });
    expect((await call("POST", "/auth/login", { email: "a@example.com", password: "wrong password!" })).statusCode).toBe(401);
    const ok = await call("POST", "/auth/login", { email: "a@example.com", password: "correct horse battery" });
    expect(ok.statusCode).toBe(200);
    expect(String(ok.headers["set-cookie"])).toMatch(new RegExp(`${SESSION_COOKIE}=.*HttpOnly`, "i"));
  });

  it("confirms an email with a valid link once, and refuses an old or used one", async () => {
    const token = "a-long-enough-token-value";
    db.authToken.findUnique.mockResolvedValue({ id: "t1", userId: "u1", kind: "VERIFY_EMAIL", usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    expect((await call("POST", "/auth/verify-email", { token })).statusCode).toBe(200);
    expect(db.authToken.findUnique.mock.calls[0]![0].where.tokenHash).toBe(hashToken(token));
    expect(db.user.update.mock.calls[0]![0].data.emailVerifiedAt).toBeInstanceOf(Date);
    db.authToken.findUnique.mockResolvedValue({ id: "t1", userId: "u1", kind: "VERIFY_EMAIL", usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    expect((await call("POST", "/auth/verify-email", { token })).statusCode).toBe(400);
    db.authToken.findUnique.mockResolvedValue({ id: "t1", userId: "u1", kind: "RESET_PASSWORD", usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    expect((await call("POST", "/auth/verify-email", { token })).statusCode).toBe(400);
  });

  it("resets a password with a valid link", async () => {
    db.authToken.findUnique.mockResolvedValue({ id: "t2", userId: "u1", kind: "RESET_PASSWORD", usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    const res = await call("POST", "/auth/reset-password", { token: "a-long-enough-token-value", password: "a brand new password" });
    expect(res.statusCode).toBe(200);
    expect(db.user.update.mock.calls[0]![0].data.passwordHash).not.toContain("brand");
  });

  it("keeps /auth/me closed without a session", async () => {
    expect((await call("GET", "/auth/me")).statusCode).toBe(401);
  });
});
