-- CreateEnum
CREATE TYPE "ReviewPlatform" AS ENUM ('GOOGLE', 'TRIPADVISOR');

-- CreateEnum
CREATE TYPE "ReviewPromptStatus" AS ENUM ('DONE', 'DECLINED');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "lastVisitAt" TIMESTAMP(3),
ADD COLUMN     "visits" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReviewPrompt" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "platform" "ReviewPlatform" NOT NULL,
    "status" "ReviewPromptStatus" NOT NULL,
    "declinedAtVisit" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewPrompt_membershipId_platform_key" ON "ReviewPrompt"("membershipId", "platform");

-- AddForeignKey
ALTER TABLE "ReviewPrompt" ADD CONSTRAINT "ReviewPrompt_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

