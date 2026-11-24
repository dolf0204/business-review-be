-- AlterTable
ALTER TABLE "LoyaltyProgram" ADD COLUMN "standing" BOOLEAN NOT NULL DEFAULT false;

-- DropIndex
DROP INDEX "LoyaltyPunch_membershipId_day_key";

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyPunch_cardId_day_key" ON "LoyaltyPunch"("cardId", "day");

-- CreateIndex
CREATE INDEX "LoyaltyPunch_membershipId_day_idx" ON "LoyaltyPunch"("membershipId", "day");