-- CreateEnum
CREATE TYPE "LoyaltyCarryOver" AS ENUM ('RESET', 'TRANSFER');

-- DropIndex
DROP INDEX "LoyaltyProgram_businessId_key";

-- AlterTable
ALTER TABLE "LoyaltyProgram" ADD COLUMN "carryOver" "LoyaltyCarryOver" NOT NULL DEFAULT 'RESET';

-- AlterTable
ALTER TABLE "LoyaltyCard" ADD COLUMN "programId" UUID;

-- Existing cards belong to the one program their business had
UPDATE "LoyaltyCard" AS c
SET "programId" = p."id"
FROM "Membership" AS m
JOIN "LoyaltyProgram" AS p ON p."businessId" = m."businessId"
WHERE c."membershipId" = m."id";

-- CreateIndex
CREATE INDEX "LoyaltyProgram_businessId_startsAt_idx" ON "LoyaltyProgram"("businessId", "startsAt");

-- CreateIndex
CREATE INDEX "LoyaltyCard_programId_idx" ON "LoyaltyCard"("programId");

-- AddForeignKey
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;