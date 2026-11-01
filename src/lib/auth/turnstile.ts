import { config } from "../config.js";

/**
 * Checks a Cloudflare Turnstile token. With no secret configured it only passes outside production,
 * so a forgotten secret can never leave the live review form open to bots.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!config.TURNSTILE_SECRET) return config.NODE_ENV !== "production";
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: config.TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok && ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false; // if Cloudflare cannot be reached, fail closed
  }
}
