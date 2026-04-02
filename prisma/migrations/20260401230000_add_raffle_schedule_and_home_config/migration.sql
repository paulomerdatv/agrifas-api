-- AlterTable
ALTER TABLE "Raffle"
ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "endAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HomeConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "heroTitle" TEXT NOT NULL,
    "heroSubtitle" TEXT NOT NULL,
    "heroButtonText" TEXT NOT NULL,
    "heroButtonLink" TEXT NOT NULL,
    "topNoticeText" TEXT,
    "promoTitle" TEXT NOT NULL,
    "promoSubtitle" TEXT NOT NULL,
    "promoButtonText" TEXT NOT NULL,
    "promoButtonLink" TEXT NOT NULL,
    "featuredRaffleId" TEXT,
    "heroBackgroundImage" TEXT,
    "promoImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeConfig_featuredRaffleId_idx" ON "HomeConfig"("featuredRaffleId");

-- AddForeignKey
ALTER TABLE "HomeConfig" ADD CONSTRAINT "HomeConfig_featuredRaffleId_fkey" FOREIGN KEY ("featuredRaffleId") REFERENCES "Raffle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
