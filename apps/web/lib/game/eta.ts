import { TROOP, TROOP_ORDER, heroStats } from '@ironvow/config';
import type { Battle } from '@ironvow/sim';

/**
 * How long until this raid is over.
 *
 * ALFA: "kasih estimasi waktu selesai dan ada percepat 1x 2 x sampai 4x"
 *
 * Asked from inside the part of a raid nobody enjoys: the warband is committed,
 * the tray is empty, and there is nothing to do but watch a clock count down
 * from two and a half minutes while four Raiders finish a wall. The clock was
 * the only number on screen and it is the wrong one — it says when the raid
 * *may* end, not when it *will*.
 *
 * So this estimates the real one. With nothing left to deploy the outcome is
 * already decided; what is left is arithmetic on the damage still to be done
 * and the rate the surviving warband does it at. It is capped by the clock,
 * because the clock is a hard ceiling either way.
 *
 * It is deliberately an estimate and labelled as one. It does not know how far
 * a unit still has to walk, or which of them are about to be shot off the
 * field, so it reads early on a base with long gaps in it and late on one whose
 * cannons are still standing. Close enough to answer "do I have time to make
 * tea", which is the question.
 */
export function battleEta(battle: Battle, heroLevel: number): number | null {
  if (battle.ended) return 0;

  // Troops still in the tray mean the player, not the arithmetic, decides how
  // long this takes. No estimate is better than one that ignores them.
  let inHand = 0;
  for (const t of TROOP_ORDER) inHand += battle.avail[t] ?? 0;
  if (inHand > 0) return null;

  /*
   * A hero still in hand does not suppress the estimate, but it does change
   * the floor under it. The simulation only calls a raid off early when there
   * is nothing left to send at all, and the hero counts — so with one still in
   * hand and nobody on the field, the raid does not end, it runs the clock out.
   */
  const clock = battle.secondsLeft();
  const alive = battle.units.filter((u) => !u.dead && u.side === 'atk');
  if (alive.length === 0) return battle.heroReady() ? clock : 0;

  let dps = 0;
  for (const u of alive) {
    const period = u.t === 'hero' ? heroStats(heroLevel).cd : TROOP[u.t].cd;
    if (period > 0) dps += u.dmg / period;
  }
  let hp = 0;
  for (const s of battle.structs) if (!s.dead) hp += s.hp;
  if (dps <= 0 || hp <= 0) return 0;

  return Math.min(clock, hp / dps);
}

/** The speeds the battle may be watched at. */
export const SPEEDS = [1, 2, 3, 4] as const;
export type BattleSpeed = (typeof SPEEDS)[number];

export function isBattleSpeed(v: unknown): v is BattleSpeed {
  return (SPEEDS as readonly number[]).includes(v as number);
}

/**
 * The speed is remembered, because it is a preference and not a decision.
 *
 * A player who wants to watch raids at four times over wants that for every
 * raid, and asking again at the top of each one is the same question answered
 * the same way forever.
 */
const STORAGE_KEY = 'ironvow.battleSpeed';

export function loadBattleSpeed(): BattleSpeed {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (isBattleSpeed(saved)) return saved;
  } catch {
    // A browser that will not hand over storage still gets to play.
  }
  return 1;
}

export function saveBattleSpeed(speed: BattleSpeed): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(speed));
  } catch {
    // Not worth a word to the player.
  }
}
