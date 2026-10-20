-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminAccess" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "AdminInvite" ADD COLUMN     "adminAccess" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Admins from before permissions existed keep everything they had.
UPDATE "User" SET "adminAccess" = ARRAY['dashboard','orders','products','customers','social','messages'] WHERE "role" = 'ADMIN';
