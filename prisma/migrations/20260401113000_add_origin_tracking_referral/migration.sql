-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "refCode" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmCampaign" TEXT;

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN     "refCode" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmCampaign" TEXT;
