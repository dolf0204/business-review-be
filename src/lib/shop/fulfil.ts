import QRCode from "qrcode";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { shareUrl } from "../business/code.js";
import { sendMail } from "../mail/mail.js";
import { shopKey, shopOperatorMail } from "./order.js";
import { shopOwnerReceivedMail } from "./shopMail.js";

export const SHOP_ORDER_METADATA = "shopOrderId";

export interface ShopLog {
  info: (o: object, m: string) => void;
  error: (o: object, m: string) => void;
}

export async function fulfilShopOrder(orderId: string, log: ShopLog, paidCents?: number): Promise<boolean> {
  const order = await prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: { items: true, business: { include: { owner: { select: { email: true } } } } },
  });
  if (!order || order.status !== "PENDING_PAYMENT") return false;
  if (paidCents !== undefined && paidCents !== order.totalCents) {
    log.error({ orderId, paidCents, expected: order.totalCents }, "shop order paid amount does not match the order");
    return false;
  }
  const claimed = await prisma.shopOrder.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "PAID", paidAt: new Date() } });
  if (claimed.count === 0) return false;

  const b = order.business;
  const ownerEmail = b.owner.email;
  try {
    const qrUrl = shareUrl(config.APP_URL, b.code, "qr");
    const nfcUrl = shareUrl(config.APP_URL, b.code, "nfc");
    const opts = { errorCorrectionLevel: "M" as const, margin: 2 };
    const png = await QRCode.toBuffer(qrUrl, { ...opts, width: 2000 });
    const mail = shopOperatorMail({
      orderId: order.id,
      business: b.name,
      ownerEmail,
      items: order.items.map((i) => ({ design: i.design, finish: i.finish, size: i.size, printText: i.printText, unitCents: i.unitCents, free: i.unitCents === 0 })),
      totalCents: order.totalCents,
      paidOnline: order.totalCents > 0,
      name: order.name,
      line1: order.line1,
      line2: order.line2,
      postalCode: order.postalCode,
      city: order.city,
      country: order.country,
      phone: order.phone,
      qrUrl,
      nfcUrl,
      link: `${config.APP_URL}/operator/shop?o=${order.id}&key=${shopKey(order.id, config.JWT_SECRET)}`,
    });
    await sendMail({ to: config.KIT_ORDER_EMAIL, ...mail, attachments: [{ name: `qr-${b.code}.png`, content: png }] }, log);
  } catch (err) {
    log.error({ err: (err as Error).message, orderId }, "shop order email to the maker could not be sent");
  }

  try {
    const mail = shopOwnerReceivedMail({
      appUrl: config.APP_URL,
      orderId: order.id,
      businessId: b.id,
      business: b.name,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({ design: i.design, finish: i.finish, size: i.size, printText: i.printText, listCents: i.listCents, unitCents: i.unitCents })),
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      totalCents: order.totalCents,
      paidOnline: order.totalCents > 0,
      name: order.name,
      line1: order.line1,
      line2: order.line2,
      postalCode: order.postalCode,
      city: order.city,
      country: order.country,
      phone: order.phone,
    });
    await sendMail({ to: ownerEmail, ...mail, ...(config.KIT_ORDER_EMAIL ? { replyTo: config.KIT_ORDER_EMAIL } : {}) }, log);
  } catch (err) {
    log.error({ err: (err as Error).message, orderId }, "shop order email to the customer could not be sent");
  }
  return true;
}

export async function cancelShopOrder(orderId: string): Promise<void> {
  await prisma.shopOrder.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "CANCELED", freePeriodEnd: null } });
}