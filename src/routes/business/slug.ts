import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../db.js";
import { ownedBusiness } from "../../lib/auth/access.js";
import { businessView } from "../../lib/business/businessView.js";
import { isReservedSlug, isValidSlug, slugify } from "../../lib/slug/slug.js";
import { SLUG_RESULT, claimSlug, freeSlugsFor, takenSlugs } from "../../lib/slug/slugs.js";
import { lockSlug } from "../../lib/slug/slugLock.js";
import { idParam } from "../../schemas.js";

const TYPED_SLUG_MAX = 80;
const DEFAULT_LANG = "en";
const CHECK_LIMIT = { max: 60, timeWindow: "1 minute" };

export const SLUG_STATUS = { ok: "ok", invalid: "invalid", reserved: "reserved", taken: "taken" } as const;
type SlugStatus = (typeof SLUG_STATUS)[keyof typeof SLUG_STATUS];

const SLUG_ERROR = {
  invalid: "slug_invalid",
  reserved: "slug_reserved",
  taken: "slug_taken",
  locked: "slug_locked",
} as const;

type SlugBusiness = NonNullable<Awaited<ReturnType<typeof ownedBusiness>>>;

export async function ownerLang(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiLang: true } });
  return user?.uiLang ?? DEFAULT_LANG;
}

async function statusOf(business: SlugBusiness, slug: string): Promise<SlugStatus> {
  if (isReservedSlug(slug)) return SLUG_STATUS.reserved;
  if (!isValidSlug(slug)) return SLUG_STATUS.invalid;
  return (await takenSlugs([slug], business.id)).has(slug) ? SLUG_STATUS.taken : SLUG_STATUS.ok;
}

async function suggestionsFor(business: SlugBusiness, lang: string): Promise<string[]> {
  return freeSlugsFor(business.id, { name: business.name, kind: business.kind, address: business.address, lang });
}

export async function slugRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };

  r.get("/businesses/:id/slug", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const locked = b.slugLockedAt !== null;
    return { slug: b.slug, locked, suggestions: locked ? [] : await suggestionsFor(b, await ownerLang(req.user.sub)) };
  });

  r.get("/businesses/:id/slug/check", {
    ...auth,
    schema: { params: idParam, querystring: z.object({ slug: z.string().trim().max(TYPED_SLUG_MAX) }) },
    config: { rateLimit: CHECK_LIMIT },
  }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    if (b.slugLockedAt) return reply.code(409).send({ error: SLUG_ERROR.locked });
    const slug = slugify(req.query.slug);
    const status = await statusOf(b, slug);
    return { slug, status, suggestions: status === SLUG_STATUS.ok ? [] : await suggestionsFor(b, await ownerLang(req.user.sub)) };
  });

  r.put("/businesses/:id/slug", {
    ...auth,
    schema: { params: idParam, body: z.object({ slug: z.string().trim().min(1).max(TYPED_SLUG_MAX) }) },
  }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    if (b.slugLockedAt) return reply.code(409).send({ error: SLUG_ERROR.locked });
    const slug = slugify(req.body.slug);
    const status = await statusOf(b, slug);
    const refuse = async (code: 409 | 422, error: string) => reply.code(code).send({ error, suggestions: await suggestionsFor(b, await ownerLang(req.user.sub)) });
    if (status === SLUG_STATUS.invalid) return refuse(422, SLUG_ERROR.invalid);
    if (status === SLUG_STATUS.reserved) return refuse(422, SLUG_ERROR.reserved);
    if (status === SLUG_STATUS.taken) return refuse(409, SLUG_ERROR.taken);
    const result = await claimSlug(b.id, slug);
    if (result === SLUG_RESULT.locked) return reply.code(409).send({ error: SLUG_ERROR.locked });
    if (result === SLUG_RESULT.taken) return refuse(409, SLUG_ERROR.taken);
    if (b.publishedAt) await lockSlug(b.id);
    const updated = await ownedBusiness(req.user.sub, b.id);
    return updated ? businessView(updated) : reply.code(404).send({ error: "not_found" });
  });
}