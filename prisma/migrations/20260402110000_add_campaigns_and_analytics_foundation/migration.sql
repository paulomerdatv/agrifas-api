-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "bannerTitle" TEXT,
    "bannerSubtitle" TEXT,
    "bannerButtonText" TEXT,
    "bannerButtonLink" TEXT,
    "couponCode" TEXT,
    "featuredRaffleId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "campaignType" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "Campaign"("slug");
CREATE INDEX "Campaign_active_priority_createdAt_idx" ON "Campaign"("active", "priority", "createdAt");
CREATE INDEX "Campaign_startsAt_endsAt_idx" ON "Campaign"("startsAt", "endsAt");
CREATE INDEX "Campaign_featuredRaffleId_idx" ON "Campaign"("featuredRaffleId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_featuredRaffleId_fkey" FOREIGN KEY ("featuredRaffleId") REFERENCES "Raffle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
