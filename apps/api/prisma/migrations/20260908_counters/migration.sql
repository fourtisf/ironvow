-- One counter, for one thing, on one day.
--
-- The only telemetry the game keeps, and only for the questions no existing
-- column can answer: how many people opened the door, and how many the access
-- code turned away. Everything after sign-up is already recorded on Player.

CREATE TABLE "Counter" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Counter_day_name_key" ON "Counter"("day", "name");
CREATE INDEX "Counter_name_idx" ON "Counter"("name");
