import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { idParam } from "../schemas.js";

export const MAX_POSTS_PER_BUSINESS = 20;

const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v));

/** The business's news: special offers and announcements shown on its page. */
export async function postRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };

  r.get("/businesses/:id/posts", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    return prisma.post.findMany({ where: { businessId: b.id }, orderBy: { createdAt: "desc" } });
  });

  r.post("/businesses/:id/posts", {
    ...auth,
    schema: { params: idParam, body: z.object({ title: z.string().trim().min(1).max(80), body: text(500).optional(), endsAt: z.coerce.date().nullable().optional() }) },
  }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    if ((await prisma.post.count({ where: { businessId: b.id } })) >= MAX_POSTS_PER_BUSINESS) return reply.code(422).send({ error: "post_limit_reached" });
    return reply.code(201).send(await prisma.post.create({ data: { businessId: b.id, title: req.body.title, body: req.body.body ?? null, endsAt: req.body.endsAt ?? null } }));
  });

  r.delete("/posts/:id", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    await prisma.post.deleteMany({ where: { id: req.params.id, business: { ownerId: req.user.sub } } });
    return reply.code(204).send();
  });
}
