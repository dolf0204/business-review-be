import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ownedBusiness } from "../lib/access.js";
import { businessView, MAX_BUSINESSES_PER_OWNER, publishProblem } from "../lib/businessView.js";
import { newCode, shareUrl } from "../lib/code.js";
import { findPlaces, placeDetails, PlacesError } from "../lib/googlePlaces.js";
import { idParam, KINDS, profileSchema } from "../schemas.js";

const placesStatus = (e: PlacesError) => (e.code === "google_unavailable" ? 503 : e.code === "place_not_found" ? 404 : 422);

export async function businessRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };

  r.get("/businesses", auth, async (req) => {
    const rows = await prisma.business.findMany({ where: { ownerId: req.user.sub }, orderBy: { createdAt: "asc" } });
    return rows.map(businessView);
  });

  r.post("/businesses", { ...auth, schema: { body: z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(KINDS).default("restaurant") }) } }, async (req, reply) => {
    if ((await prisma.business.count({ where: { ownerId: req.user.sub } })) >= MAX_BUSINESSES_PER_OWNER) return reply.code(403).send({ error: "business_limit_reached" });
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await prisma.business.create({ data: { ownerId: req.user.sub, code: newCode(), name: req.body.name, kind: req.body.kind } });
        return reply.code(201).send(businessView(created));
      } catch (err) {
        // A clash on the short code is rare; try another code. Anything else is a real error.
        if ((err as { code?: string }).code !== "P2002") throw err;
      }
    }
    return reply.code(500).send({ error: "internal_error" });
  });

  r.get("/businesses/:id", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    return businessView(b);
  });

  r.patch("/businesses/:id", { ...auth, schema: { params: idParam, body: profileSchema } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const { template, primary, accent, ...fields } = req.body;
    const theme = { ...(b.theme as Record<string, unknown>), ...(template ? { template } : {}), ...(primary ? { primary } : {}), ...(accent ? { accent } : {}) };
    const updated = await prisma.business.update({ where: { id: b.id }, data: { ...fields, theme } });
    return businessView(updated);
  });

  r.delete("/businesses/:id", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    await prisma.business.deleteMany({ where: { id: req.params.id, ownerId: req.user.sub } });
    return reply.code(204).send();
  });

  r.post("/businesses/:id/publish", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const problem = publishProblem(b);
    if (problem) return reply.code(422).send({ error: problem });
    return businessView(await prisma.business.update({ where: { id: b.id }, data: { publishedAt: b.publishedAt ?? new Date() } }));
  });

  r.post("/businesses/:id/unpublish", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    return businessView(await prisma.business.update({ where: { id: b.id }, data: { publishedAt: null } }));
  });

  // The address in the QR code and on the NFC tag. It never changes, so a printed code survives every later edit.
  r.get("/businesses/:id/share", { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    return { qrUrl: shareUrl(config.APP_URL, b.code, "qr"), nfcUrl: shareUrl(config.APP_URL, b.code, "nfc") };
  });

  r.get("/businesses/:id/qr", {
    ...auth,
    schema: { params: idParam, querystring: z.object({ format: z.enum(["svg", "png"]).default("svg"), size: z.coerce.number().int().min(200).max(2000).default(1000) }) },
  }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    const url = shareUrl(config.APP_URL, b.code, "qr");
    const opts = { errorCorrectionLevel: "M" as const, margin: 2, width: req.query.size };
    if (req.query.format === "png") return reply.type("image/png").send(await QRCode.toBuffer(url, opts));
    return reply.type("image/svg+xml").send(await QRCode.toString(url, { ...opts, type: "svg" }));
  });

  // Step 1 of connecting to Google: find the place from a pasted Google Maps link, or from a typed name and town.
  r.post("/google/lookup", {
    ...auth,
    schema: { body: z.object({ url: z.string().trim().max(500).optional(), query: z.string().trim().min(2).max(200).optional() }).refine((b) => b.url || b.query) },
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    try {
      return { candidates: await findPlaces(req.body) };
    } catch (err) {
      if (err instanceof PlacesError) return reply.code(placesStatus(err)).send({ error: err.code });
      throw err;
    }
  });

  // Step 2: the owner picked their place. The details are read from Google again here, never taken from the browser.
  r.put("/businesses/:id/google", {
    ...auth,
    schema: { params: idParam, body: z.object({ placeId: z.string().min(10).max(200) }) },
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const b = await ownedBusiness(req.user.sub, req.params.id);
    if (!b) return reply.code(404).send({ error: "not_found" });
    try {
      const p = await placeDetails(req.body.placeId);
      const updated = await prisma.business.update({
        where: { id: b.id },
        data: {
          googlePlaceId: p.placeId,
          googleMapsUrl: p.mapsUrl,
          googleReviewUrl: p.reviewUrl,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          rating: p.rating,
          ratingCount: p.ratingCount,
          // Contact details are only filled in when the owner has not written their own.
          websiteUrl: b.websiteUrl ?? p.websiteUrl,
          phone: b.phone ?? p.phone,
        },
      });
      return businessView(updated);
    } catch (err) {
      if (err instanceof PlacesError) return reply.code(placesStatus(err)).send({ error: err.code });
      throw err;
    }
  });
}
