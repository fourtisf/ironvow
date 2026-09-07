-- Builders are now a per-hold number rather than one constant for everyone:
-- a hold starts with two and hires up to ten.
--
-- Existing holds get three, which is what they have been playing with since
-- the first day. Taking one away from someone who already had it would be a
-- balance change dressed up as a migration.
ALTER TABLE "Player" ADD COLUMN "builders" INTEGER NOT NULL DEFAULT 2;
UPDATE "Player" SET "builders" = 3;
