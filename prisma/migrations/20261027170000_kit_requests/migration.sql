-- CreateEnum
CREATE TYPE "KitStatus" AS ENUM ('REQUESTED', 'SHIPPED', 'CANCELED');

-- CreateTable
CREATE TABLE "KitRequest" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "status" "KitStatus" NOT NULL DEFAULT 'REQUESTED',
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "printText" TEXT NOT NULL,
    "trackingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shippedAt" TIMESTAMP(3),

    CONSTRAINT "KitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KitRequest_businessId_createdAt_idx" ON "KitRequest"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "KitRequest" ADD CONSTRAINT "KitRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

