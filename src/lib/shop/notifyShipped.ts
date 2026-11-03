import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { sendMail } from "../mail/mail.js";
import type { ShopLog } from "./fulfil.js";
import { shopShippedMail } from "./shopMail.js";

export interface ShippedOrder {
  id: string;
  business: { id: string; name: string; ownerId: string };
}

export async function notifyShipped(order: ShippedOrder, trackingUrl: string | null, log: ShopLog) {
  const owner = await prisma.user.findUnique({ where: { id: order.business.ownerId }, select: { email: true } });
  if (!owner) return;
  const mail = shopShippedMail({ appUrl: config.APP_URL, orderId: order.id, businessId: order.business.id, business: order.business.name, trackingUrl });
  try {
    await sendMail({ to: owner.email, ...mail }, log);
  } catch (err) {
    log.error({ err: (err as Error).message }, "shop shipped email could not be sent");
  }
}