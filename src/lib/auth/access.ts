import { prisma } from "../db.js";

/** The business, but only when it belongs to this user. Anything else is "not found", so ids cannot be probed. */
export function ownedBusiness(userId: string, id: string) {
  return prisma.business.findFirst({ where: { id, ownerId: userId } });
}
