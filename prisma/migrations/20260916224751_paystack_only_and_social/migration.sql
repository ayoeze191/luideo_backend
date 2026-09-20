-- CreateEnum
CREATE TYPE "SocialTarget" AS ENUM ('IG_FEED', 'IG_STORY', 'FB_FEED', 'FB_STORY');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('SCHEDULED', 'PUBLISHING', 'POSTED', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentProvider_new" AS ENUM ('PAYSTACK', 'COD');
ALTER TABLE "Order" ALTER COLUMN "paymentProvider" TYPE "PaymentProvider_new" USING ("paymentProvider"::text::"PaymentProvider_new");
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
ALTER TYPE "PaymentProvider_new" RENAME TO "PaymentProvider";
DROP TYPE "public"."PaymentProvider_old";
COMMIT;

-- CreateTable
CREATE TABLE "SocialConnection" (
    "id" TEXT NOT NULL,
    "userTokenEnc" TEXT,
    "userTokenExpiresAt" TIMESTAMP(3),
    "pageId" TEXT,
    "pageName" TEXT,
    "pageTokenEnc" TEXT,
    "igUserId" TEXT,
    "igUsername" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "target" "SocialTarget" NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL,
    "link" TEXT,
    "status" "SocialPostStatus" NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledAt_idx" ON "SocialPost"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
