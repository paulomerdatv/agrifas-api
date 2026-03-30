-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "steamId" TEXT,
ADD COLUMN     "steamAvatar" TEXT,
ADD COLUMN     "provider" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_steamId_key" ON "User"("steamId");
