-- CreateEnum
CREATE TYPE "SecurityCodePurpose" AS ENUM ('PASSWORD_RESET', 'TWO_FACTOR_EMAIL');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorMethod" TEXT,
ADD COLUMN     "twoFactorEmailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserSecurityCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "SecurityCodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSecurityCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSecurityCode_userId_purpose_idx" ON "UserSecurityCode"("userId", "purpose");
CREATE INDEX "UserSecurityCode_expiresAt_idx" ON "UserSecurityCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserSecurityCode" ADD CONSTRAINT "UserSecurityCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
