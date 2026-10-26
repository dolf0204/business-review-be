import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => ({ path: "" }));
const db = vi.hoisted(() => ({
  upload: { aggregate: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  business: { findFirst: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));
vi.mock("../src/config.js", async (orig) => {
  const mod = (await orig()) as { config: Record<string, unknown> };
  dir.path = mkdtempSync(join(tmpdir(), "brev-up-"));
  return { config: { ...mod.config, UPLOAD_DIR: dir.path } };
});

import { buildApp } from "../src/app.js";
import { expandMedia, mediaFilename, toStoredImageUrl } from "../src/lib/media.js";

afterAll(() => rmSync(dir.path, { recursive: true, force: true }));

const png = (w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: "#0f766e" } }).png().toBuffer();
function multipart(filename: string, type: string, data: Buffer) {
  const boundary = "----brevtest";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}
async function upload(filename: string, type: string, data: Buffer, signedIn = true) {
  const app = await buildApp();
  const m = multipart(filename, type, data);
  const res = await app.inject({ method: "POST", url: "/uploads", payload: m.payload, headers: { "content-type": m.contentType, ...(signedIn ? { cookie: `session=${app.jwt.sign({ sub: "u1" })}` } : {}) } });
  await app.close();
  return res;
}

describe("image addresses", () => {
  const id = "0f8fad5b-d9cb-469f-a165-0e0b6f2a1c3d";
  it("drops the address from our own images and puts the current one back when sending", () => {
    expect(toStoredImageUrl(`http://localhost:8090/media/${id}.webp`)).toBe(`/media/${id}.webp`);
    expect(toStoredImageUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
    expect(JSON.parse(expandMedia(JSON.stringify({ a: `/media/${id}.webp`, b: `http://old:1/media/${id}.webp` }), "https://api.businessask.eu/"))).toEqual({
      a: `https://api.businessask.eu/media/${id}.webp`,
      b: `https://api.businessask.eu/media/${id}.webp`,
    });
    expect(mediaFilename(`http://x/media/${id}.webp`)).toBe(`${id}.webp`);
    expect(mediaFilename("https://example.com/a.jpg")).toBeNull();
  });
});

describe("uploading a picture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.upload.aggregate.mockResolvedValue({ _sum: { bytes: 0 } });
    db.upload.create.mockImplementation(async ({ data }: { data: { bytes: number } }) => ({ id: "up1", bytes: data.bytes }));
  });

  it("stores a re-encoded WebP under a name of our own and answers with its address", async () => {
    const res = await upload("my photo.png", "image/png", await png(3000, 2000));
    expect(res.statusCode).toBe(201);
    const { url, width } = res.json();
    // Every answer carries the API address that is configured now; it is dropped again when the address is saved.
    expect(url).toMatch(/^http:\/\/localhost:8090\/media\/[0-9a-f-]{36}\.webp$/);
    expect(width).toBeLessThanOrEqual(1600);
    const files = readdirSync(dir.path);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("photo");
    expect((await sharp(join(dir.path, files[0]!)).metadata()).format).toBe("webp");
  });

  it("refuses things that are not pictures, a missing session, and a full storage", async () => {
    expect((await upload("x.png", "image/png", Buffer.from("<svg onload=alert(1)/>"))).statusCode).toBe(415);
    expect((await upload("x.png", "image/png", await png(), false)).statusCode).toBe(401);
    db.upload.aggregate.mockResolvedValue({ _sum: { bytes: 30 * 1024 * 1024 } });
    const full = await upload("x.png", "image/png", await png());
    expect(full.statusCode).toBe(402);
    expect(full.json().error).toBe("storage_quota_exceeded");
  });

  it("serves a stored picture to anyone, and nothing outside our own names", async () => {
    const res = await upload("x.png", "image/png", await png());
    const name = String(res.json().url).split("/").pop();
    const app = await buildApp();
    const ok = await app.inject({ url: `/media/${name}` });
    const bad = await app.inject({ url: "/media/..%2F..%2Fetc%2Fpasswd" });
    const odd = await app.inject({ url: "/media/evil.webp" });
    await app.close();
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/webp");
    expect(ok.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(bad.statusCode).toBe(404);
    expect(odd.statusCode).toBe(404);
  });
});

describe("replacing a logo", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const OLD = "aaaaaaaa-1111-4111-8111-111111111111.webp";
  const NEW = "bbbbbbbb-1111-4111-8111-111111111111.webp";
  it("saves the new picture without a host, and deletes the old file and its record", async () => {
    await upload("x.png", "image/png", await png());
    const old = join(dir.path, OLD);
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).webp().toFile(old);
    db.business.findFirst.mockResolvedValue({ id: ID, ownerId: "u1", name: "K", theme: {}, logoUrl: `/media/${OLD}`, backgroundUrl: null, approvedAt: null, publishedAt: null });
    db.business.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID, name: "K", theme: {}, logoUrl: `/media/${OLD}`, ...data }));
    db.upload.deleteMany.mockResolvedValue({ count: 1 });
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/businesses/${ID}`, payload: { logoUrl: `http://localhost:8090/media/${NEW}` }, headers: { cookie: `session=${app.jwt.sign({ sub: "u1" })}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(db.business.update.mock.calls[0]![0].data.logoUrl).toBe(`/media/${NEW}`);
    expect(db.upload.deleteMany.mock.calls[0]![0].where).toEqual({ ownerId: "u1", filename: OLD });
    expect(existsSync(old)).toBe(false);
  });
});
