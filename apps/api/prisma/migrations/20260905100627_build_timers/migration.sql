-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "completesAt" TIMESTAMP(3),
ADD COLUMN     "upgradingTo" INTEGER;

-- CreateIndex
CREATE INDEX "Building_playerId_completesAt_idx" ON "Building"("playerId", "completesAt");
