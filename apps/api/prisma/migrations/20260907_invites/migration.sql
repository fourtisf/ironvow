-- Invitations.
--
-- The code is nullable rather than backfilled with a default: a unique column
-- cannot take one, and every existing hold gets its code the first time it
-- asks for it. `invitedById` is deliberately not a foreign key — an inviter
-- who deletes their hold should not take the record of the invitation with
-- them, and nothing reads the row except to pay it.
ALTER TABLE "Player" ADD COLUMN "inviteCode" TEXT;
ALTER TABLE "Player" ADD COLUMN "invitedById" TEXT;
ALTER TABLE "Player" ADD COLUMN "invitePaidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Player_inviteCode_key" ON "Player"("inviteCode");
CREATE INDEX "Player_invitedById_idx" ON "Player"("invitedById");
