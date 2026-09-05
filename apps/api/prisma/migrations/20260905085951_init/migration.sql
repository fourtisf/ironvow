-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gold" BIGINT NOT NULL DEFAULT 900,
    "iron" BIGINT NOT NULL DEFAULT 320,
    "trophies" INTEGER NOT NULL DEFAULT 0,
    "keepLevel" INTEGER NOT NULL DEFAULT 1,
    "lastTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shieldUntil" TIMESTAMP(3),

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "gx" INTEGER NOT NULL,
    "gy" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Troop" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Troop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainJob" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "finishesAt" TIMESTAMP(3) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TrainJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Raid" (
    "id" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "defenderId" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "commands" JSONB,
    "army" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "stars" INTEGER NOT NULL DEFAULT 0,
    "destroyedPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lootGold" BIGINT NOT NULL DEFAULT 0,
    "lootIron" BIGINT NOT NULL DEFAULT 0,
    "trophyDelta" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Raid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Divergence" (
    "id" TEXT NOT NULL,
    "raidId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "clientChecksum" TEXT NOT NULL,
    "serverChecksum" TEXT NOT NULL,
    "clientStars" INTEGER,
    "serverStars" INTEGER NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Divergence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "playerId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_name_key" ON "Player"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Player_email_key" ON "Player"("email");

-- CreateIndex
CREATE INDEX "Player_trophies_idx" ON "Player"("trophies");

-- CreateIndex
CREATE INDEX "Building_playerId_idx" ON "Building"("playerId");

-- CreateIndex
CREATE INDEX "Building_playerId_type_idx" ON "Building"("playerId", "type");

-- CreateIndex
CREATE INDEX "Troop_playerId_idx" ON "Troop"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Troop_playerId_type_key" ON "Troop"("playerId", "type");

-- CreateIndex
CREATE INDEX "TrainJob_playerId_position_idx" ON "TrainJob"("playerId", "position");

-- CreateIndex
CREATE INDEX "Raid_defenderId_createdAt_idx" ON "Raid"("defenderId", "createdAt");

-- CreateIndex
CREATE INDEX "Raid_attackerId_createdAt_idx" ON "Raid"("attackerId", "createdAt");

-- CreateIndex
CREATE INDEX "Raid_attackerId_status_idx" ON "Raid"("attackerId", "status");

-- CreateIndex
CREATE INDEX "Divergence_createdAt_idx" ON "Divergence"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_playerId_idx" ON "Session"("playerId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoginLink_tokenHash_key" ON "LoginLink"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginLink_email_idx" ON "LoginLink"("email");

-- CreateIndex
CREATE INDEX "LoginLink_expiresAt_idx" ON "LoginLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Troop" ADD CONSTRAINT "Troop_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainJob" ADD CONSTRAINT "TrainJob_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Raid" ADD CONSTRAINT "Raid_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Raid" ADD CONSTRAINT "Raid_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginLink" ADD CONSTRAINT "LoginLink_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
