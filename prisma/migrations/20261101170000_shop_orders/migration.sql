-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'SHIPPED', 'CANCELED');

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "freePeriodEnd" TIMESTAMP(3),
    "subtotalCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "stripeSessionId" TEXT,
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "trackingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "design" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "printText" TEXT NOT NULL,
    "listCents" INTEGER NOT NULL,
    "unitCents" INTEGER NOT NULL,

    CONSTRAINT "ShopOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_stripeSessionId_key" ON "ShopOrder"("stripeSessionId");

-- CreateIndex
CREATE INDEX "ShopOrder_businessId_createdAt_idx" ON "ShopOrder"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_businessId_freePeriodEnd_key" ON "ShopOrder"("businessId", "freePeriodEnd");

-- CreateIndex
CREATE INDEX "ShopOrderItem_orderId_idx" ON "ShopOrderItem"("orderId");

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;