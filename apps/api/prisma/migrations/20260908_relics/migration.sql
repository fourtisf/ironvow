-- Relics: the progression that starts where the Keep stops.
--
-- Three columns rather than a table, for the same reason the pouch and the
-- garrison are columns: a handful of small numbers read and written whole with
-- the player, never queried across. Everyone starts with nothing forged and
-- nothing carried, which is what the defaults say.

ALTER TABLE "Player" ADD COLUMN "shards" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Player" ADD COLUMN "relics" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Player" ADD COLUMN "carried" JSONB NOT NULL DEFAULT '[]';
