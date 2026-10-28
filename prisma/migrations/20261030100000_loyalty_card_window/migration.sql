-- AlterTable
ALTER TABLE "LoyaltyProgram" ADD COLUMN "cardValidDays" INTEGER;

-- AlterTable
ALTER TABLE "LoyaltyCard" ADD COLUMN "expiresAt" TIMESTAMP(3);