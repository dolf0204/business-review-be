-- CreateEnum
CREATE TYPE "LoyaltyMethod" AS ENUM ('LOCATION', 'STAFF_CODE');

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "goal" INTEGER NOT NULL DEFAULT 10,
    "rewardText" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCard" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "goal" INTEGER NOT NULL,
    "rewardText" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyPunch" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "method" "LoyaltyMethod" NOT NULL,
    "distanceMeters" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPunch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_businessId_key" ON "LoyaltyProgram"("businessId");

-- CreateIndex
CREATE INDEX "LoyaltyCard_membershipId_createdAt_idx" ON "LoyaltyCard"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyPunch_cardId_idx" ON "LoyaltyPunch"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyPunch_membershipId_day_key" ON "LoyaltyPunch"("membershipId", "day");

-- AddForeignKey
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPunch" ADD CONSTRAINT "LoyaltyPunch_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPunch" ADD CONSTRAINT "LoyaltyPunch_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

