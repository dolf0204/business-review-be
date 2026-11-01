import type { FastifyReply, FastifyRequest } from "fastify";
import Stripe from "stripe";

// A Stripe outage or a wrong id must reach the owner as one generic error, never as Stripe's own message.
export async function stripeGuard<T>(req: FastifyRequest, reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError) {
      req.log.error({ type: e.type, code: e.code, message: e.message }, "stripe request failed");
      return reply.code(502).send({ error: "billing_error" });
    }
    throw e;
  }
}
