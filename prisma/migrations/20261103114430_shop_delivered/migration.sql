-- AlterEnum
ALTER TYPE "ShopOrderStatus" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "ShopOrder" ADD COLUMN     "deliveredAt" TIMESTAMP(3);
