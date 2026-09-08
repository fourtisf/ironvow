-- The last What's New note a player has read.
--
-- Defaults to zero, which means "has read none". That is the right default for
-- every hold that already exists: they were never told about seasons, traps,
-- relics or the air layer, and they are the reason the panel is being written.
-- A hold raised from now on is created caught up instead, in createPlayer.
ALTER TABLE "Player" ADD COLUMN "newsSeen" INTEGER NOT NULL DEFAULT 0;
