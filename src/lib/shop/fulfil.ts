import QRCode from "qrcode";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { shareUrl } from "./code.js";
import { sendMail } from "./mail.js";
import { shopKey, shopOperatorMail, shopOwnerReceivedMail } from "./shop.js";

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
    const [png, svg] = await Promise.all([QRCode.toBuffer(qrUrl, { ...opts, width: 2000 }), QRCode.toString(qrUrl, { ...opts, type: "svg", width: 1000 })]);
    const mail = shopOperatorMail({
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
    await sendMail({ to: config.KIT_ORDER_EMAIL, ...mail, attachments: [{ name: `qr-${b.code}.png`, content: png }, { name: `qr-${b.code}.svg`, content: Buffer.from(svg) }] }, log);
    await sendMail({ to: ownerEmail, ...shopOwnerReceivedMail(b.name, order.items.length, order.totalCents) }, log);
  } catch (err) {
    log.error({ err: (err as Error).message, orderId }, "shop order email could not be sent");
  }
  return true;
}

export async function cancelShopOrder(orderId: string): Promise<void> {
  await prisma.shopOrder.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "CANCELED", freePeriodEnd: null } });
}