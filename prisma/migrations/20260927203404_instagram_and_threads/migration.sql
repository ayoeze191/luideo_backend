/*
  Warnings:

  - You are about to drop the column `igUserId` on the `SocialConnection` table. All the data in the column will be lost.
  - You are about to drop the column `igUsername` on the `SocialConnection` table. All the data in the column will be lost.
  - You are about to drop the column `pageId` on the `SocialConnection` table. All the data in the column will be lost.
  - You are about to drop the column `pageName` on the `SocialConnection` table. All the data in the column will be lost.
  - You are about to drop the column `pageTokenEnc` on the `SocialConnection` table. All the data in the column will be lost.
  - You are about to drop the column `userTokenEnc` on the `SocialConnection` table. All the data in the column will be lost.
  - You are about to drop the column `userTokenExpiresAt` on the `SocialConnection` table. All the data in the column will be lost.
  - Added the required column `accountId` to the `SocialConnection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tokenEnc` to the `SocialConnection` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "SocialTarget" ADD VALUE 'THREADS';

-- The old Facebook Page connection can't carry over: Instagram and Threads connect afresh.
DELETE FROM "SocialConnection";

-- AlterTable
ALTER TABLE "SocialConnection" DROP COLUMN "igUserId",
DROP COLUMN "igUsername",
DROP COLUMN "pageId",
DROP COLUMN "pageName",
DROP COLUMN "pageTokenEnc",
DROP COLUMN "userTokenEnc",
DROP COLUMN "userTokenExpiresAt",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "tokenEnc" TEXT NOT NULL,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "username" TEXT;
