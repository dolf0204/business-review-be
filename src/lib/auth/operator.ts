import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { operatorList } from "../links/operator.js";

export const isOperatorEmail = (email: string) => operatorList(config.OPERATOR_EMAILS).includes(email.trim().toLowerCase());

export async function requireOperator(req: FastifyRequest, reply: FastifyReply) {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { email: true } });
  if (!user || !isOperatorEmail(user.email)) return reply.code(403).send({ error: "forbidden" });
}