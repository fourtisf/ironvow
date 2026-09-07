-- The garrison: troops a clan has given this hold.
--
-- A JSON column rather than a table, for the same reason the training queue is
-- not one: it is a handful of counts read and written whole, always with the
-- player, and never queried across. `{}` is an empty garrison, which is what
-- every existing hold has.
ALTER TABLE "Player" ADD COLUMN "garrison" JSONB NOT NULL DEFAULT '{}';
