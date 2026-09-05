import {
  DEFEND_TICKS,
  DEF_STAT,
  N,
  RAID_TICKS,
  TICK_SECONDS,
  TROOP,
  TROOP_ORDER,
  TYPES,
  clamp,
  dist,
  facingOf,
  hpOf,
  isDefensive,
  isRanged,
  isTroopType,
  starsFor,
  stepToward,
  type BuildingType,
  type TroopType,
} from '@ironvow/config';
import type {
  BattleArmy,
  BattleKind,
  DeployCommand,
  RejectedCommand,
  SimInput,
  SimResult,
  SimTimeline,
  TimelineEvent,
} from '@ironvow/types';
import { Checksum } from './hash.js';

/* ------------------------------------------------------------------ *
 * Internal state
 *
 * Everything is a flat array indexed by integer. Nothing iterates a Set
 * or an object's keys on a path that can change a result, so no outcome
 * can depend on insertion order (spec S4.2).
 * ------------------------------------------------------------------ */

interface SimStruct {
  i: number;
  id: string;
  t: BuildingType;
  gx: number;
  gy: number;
  lv: number;
  size: number;
  cx: number;
  cy: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  lootG: number;
  lootI: number;
  cd: number;
}

interface SimUnit {
  i: number;
  t: TroopType;
  x: number;
  y: number;
  side: 'atk' | 'def';
  hp: number;
  maxHp: number;
  dmg: number;
  tgt: number;
  tgtU: number;
  cd: number;
  dead: boolean;
  face: 1 | -1;
  moving: boolean;
}

interface SimProj {
  x: number;
  y: number;
  tx: number;
  ty: number;
  spd: number;
  dmg: number;
  kind: 'arrow' | 'ball';
  /** Index into structs, or -1. */
  tgtStruct: number;
  /** Index into units, or -1. Set means the projectile homes. */
  tgtUnit: number;
}

const DT = TICK_SECONDS;

/** Deploys must land this far outside a structure's footprint. */
const DEPLOY_CLEARANCE = 1.6;
/** Deploys must stay this far inside the world edge. */
const DEPLOY_MARGIN = 1.5;

export interface SimOptions {
  /** Record a per-event timeline for the renderer. Off by default: the server never needs it. */
  timeline?: boolean;
}

export interface SimOutcome extends SimResult {
  timeline?: SimTimeline;
}

/**
 * The one function that decides a battle.
 *
 * Pure: same snapshot, same commands, same seed always produce the same
 * SimResult, on any engine. The client runs it to draw the fight; the server
 * runs this exact code to decide what actually happened. The client never
 * sends a result, so there is nothing to forge (spec S4).
 *
 * The battle itself consumes no randomness: every roll in IRONVOW happens
 * before the fight, when the server generates or snapshots the defending base.
 * The seed is still carried on the Raid row and folded into the checksum, so a
 * future rule that does need a die roll stays replayable without a migration.
 */
