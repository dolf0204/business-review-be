-- AlterTable
ALTER TABLE "Business" ADD COLUMN "slug" TEXT,
ADD COLUMN "slugLockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");