-- AlterTable
ALTER TABLE "Clan" ADD COLUMN     "warDraws" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warLosses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warWins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Raid" ADD COLUMN     "warId" TEXT,
ADD COLUMN     "warMemberId" TEXT;

-- CreateTable
CREATE TABLE "ClanWar" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "clanAId" TEXT NOT NULL,
    "clanBId" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "starsA" INTEGER NOT NULL DEFAULT 0,
    "starsB" INTEGER NOT NULL DEFAULT 0,
    "pctA" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pctB" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClanWar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarMember" (
    "id" TEXT NOT NULL,
    "warId" TEXT NOT NULL,
    "clanId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keepLevel" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "bestStars" INTEGER NOT NULL DEFAULT 0,
    "bestPct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "WarMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarAttack" (
    "id" TEXT NOT NULL,
    "warId" TEXT NOT NULL,
    "attackerMemberId" TEXT NOT NULL,
    "defenderMemberId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "destroyedPct" DOUBLE PRECISION NOT NULL,
    "raidId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarAttack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "playerId" TEXT,
    "body" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ClanWar_state_idx" ON "ClanWar"("state");

-- CreateIndex
CREATE INDEX "ClanWar_clanAId_createdAt_idx" ON "ClanWar"("clanAId", "createdAt");

-- CreateIndex
CREATE INDEX "ClanWar_clanBId_createdAt_idx" ON "ClanWar"("clanBId", "createdAt");

-- CreateIndex
CREATE INDEX "WarMember_warId_clanId_idx" ON "WarMember"("warId", "clanId");

-- CreateIndex
CREATE UNIQUE INDEX "WarMember_warId_playerId_key" ON "WarMember"("warId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "WarAttack_raidId_key" ON "WarAttack"("raidId");

-- CreateIndex
CREATE INDEX "WarAttack_warId_attackerMemberId_idx" ON "WarAttack"("warId", "attackerMemberId");

-- CreateIndex
CREATE INDEX "WarAttack_warId_defenderMemberId_idx" ON "WarAttack"("warId", "defenderMemberId");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Raid_warId_idx" ON "Raid"("warId");

-- AddForeignKey
ALTER TABLE "WarMember" ADD CONSTRAINT "WarMember_warId_fkey" FOREIGN KEY ("warId") REFERENCES "ClanWar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarAttack" ADD CONSTRAINT "WarAttack_warId_fkey" FOREIGN KEY ("warId") REFERENCES "ClanWar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
