import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/lib/sessionCookie.js";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn() },
  post: { findMany: vi.fn(), create: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));

import { buildApp } from "../src/app.js";

const ID = "11111111-1111-4111-8111-111111111111";

async function call(method: "GET" | "POST" | "DELETE", url: string, payload?: object) {
  const app = await buildApp();
  const res = await app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE}=${app.jwt.sign({ sub: "u1" })}` } });
  await app.close();
  return res;
}

describe("business news", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue({ id: ID, ownerId: "u1" });
    db.post.count.mockResolvedValue(0);
    db.post.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "p1", ...data }));
  });

  it("adds a post with a title, optional text and an end date", async () => {
    const res = await call("POST", `/businesses/${ID}/posts`, { title: " Happy hour ", body: "  ", endsAt: "2026-12-31" });
    expect(res.statusCode).toBe(201);
    const data = db.post.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ businessId: ID, title: "Happy hour", body: null });
    expect(data.endsAt).toBeInstanceOf(Date);
  });

  it("limits the number of posts and the length of a title", async () => {
    db.post.count.mockResolvedValue(20);
    expect((await call("POST", `/businesses/${ID}/posts`, { title: "One more" })).json().error).toBe("post_limit_reached");
    expect((await call("POST", `/businesses/${ID}/posts`, { title: "x".repeat(81) })).statusCode).toBe(400);
    expect((await call("POST", `/businesses/${ID}/posts`, { title: "" })).statusCode).toBe(400);
  });

  it("keeps other owners out", async () => {
    db.business.findFirst.mockResolvedValue(null);
    expect((await call("GET", `/businesses/${ID}/posts`)).statusCode).toBe(404);
    expect((await call("POST", `/businesses/${ID}/posts`, { title: "Hi" })).statusCode).toBe(404);
    await call("DELETE", `/posts/${ID}`);
    expect(db.post.deleteMany.mock.calls[0]![0].where).toEqual({ id: ID, business: { ownerId: "u1" } });
  });
});
