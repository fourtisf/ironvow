import { DEF_STAT, TICKS_PER_SECOND, TROOP, TROOP_UNLOCK, coversAir, flies } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import type { BaseSnapshot, BattleArmy, DeployCommand, SnapshotBuilding } from '@ironvow/types';
import { createBattle, simulate } from '../src/index.js';

/**
 * The air layer.
 *
 * Before this, every gun on a base shot everything, so a layout had exactly one
 * question in it: *where*. There was no attack a Cannon was the wrong answer to.
 *
 * A Bomber adds the second question. It flies, so no rampart stops it and no
 * trap catches it — and a wall is the single biggest thing a defender spends
 * gold on across the whole game. Most of the base cannot touch it. What decides
 * the raid is whether the defender put a gun that points up in the right place.
 */

const NONE: BattleArmy = { raider: 0, archer: 0, lancer: 0, ram: 0, scaler: 0, bomber: 0 };

function snap(buildings: SnapshotBuilding[]): BaseSnapshot {
  return {
    version: 1, defenderId: 'd', defenderName: 'T', keepLevel: 3,
    buildings, pool: { g: 800, i: 300 },
  };
}

function b(id: string, type: SnapshotBuilding['type'], gx: number, gy: number, level = 5): SnapshotBuilding {
  return { id, type, gx, gy, level };
}

/** Run one troop at one base and report how it went. */
function play(
  base: BaseSnapshot, troop: keyof BattleArmy, n: number, seconds: number,
  at: [number, number] = [18, 30],
) {
  const commands: DeployCommand[] = Array.from({ length: n }, (_, i) => ({
    tickIndex: i, troopType: troop, gx: at[0], gy: at[1] + (i % 3) * 0.4,
  }));
  const battle = createBattle({
    snapshot: base, commands, army: { ...NONE, [troop]: n }, seed: 5,
  });
  for (let i = 0; i < TICKS_PER_SECOND * seconds && !battle.step(); i++) { /* the clock */ }
  expect(battle.result().rejected).toEqual([]);
  const mine = battle.units.filter((u) => u.side === 'atk');
  return {
    battle,
    alive: mine.filter((u) => !u.dead).length,
    hurt: mine.filter((u) => u.hp < u.maxHp).length,
    pct: battle.destroyedPct(),
  };
}

/** A Keep behind a full ring of ramparts, and nothing that points up. */
const walled = (extra: SnapshotBuilding[] = []) => {
  const walls: SnapshotBuilding[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    walls.push(b(`w${i}`, 'wall', Math.round(29 + Math.cos(a) * 6), Math.round(29 + Math.sin(a) * 6), 6));
  }
  return snap([b('k', 'keep', 28, 28, 5), ...walls, ...extra]);
};

describe('a wall is nothing to a flyer', () => {
  it('flies over a ring a ground troop has to break', () => {
    /*
     * Measured on the Keep's hit points rather than on destroyedPct, because
     * destruction is quantised to whole buildings: a Bomber that crossed the
     * ring and spent twenty seconds on the Keep without felling it scores
     * exactly the same zero as a Raider still hitting the wall outside.
     */
    const keepHp = (r: ReturnType<typeof play>) => {
      const k = r.battle.structs.find((x) => x.id === 'k')!;
      return k.maxHp - k.hp;
    };
    // Same base, same clock, same seed. The Bomber is the slower unit and is
    // still the one doing damage, because it never stopped at the rampart.
    expect(keepHp(play(walled(), 'bomber', 4, 26))).toBeGreaterThan(0);
    expect(keepHp(play(walled(), 'raider', 4, 26))).toBe(0);
  });

  it('leaves every rampart standing, because it never targets one', () => {
    const { battle } = play(walled(), 'bomber', 4, 26);
    expect(battle.structs.filter((s) => s.t === 'wall' && s.dead)).toHaveLength(0);
  });

  it('is a flyer everywhere the game asks', () => {
    expect(flies('bomber')).toBe(true);
    for (const t of ['raider', 'archer', 'lancer', 'ram', 'scaler'] as const) {
      expect(flies(t), t).toBe(false);
    }
  });
});

describe('most of a base cannot reach it', () => {
  const guns = (type: 'cannon' | 'tower' | 'mortar' | 'airdef') =>
    snap([b('k', 'keep', 28, 28, 5), b('g', type, 24, 29, 6)]);

  it('a Cannon never fires at one, and shreds the same men on foot', () => {
    // The Cannon is the control: it is the same building, the same spot and the
    // same seed, and the only difference is whether the target is flying.
    expect(play(guns('cannon'), 'bomber', 2, 22).hurt).toBe(0);
    expect(play(guns('cannon'), 'raider', 2, 22).hurt).toBeGreaterThan(0);
  });

  it('a Mortar never fires at one either', () => {
    expect(play(guns('mortar'), 'bomber', 3, 22).hurt).toBe(0);
  });

  it('an Archer Tower covers both, which is what makes it the safe building', () => {
    expect(play(guns('tower'), 'bomber', 2, 22).hurt).toBeGreaterThan(0);
    expect(play(guns('tower'), 'raider', 2, 22).hurt).toBeGreaterThan(0);
  });

  it('an Air Defence answers the flyer and nothing else', () => {
    expect(play(guns('airdef'), 'bomber', 2, 22).hurt).toBeGreaterThan(0);
    // The other half, and the reason the building is a decision: against a
    // warband on foot it is a wall with a spike on it.
    expect(play(guns('airdef'), 'raider', 3, 22).hurt).toBe(0);
  });

  it('kills what it exists for, rather than merely slowing it', () => {
    // A defence that only chips the thing it was built for is not an answer.
    expect(play(guns('airdef'), 'bomber', 1, 26).alive).toBe(0);
  });
});

