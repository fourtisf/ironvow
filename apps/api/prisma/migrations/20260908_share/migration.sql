-- A replay anybody can watch.
--
-- The token is separate from the raid id on purpose: sharing one fight must not
-- hand out a key that can be walked to the next one. Null means private, which
-- is what every raid recorded so far is and stays.
ALTER TABLE "Raid" ADD COLUMN "shareId" TEXT;
ALTER TABLE "Raid" ADD COLUMN "sharedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Raid_shareId_key" ON "Raid"("shareId");
