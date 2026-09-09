-- The night world: a second base, with nothing crossing between the two.
--
-- Every existing row belongs to the day world, which is what the defaults say.
-- No backfill runs and no data moves: a server that has been up for a week
-- comes through this migration with its day world untouched, and the night one
-- simply empty until somebody crosses over.

ALTER TABLE "Building" ADD COLUMN "world" TEXT NOT NULL DEFAULT 'day';
ALTER TABLE "Troop"    ADD COLUMN "world" TEXT NOT NULL DEFAULT 'day';
ALTER TABLE "Layout"   ADD COLUMN "world" TEXT NOT NULL DEFAULT 'day';
ALTER TABLE "Raid"     ADD COLUMN "world" TEXT NOT NULL DEFAULT 'day';

-- The night purse and crew. The night Town Hall level is deliberately absent:
-- it is read off the night Keep, so the two cannot drift apart.
ALTER TABLE "Player" ADD COLUMN "nightGold"      BIGINT   NOT NULL DEFAULT 0;
ALTER TABLE "Player" ADD COLUMN "nightIron"      BIGINT   NOT NULL DEFAULT 0;
ALTER TABLE "Player" ADD COLUMN "nightBuilders"  INTEGER  NOT NULL DEFAULT 2;
ALTER TABLE "Player" ADD COLUMN "nightTrophies"  INTEGER  NOT NULL DEFAULT 0;
ALTER TABLE "Player" ADD COLUMN "nightStartedAt" TIMESTAMP(3);

-- One army and one layout slot per world, not per player.
DROP INDEX IF EXISTS "Troop_playerId_type_key";
DROP INDEX IF EXISTS "Troop_playerId_idx";
CREATE UNIQUE INDEX "Troop_playerId_world_type_key" ON "Troop"("playerId", "world", "type");
CREATE INDEX "Troop_playerId_world_idx" ON "Troop"("playerId", "world");

DROP INDEX IF EXISTS "Layout_playerId_slot_key";
DROP INDEX IF EXISTS "Layout_playerId_idx";
CREATE UNIQUE INDEX "Layout_playerId_world_slot_key" ON "Layout"("playerId", "world", "slot");
CREATE INDEX "Layout_playerId_world_idx" ON "Layout"("playerId", "world");

-- Night matchmaking reads open raids in one world only.
CREATE INDEX "Raid_world_status_idx" ON "Raid"("world", "status");

-- Each world trains its own army, in its own queue.
ALTER TABLE "TrainJob" ADD COLUMN "world" TEXT NOT NULL DEFAULT 'day';
DROP INDEX IF EXISTS "TrainJob_playerId_position_idx";
CREATE INDEX "TrainJob_playerId_world_position_idx" ON "TrainJob"("playerId", "world", "position");

-- The night world's own production clock. Its own, because production pays for
-- the time since the last tick: one shared clock would mean opening the day
-- base silently zeroes whatever the night base had been earning.
ALTER TABLE "Player" ADD COLUMN "nightTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
