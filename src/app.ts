import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { businessRoutes } from "./routes/businesses.js";
import { guestRoutes } from "./routes/guests.js";
import { reviewRoutes } from "./routes/reviews.js";
import { postRoutes } from "./routes/posts.js";
import { healthRoutes } from "./routes/health.js";
import { publicRoutes } from "./routes/public.js";
import { partnerRoutes } from "./routes/partners.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}
declare module "@fastify/jwt" {
  interface FastifyJWT {
    // kind is "guest" only for a guest's session, which must never open the owner's screens.
    payload: { sub: string; kind?: "guest" };
    user: { sub: string; kind?: "guest" };
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.NODE_ENV === "test" ? "silent" : "info", redact: ["req.headers.cookie", "req.headers.authorization", "req.headers.x-api-key"] },
    trustProxy: true,
  });
  // Treat an empty JSON body as "no body" instead of a 400, so body-less POST and DELETE calls work.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });
  // Client errors keep their normal response. Anything else is logged and answered generically.
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return reply.send(err);
    req.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "internal_error" });
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, {
    origin: [config.APP_URL],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  await app.register(jwt, { secret: config.JWT_SECRET, cookie: { cookieName: "session", signed: false } });

  app.decorate("authenticate", async (req, reply) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
      if (req.user.kind === "guest") throw new Error("guest token");
    } catch {
      reply.code(401).send({ error: "unauthenticated" });
    }
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(businessRoutes);
  await app.register(postRoutes);
  await app.register(guestRoutes);
  await app.register(reviewRoutes);
  await app.register(partnerRoutes);
  await app.register(publicRoutes);
  return app;
}