describe('a trap is a hole in the ground', () => {
  const mined = (t: 'spike' | 'snare') =>
    snap([b('k', 'keep', 28, 28, 5), b('t', t, 23, 30, 5), b('t2', t, 25, 30, 5)]);

  it('never springs under something flying over it', () => {
    const { battle } = play(mined('spike'), 'bomber', 3, 20);
    expect(battle.traps().every((t) => t.sprung < 0)).toBe(true);
  });

  it('springs under the same men on foot', () => {
    const { battle } = play(mined('spike'), 'raider', 3, 20);
    expect(battle.traps().some((t) => t.sprung >= 0)).toBe(true);
  });

  it('a Net Trap cannot hold one either', () => {
    const { battle } = play(mined('snare'), 'bomber', 3, 20);
    expect(battle.traps().every((t) => t.sprung < 0)).toBe(true);
  });
});

describe('the base cover decides the raid, which is the whole point', () => {
  it('the same Bomber army goes far worse against a base that covered the air', () => {
    /*
     * Counted in Bombers left standing, not in destruction. The two bases hold
     * a different third building, so their totals differ by a hair for reasons
     * that have nothing to do with the air — and the claim being made here is
     * about the flyers, so that is what is counted.
     */
    const bare = snap([b('k', 'keep', 28, 28, 5), b('c', 'cannon', 24, 29, 6), b('c2', 'cannon', 32, 29, 6)]);
    // The same gold, spent on a gun that points up instead of a second Cannon.
    const covered = snap([b('k', 'keep', 28, 28, 5), b('c', 'cannon', 24, 29, 6), b('a', 'airdef', 32, 29, 6)]);
    expect(play(covered, 'bomber', 4, 30).alive).toBeLessThan(play(bare, 'bomber', 4, 30).alive);
    // Two Cannons are worth precisely nothing against them.
    expect(play(bare, 'bomber', 4, 30).alive).toBe(4);
  });

  it('and that same choice costs the defender against a warband on foot', () => {
    // The trade has to cut both ways or the Air Defence is a free building.
    const bare = snap([b('k', 'keep', 28, 28, 5), b('c', 'cannon', 24, 29, 6), b('c2', 'cannon', 32, 29, 6)]);
    const covered = snap([b('k', 'keep', 28, 28, 5), b('c', 'cannon', 24, 29, 6), b('a', 'airdef', 32, 29, 6)]);
    expect(play(covered, 'raider', 8, 30).pct).toBeGreaterThanOrEqual(play(bare, 'raider', 8, 30).pct);
  });
});

describe('what the defenders can reach', () => {
  it('a donated Archer shoots at a Bomber; a donated Lancer does not', () => {
    const withGuard = (type: 'archer' | 'lancer'): BaseSnapshot => ({
      ...snap([b('k', 'keep', 28, 28, 5)]),
      garrison: [{ type, x: 26, y: 29, scale: 1 }],
    });
    // A Lancer locked onto something it can never hurt would stand there while
    // the base came down around it.
    expect(play(withGuard('archer'), 'bomber', 2, 24).hurt).toBeGreaterThan(0);
    expect(play(withGuard('lancer'), 'bomber', 2, 24).hurt).toBe(0);
  });

  it('the Lancer still fights anything on foot', () => {
    const guarded: BaseSnapshot = {
      ...snap([b('k', 'keep', 28, 28, 5)]),
      garrison: [{ type: 'lancer', x: 26, y: 29, scale: 1 }],
    };
    expect(play(guarded, 'raider', 2, 24).hurt).toBeGreaterThan(0);
  });
});

describe('the table itself', () => {
  it('opens the answer no later than the question', () => {
    // Meeting a Bomber before you could have built an Air Defence would be a
    // stretch of the game with a solved attack and no counter.
    expect(TROOP_UNLOCK.bomber).toBe(5);
    expect(coversAir('airdef')).toBe(true);
    expect(coversAir('tower')).toBe(true);
    expect(coversAir('cannon')).toBe(false);
    expect(coversAir('mortar')).toBe(false);
  });

  it('prices the flyer as a commitment, not a sixth option', () => {
    expect(TROOP.bomber.sp).toBe(TROOP.ram.sp);
    expect(TROOP.bomber.spd).toBeLessThan(TROOP.raider.spd);
  });

  it('gives the Air Defence more reach than the tower that shares its job', () => {
    expect(DEF_STAT.airdef!(1).rng).toBeGreaterThan(DEF_STAT.tower!(1).rng);
    expect(DEF_STAT.airdef!(1).hits).toBe('air');
  });
});
