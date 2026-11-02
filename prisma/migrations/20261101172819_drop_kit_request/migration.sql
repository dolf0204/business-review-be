/*
  Warnings:

  - You are about to drop the `KitRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "KitRequest" DROP CONSTRAINT "KitRequest_businessId_fkey";

-- DropTable
DROP TABLE "KitRequest";

-- DropEnum
DROP TYPE "KitStatus";
