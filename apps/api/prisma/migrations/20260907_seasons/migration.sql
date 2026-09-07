-- Seasons: the ladder becomes a window that closes, pays, and reopens.
--
-- Existing holds start the first season with a peak equal to what they already
-- hold, so nobody's climb to date is thrown away by the feature that measures
-- climbing.

ALTER TABLE "Player" ADD COLUMN "seasonPeak" INTEGER NOT NULL DEFAULT 0;
UPDATE "Player" SET "seasonPeak" = "trophies";

CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeasonResult" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "trophies" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "gold" INTEGER NOT NULL,
    "iron" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Season_index_key" ON "Season"("index");
CREATE INDEX "Season_closedAt_idx" ON "Season"("closedAt");
CREATE INDEX "Player_seasonPeak_idx" ON "Player"("seasonPeak");
CREATE UNIQUE INDEX "SeasonResult_seasonId_playerId_key" ON "SeasonResult"("seasonId", "playerId");
CREATE INDEX "SeasonResult_seasonId_rank_idx" ON "SeasonResult"("seasonId", "rank");
CREATE INDEX "SeasonResult_playerId_createdAt_idx" ON "SeasonResult"("playerId", "createdAt");

ALTER TABLE "SeasonResult" ADD CONSTRAINT "SeasonResult_seasonId_fkey"
    FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeasonResult" ADD CONSTRAINT "SeasonResult_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
