-- CreateEnum
CREATE TYPE "WinnerDeliveryStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Winner"
ADD COLUMN     "deliveryStatus" "WinnerDeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3);
