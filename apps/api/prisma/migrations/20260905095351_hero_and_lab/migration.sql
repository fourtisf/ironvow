-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "heroLevel" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "heroReadyAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Raid" ADD COLUMN     "hero" JSONB,
ADD COLUMN     "troopLevels" JSONB;

-- AlterTable
ALTER TABLE "Troop" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1;
