-- CreateTable
CREATE TABLE "Layout" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "positions" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Layout_playerId_idx" ON "Layout"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Layout_playerId_slot_key" ON "Layout"("playerId", "slot");

-- AddForeignKey
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
