import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ImageError, MAX_UPLOAD_BYTES, processImage } from "../lib/image.js";

export const STORAGE_LIMIT_BYTES = 30 * 1024 * 1024;
const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const dir = () => resolve(config.UPLOAD_DIR);

const usedBy = async (userId: string) => (await prisma.upload.aggregate({ where: { ownerId: userId }, _sum: { bytes: true } }))._sum.bytes ?? 0;

/** Removes an image the owner no longer uses (replaced or removed). Never touches someone else's. */
export async function releaseUpload(ownerId: string, filename: string | null) {
  if (!filename) return;
  const { count } = await prisma.upload.deleteMany({ where: { ownerId, filename } });
  if (count) await unlink(join(dir(), filename)).catch(() => undefined);
}

export async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
  const auth = { onRequest: [app.authenticate] };

  app.get("/uploads/usage", auth, async (req) => ({ used: await usedBy(req.user.sub), limit: STORAGE_LIMIT_BYTES }));

  app.post("/uploads", { ...auth, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    let raw: Buffer;
    try {
      raw = await file.toBuffer();
    } catch {
      return reply.code(413).send({ error: "file_too_large" });
    }
    if (file.file.truncated) return reply.code(413).send({ error: "file_too_large" });

    let image;
    try {
      image = await processImage(raw);
    } catch (e) {
      if (e instanceof ImageError) return reply.code(e.code === "image_too_large" ? 413 : 415).send({ error: e.code });
      throw e;
    }

    const used = await usedBy(req.user.sub);
    if (used + image.data.length > STORAGE_LIMIT_BYTES) return reply.code(402).send({ error: "storage_quota_exceeded", used, limit: STORAGE_LIMIT_BYTES });

    // The name is random and ours, never derived from what the client sent.
    const filename = `${randomUUID()}.webp`;
    await mkdir(dir(), { recursive: true });
    await writeFile(join(dir(), filename), image.data);
    try {
      const row = await prisma.upload.create({ data: { ownerId: req.user.sub, filename, bytes: image.data.length, width: image.width, height: image.height } });
      return reply.code(201).send({ id: row.id, url: `/media/${filename}`, width: image.width, height: image.height, bytes: row.bytes });
    } catch (e) {
      await unlink(join(dir(), filename)).catch(() => undefined);
      throw e;
    }
  });

  // Public: guests load these images from other origins, so the default same-origin resource policy is relaxed here only.
  app.get<{ Params: { file: string } }>("/media/:file", { config: { rateLimit: false } }, async (req, reply) => {
    if (!FILE_NAME.test(req.params.file)) return reply.code(404).send({ error: "not_found" });
    const path = join(dir(), req.params.file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("content-type", "image/webp")
      .header("content-length", info.size)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("x-content-type-options", "nosniff")
      .send(createReadStream(path));
  });
}
