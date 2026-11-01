-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "clearedAt" TIMESTAMP(3);

UPDATE "Coupon" SET "clearedAt" = "createdAt";