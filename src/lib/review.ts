import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { Business } from "../generated/prisma/client.js";
import { sendMail } from "./mail.js";
import { operatorList, reviewKey, reviewMail } from "./operator.js";

/** Tell the operators that a business needs to be looked at. A mail problem is logged, never shown to the owner. */
export async function requestApproval(b: Pick<Business, "id" | "name" | "offerText" | "address" | "googleMapsUrl" | "ownerId">, changed: boolean, log: Pick<FastifyBaseLogger, "info" | "error">) {
  const to = operatorList(config.OPERATOR_EMAILS);
  if (!to.length) return;
  const owner = await prisma.user.findUnique({ where: { id: b.ownerId }, select: { email: true } });
  const link = `${config.APP_URL}/operator/review?b=${b.id}&k=${reviewKey(b.id, config.JWT_SECRET)}`;
  const mail = reviewMail({ name: b.name, offerText: b.offerText, address: b.address, googleMapsUrl: b.googleMapsUrl, ownerEmail: owner?.email ?? "(unknown)", link, changed });
  for (const address of to) {
    try {
      await sendMail({ to: address, ...mail }, log);
    } catch (err) {
      log.error({ err: (err as Error).message, toDomain: address.split("@")[1] }, "operator email could not be sent");
    }
  }
}

/** Fields that change what TouristAsk guests read about a business. Changing them after approval needs a new check. */
export const REVIEWED_FIELDS = ["name", "offerText", "subtitle"] as const;