export function simulate(input: SimInput, options: SimOptions = {}): SimOutcome {
  const { snapshot, commands, army, seed } = input;
  const kind: BattleKind = input.kind ?? 'raid';
  const events: TimelineEvent[] = [];
  const wantTimeline = options.timeline === true;

  /* ---- structures ---- */
  const carriers = snapshot.buildings.reduce((n, b) => (b.type === 'wall' ? n : n + 1), 0) || 1;
  const structs: SimStruct[] = snapshot.buildings.map((b, i) => {
    const size = TYPES[b.type].s;
    const maxHp = hpOf(b.type, b.level);
    return {
      i,
      id: b.id,
      t: b.type,
      gx: b.gx,
      gy: b.gy,
      lv: b.level,
      size,
      cx: b.gx + size / 2,
      cy: b.gy + size / 2,
      hp: maxHp,
      maxHp,
      dead: false,
      lootG: b.type === 'wall' ? 0 : snapshot.pool.g / carriers,
      lootI: b.type === 'wall' ? 0 : snapshot.pool.i / carriers,
      cd: 0,
    };
  });

  const totalHp = structs.reduce((a, s) => a + s.maxHp, 0) || 1;
  const units: SimUnit[] = [];
  const projs: SimProj[] = [];

  /** Occupied rampart cells, for the physical block. Only ever probed with .has(). */
  const wallSet = new Set<string>();
  const rebuildWallSet = (): void => {
    wallSet.clear();
    for (const s of structs) if (s.t === 'wall' && !s.dead) wallSet.add(s.gx + ',' + s.gy);
  };
  rebuildWallSet();

  let killedHp = 0;
  let lootG = 0;
  let lootI = 0;

  /* ---- the attacker's warband, drawn down by each deploy ---- */
  const avail: BattleArmy = { raider: army.raider | 0, archer: army.archer | 0, lancer: army.lancer | 0, ram: army.ram | 0 };
  const rejected: RejectedCommand[] = [];
  const mySide: 'atk' | 'def' = kind === 'raid' ? 'atk' : 'def';

  const spawn = (t: TroopType, x: number, y: number, side: 'atk' | 'def', scale: number, tick: number): void => {
    const d = TROOP[t];
    const u: SimUnit = {
      i: units.length,
      t,
      x,
      y,
      side,
      hp: d.hp * scale,
      maxHp: d.hp * scale,
      dmg: d.dmg * scale,
      tgt: -1,
      tgtU: -1,
      cd: 0,
      dead: false,
      face: 1,
      moving: false,
    };
    units.push(u);
    if (wantTimeline) events.push({ t: tick, k: 'spawn', unit: u.i, type: t, x, y, side });
  };

  /* ---- a defend battle's attacking wave is frozen into the snapshot ---- */
  if (kind === 'defend' && snapshot.defendWave) {
    for (const w of snapshot.defendWave) spawn(w.type, w.x, w.y, 'atk', w.scale, 0);
  }

  /* ---- commands are bucketed by tick, preserving submission order within a tick ---- */
  const byTick = new Map<number, { cmd: DeployCommand; index: number }[]>();
  let lastTick = -1;
  commands.forEach((cmd, index) => {
    if (!Number.isInteger(cmd.tickIndex) || cmd.tickIndex < 0 || cmd.tickIndex < lastTick) {
      rejected.push({ index, reason: 'badTick' });
      return;
    }
    lastTick = cmd.tickIndex;
    if (!isTroopType(cmd.troopType)) {
      rejected.push({ index, reason: 'unknownTroop' });
      return;
    }
    const bucket = byTick.get(cmd.tickIndex);
    if (bucket) bucket.push({ cmd, index });
    else byTick.set(cmd.tickIndex, [{ cmd, index }]);
  });

  const applyDeploys = (tick: number): void => {
    const bucket = byTick.get(tick);
    if (!bucket) return;
    for (const { cmd, index } of bucket) {
      const t = cmd.troopType;
      if ((avail[t] ?? 0) <= 0) {
        rejected.push({ index, reason: 'noTroopsLeft' });
        continue;
      }
      if (cmd.gx < DEPLOY_MARGIN || cmd.gy < DEPLOY_MARGIN || cmd.gx > N - DEPLOY_MARGIN || cmd.gy > N - DEPLOY_MARGIN) {
        rejected.push({ index, reason: 'outOfBounds' });
        continue;
      }
      let blocked = false;
      for (const s of structs) {
        if (s.dead) continue;
        if (dist(cmd.gx, cmd.gy, s.cx, s.cy) < s.size / 2 + DEPLOY_CLEARANCE) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        rejected.push({ index, reason: 'tooCloseToStructure' });
        continue;
      }
      avail[t]--;
      spawn(t, cmd.gx, cmd.gy, mySide, 1, tick);
    }
  };

  /* ---- targeting ---- */

  /**
   * Ported from the prototype, quirks included.
   *
   * A ram weights ramparts at 0.55x distance so it prefers them, and the
   * `best` guard lets it fall through to any structure once the walls are gone
   * rather than stalling in front of nothing.
   */
  const pickTarget = (u: SimUnit): void => {
    const pref = TROOP[u.t].pref;
    let best = -1;
    let bd = 1e9;
    for (const s of structs) {
      if (s.dead) continue;
      if (pref === 'def' && !isDefensive(s.t)) continue;
      if (pref === 'wall' && s.t !== 'wall' && best >= 0) continue;
      const d = dist(u.x, u.y, s.cx, s.cy);
      const w = pref === 'wall' && s.t === 'wall' ? d * 0.55 : d;
      if (w < bd) {
        bd = w;
        best = s.i;
      }
    }
    if (best < 0) {
      for (const s of structs) {
        if (s.dead) continue;
        const d = dist(u.x, u.y, s.cx, s.cy);
        if (d < bd) {
          bd = d;
          best = s.i;
        }
      }
    }
    u.tgt = best;
  };

  const pickEnemyUnit = (u: SimUnit): number => {
    let best = -1;
    let bd = 1e9;
    for (const o of units) {
      if (o.dead || o.side === u.side) continue;
      const d = dist(u.x, u.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o.i;
      }
    }
    u.tgtU = best;
    return bd;
  };

  /* ---- damage ---- */

  const damageStruct = (s: SimStruct, dmg: number, tick: number): void => {
    if (s.dead) return;
    s.hp -= dmg;
    if (wantTimeline) events.push({ t: tick, k: 'hitStruct', struct: s.i, dmg });
    if (s.hp <= 0) {
      s.dead = true;
      killedHp += s.maxHp;
      lootG += s.lootG;
      lootI += s.lootI;
      if (s.t === 'wall') rebuildWallSet();
      if (wantTimeline) events.push({ t: tick, k: 'structDead', struct: s.i });
    }
  };

  const hurtUnit = (u: SimUnit, dmg: number, tick: number): void => {
    if (u.dead) return;
    u.hp -= dmg;
    if (wantTimeline) events.push({ t: tick, k: 'hitUnit', unit: u.i, dmg });
    if (u.hp <= 0) {
      u.dead = true;
      if (wantTimeline) events.push({ t: tick, k: 'unitDead', unit: u.i });
    }
  };

  /* ---- the loop ---- */

  const maxTicks = kind === 'raid' ? RAID_TICKS : DEFEND_TICKS;
  const check = new Checksum();
  check.addInt(seed).addInt(structs.length).addInt(maxTicks);

  let deployed = 0;
  let endedBy: SimResult['endedBy'] = 'timeout';
  let tick = 0;

  for (; tick < maxTicks; tick++) {
    const before = units.length;
    applyDeploys(tick);
    deployed += units.length - before;

    /* --- units --- */
    for (const u of units) {
      if (u.dead) continue;
      const d = TROOP[u.t];

      if (u.side === 'def') {
        // Defenders hunt the attacking units rather than walking a base down.
        const du = pickEnemyUnit(u);
        const target = u.tgtU >= 0 ? units[u.tgtU] : undefined;
        if (target && !target.dead) {
          if (du <= d.rng + 0.35) {
            u.moving = false;
            u.cd -= DT;
            if (u.cd <= 0) {
              u.cd = d.cd;
              hurtUnit(target, u.dmg, tick);
            }
          } else {
            const p = stepToward(u.x, u.y, target.x, target.y, d.spd * DT);
            u.face = facingOf(target.x - u.x, target.y - u.y);
            u.x = p.x;
            u.y = p.y;
            u.moving = true;
          }
          continue;
        }
      }

      if (u.tgt < 0 || structs[u.tgt]!.dead) pickTarget(u);
      if (u.tgt < 0) continue;
      const tgt = structs[u.tgt]!;
      const gap = dist(u.x, u.y, tgt.cx, tgt.cy) - tgt.size * 0.5;

      if (gap <= d.rng) {
        u.moving = false;
        u.cd -= DT;
        if (u.cd <= 0) {
          u.cd = d.cd;
          if (isRanged(u.t)) {
            projs.push({
              x: u.x, y: u.y, tx: tgt.cx, ty: tgt.cy,
              spd: 6.5, dmg: u.dmg, kind: 'arrow', tgtStruct: tgt.i, tgtUnit: -1,
            });
            if (wantTimeline) {
              events.push({ t: tick, k: 'shot', from: 'unit', src: u.i, x: u.x, y: u.y, tx: tgt.cx, ty: tgt.cy, kind: 'arrow' });
            }
          } else {
            damageStruct(tgt, u.dmg, tick);
          }
        }
      } else {
        const p = stepToward(u.x, u.y, tgt.cx, tgt.cy, d.spd * DT);
        // A rampart physically stops you: walk into its cell and it becomes your problem.
        const key = Math.floor(p.x) + ',' + Math.floor(p.y);
        if (wallSet.has(key) && tgt.t !== 'wall') {
          const wall = structs.find(
            (s) => !s.dead && s.t === 'wall' && s.gx === Math.floor(p.x) && s.gy === Math.floor(p.y),
          );
          if (wall) u.tgt = wall.i;
        } else {
          u.x = p.x;
          u.y = p.y;
          u.moving = true;
        }
        u.face = facingOf(tgt.cx - u.x, tgt.cy - u.y);
      }
    }

    /* --- defensive structures fire on attackers --- */
    for (const s of structs) {
      if (s.dead) continue;
      const stat = DEF_STAT[s.t];
      if (!stat) continue;
      const st = stat(s.lv);
      let best = -1;
      let bd = 1e9;
      for (const u of units) {
        if (u.dead || u.side !== 'atk') continue;
        const d = dist(s.cx, s.cy, u.x, u.y);
        if (d < bd) {
          bd = d;
          best = u.i;
        }
      }
      s.cd -= DT;
      if (best >= 0 && bd <= st.rng && s.cd <= 0) {
        const target = units[best]!;
        s.cd = st.cd;
        projs.push({
          x: s.cx, y: s.cy, tx: target.x, ty: target.y,
          spd: s.t === 'cannon' ? 7 : 11,
          dmg: st.dmg,
          kind: s.t === 'cannon' ? 'ball' : 'arrow',
          tgtStruct: -1,
          tgtUnit: best,
        });
        if (wantTimeline) {
          events.push({
            t: tick, k: 'shot', from: 'struct', src: s.i,
            x: s.cx, y: s.cy, tx: target.x, ty: target.y,
            kind: s.t === 'cannon' ? 'ball' : 'arrow',
          });
        }
      }
    }

    /* --- projectiles --- */
    for (let i = projs.length - 1; i >= 0; i--) {
      const p = projs[i]!;
      const moved = stepToward(p.x, p.y, p.tx, p.ty, p.spd * DT);
      p.x = moved.x;
      p.y = moved.y;
      // Homing: re-aim after the step, exactly as the prototype does.
      if (p.tgtUnit >= 0) {
        const u = units[p.tgtUnit]!;
        if (!u.dead) {
          p.tx = u.x;
          p.ty = u.y;
        }
      }
      if (dist(p.x, p.y, p.tx, p.ty) < 0.35) {
        if (p.tgtUnit >= 0) hurtUnit(units[p.tgtUnit]!, p.dmg, tick);
        else if (p.tgtStruct >= 0) damageStruct(structs[p.tgtStruct]!, p.dmg, tick);
        projs.splice(i, 1);
      } else if (p.x < -4 || p.y < -4 || p.x > N + 4 || p.y > N + 4) {
        projs.splice(i, 1);
      }
    }

    check.addFloat(killedHp);

    /* --- end conditions --- */
    let left = 0;
    for (const t of TROOP_ORDER) left += avail[t] ?? 0;
    const pending = pendingAfter(byTick, tick);

    if (kind === 'raid') {
      if (!structs.some((s) => !s.dead)) { endedBy = 'wiped'; tick++; break; }
      const aliveMine = units.some((u) => !u.dead && u.side === 'atk');
      if (deployed > 0 && left === 0 && !pending && !aliveMine) { endedBy = 'exhausted'; tick++; break; }
    } else {
      if (!units.some((u) => !u.dead && u.side === 'atk')) { endedBy = 'wiped'; tick++; break; }
      if (!structs.some((s) => !s.dead && s.t === 'keep')) { endedBy = 'keepFell'; tick++; break; }
    }
  }

  const destroyedPct = clamp(killedHp / totalHp, 0, 1);
  const keepDestroyed = !structs.some((s) => s.t === 'keep' && !s.dead);
  const stars = starsFor(destroyedPct, keepDestroyed);
  const loot = { g: Math.floor(lootG), i: Math.floor(lootI) };

  check.addInt(stars).addFloat(destroyedPct).addInt(loot.g).addInt(loot.i).addInt(tick);
  for (const s of structs) check.addFloat(s.hp);

  const result: SimOutcome = {
    stars,
    destroyedPct,
    loot,
    ticks: tick,
    endedBy,
    rejected,
    checksum: check.digest(),
  };
  if (wantTimeline) result.timeline = { events };
  return result;
}

/** True while any accepted deploy is still scheduled for a later tick. */
function pendingAfter(byTick: Map<number, unknown[]>, tick: number): boolean {
  for (const k of byTick.keys()) if (k > tick) return true;
  return false;
}

/** Convenience wrapper matching the signature named in the build document. */
export function simulateRaid(
  snapshot: SimInput['snapshot'],
  commands: readonly DeployCommand[],
  seed: number,
  army: BattleArmy,
): SimResult {
  return simulate({ snapshot, commands, army, seed, kind: 'raid' });
}
