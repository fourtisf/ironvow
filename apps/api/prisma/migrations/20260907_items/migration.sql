-- Battle items: the one thing an attacker brings to a raid that is not a troop.
--
-- The pouch is frozen onto the raid alongside the warband, so buying an item
-- mid-raid cannot change a raid already open, and a replay years later still
-- has the pouch the fight was fought with. Both columns are nullable: every
-- raid recorded before this migration replays as one where no items were used.

ALTER TABLE "Player" ADD COLUMN "pouch" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Raid" ADD COLUMN "pouch" JSONB;
ALTER TABLE "Raid" ADD COLUMN "items" JSONB;
