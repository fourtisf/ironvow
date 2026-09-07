import {
  DEFEND_TICKS,
  DEF_STAT,
  FIREPOT_DAMAGE,
  FIREPOT_WALL_MULTIPLIER,
  HORN_DAMAGE,
  HORN_SECONDS,
  HORN_SPEED,
  ITEM,
  ITEM_TYPES,
  DEPLOY_CLEARANCE,
  DEPLOY_MARGIN,
  N,
  RAID_TICKS,
  TICK_SECONDS,
  TICKS_PER_SECOND,
  TROOP,
  TROOP_ORDER,
  TYPES,
  clamp,
  climbs,
  dist,
  facingOf,
  heroStats,
  hpOf,
  isDefensive,
  isItemType,
  isRanged,
  isTroopType,
  starsFor,
  stepToward,
  troopPower,
  type BuildingType,
  type ItemType,
  type TroopType,
} from '@ironvow/config';
import type {
  BattleArmy,
  BattleKind,
  DeployCommand,
  DeployableType,
  ItemCommand,
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

/**
 * One place that answers "what are this unit's numbers".
 *
 * A troop's are its base stats scaled by its lab level; the hero's come from
 * its own curve. Every read of a unit's speed, range or cooldown goes through
 * here, so there is no path where a hero is accidentally treated as a raider.
 */
export interface UnitStats {
  hp: number;
  dmg: number;
  cd: number;
  spd: number;
  rng: number;
  pref: 'any' | 'def' | 'wall';
  ranged: boolean;
  /** Ramparts do not stop this unit. */
  climb: boolean;
}

export function statsFor(
  type: DeployableType,
  troopLevels: Partial<Record<TroopType, number>>,
  heroLevel: number,
): UnitStats {
  if (type === 'hero') {
    const h = heroStats(heroLevel);
    return { ...h, pref: 'any', ranged: false, climb: false };
  }
  const def = TROOP[type];
  const power = troopPower(troopLevels[type] ?? 1);
  return {
    hp: def.hp * power,
    dmg: def.dmg * power,
    cd: def.cd,
    spd: def.spd,
    rng: def.rng,
    pref: def.pref,
    ranged: isRanged(type),
    climb: climbs(type),
  };
}

export interface SimStruct {
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

export interface SimUnit {
  i: number;
  t: DeployableType;
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

export interface SimProj {
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


export interface SimOptions {
  /** Record a per-event timeline for the renderer. Off by default: the server never needs it. */
  timeline?: boolean;
}

export interface SimOutcome extends SimResult {
  timeline?: SimTimeline;
}

/**
 * A battle in progress.
 *
 * `simulate()` drives this to completion in one call, which is what the server
 * does. The client drives it one tick per rendered frame-step so it can draw
 * the fight as it happens, and records the deploys it made as commands. Both
 * run the identical `step()`, so there is no second implementation to drift.
 */
export interface Battle {
  readonly structs: readonly SimStruct[];
  readonly units: readonly SimUnit[];
  readonly projs: readonly SimProj[];
  readonly kind: BattleKind;
  /** Ticks elapsed. */
  readonly tick: number;
  readonly ended: boolean;
  readonly avail: Readonly<BattleArmy>;
  /** 0..1 of total structure hit points destroyed. */
  destroyedPct(): number;
  stars(): number;
  /** Seconds left on the clock. */
  secondsLeft(): number;
  /** Advance exactly one fixed timestep. Returns true once the battle is over. */
  step(): boolean;
  /**
   * Queue a deploy for the tick about to be simulated.
   *
   * Client-side entry point. Returns the command it recorded, or the reason it
   * was refused — the same reasons the server will produce when it replays.
   */
  deploy(type: DeployableType, gx: number, gy: number): { ok: true; command: DeployCommand } | { ok: false; reason: RejectedCommand['reason'] };
  /**
   * Use a battle item at the tick about to be simulated.
   *
   * The same contract as `deploy`: intent in, a recordable command or a reason
   * out, and no outcome that the server has to be told about.
   */
  useItem(item: ItemType, gx: number, gy: number): { ok: true; command: ItemCommand } | { ok: false; reason: RejectedCommand['reason'] };
  /** What is left in the pouch. */
  itemsLeft(): Readonly<Record<ItemType, number>>;
  /** Warhorn circles still burning, for the renderer. */
  auras(): readonly { x: number; y: number; r: number; left: number }[];
  /** Whether the hero is still available to commit. */
  heroReady(): boolean;
  result(): SimOutcome;
  /** Events recorded so far, when the battle was created with `timeline`. */
  readonly events: readonly TimelineEvent[];
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
  const battle = createBattle(input, options);
  while (!battle.step()) {
    /* run to an end condition or the clock */
  }
  return battle.result();
}

/**
 * Build a battle without running it.
 *
 * Shares every rule with `simulate()`, because `simulate()` is nothing but a
 * loop over `step()`.
 */
export function createBattle(input: SimInput, options: SimOptions = {}): Battle {
  const { snapshot, commands, army, seed } = input;
  const kind: BattleKind = input.kind ?? 'raid';
  const troopLevels = input.troopLevels ?? {};
  const heroLevel = input.hero?.level ?? 1;
  const heroAvailable = input.hero?.available === true;
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
  const avail = {} as BattleArmy;
  for (const t of TROOP_ORDER) avail[t] = army[t] | 0;
  const rejected: RejectedCommand[] = [];
  /** Index of the hero once committed, or -1. There is only ever one. */
  let heroUnit = -1;
  const mySide: 'atk' | 'def' = kind === 'raid' ? 'atk' : 'def';

  const spawn = (t: DeployableType, x: number, y: number, side: 'atk' | 'def', scale: number, tick: number): void => {
    const d = statsFor(t, troopLevels, heroLevel);
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

  /*
   * And the defender's garrison, whichever way round the battle is.
   *
   * These are the troops a clan gave them. They are on the field from the
   * first tick rather than released by a trigger, because a garrison the
   * attacker cannot see coming is a garrison they cannot play around — and
   * playing around it is the whole of what makes one worth asking for.
   */
  if (snapshot.garrison) {
    for (const g of snapshot.garrison) spawn(g.type, g.x, g.y, 'def', g.scale, 0);
  }

  /* ---- battle items ----
   *
   * A Warhorn does not act on units; it puts a circle on the ground with a
   * lifetime, and every attacking unit standing in one is stronger while it
   * lasts. That is what makes it replayable: nothing is written onto a unit
   * that a later tick would have to remember to undo, and a unit that walks in
   * halfway through gets exactly what a unit that was there from the start
   * gets from that moment on.
   */
  const pouchLeft: Record<string, number> = {};
  for (const t of ITEM_TYPES) pouchLeft[t] = input.pouch?.[t] ?? 0;
  const auras: { x: number; y: number; r: number; until: number }[] = [];

  const itemsByTick = new Map<number, { cmd: ItemCommand; index: number }[]>();
  {
    let last = -1;
    for (let index = 0; index < (input.items?.length ?? 0); index++) {
      const cmd = input.items![index]!;
      if (!Number.isInteger(cmd.tickIndex) || cmd.tickIndex < 0 || cmd.tickIndex < last) {
        rejected.push({ index, reason: 'badTick' });
        continue;
      }
      last = cmd.tickIndex;
      if (!isItemType(cmd.item)) { rejected.push({ index, reason: 'unknownItem' }); continue; }
      const bucket = itemsByTick.get(cmd.tickIndex);
      if (bucket) bucket.push({ cmd, index });
      else itemsByTick.set(cmd.tickIndex, [{ cmd, index }]);
    }
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
    if (cmd.troopType !== 'hero' && !isTroopType(cmd.troopType)) {
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
      // index < 0 marks a deploy scheduled live by this same battle, which was
      // already validated in `deploy()`. Only a submitted command is reported.
      const reject = (reason: RejectedCommand['reason']): void => {
        if (index >= 0) rejected.push({ index, reason });
      };
      if (t === 'hero') {
        if (!heroAvailable) { reject('heroUnavailable'); continue; }
        if (heroUnit >= 0) { reject('heroAlreadyDeployed'); continue; }
      } else if ((avail[t] ?? 0) <= 0) {
        reject('noTroopsLeft');
        continue;
      }
      if (cmd.gx < DEPLOY_MARGIN || cmd.gy < DEPLOY_MARGIN || cmd.gx > N - DEPLOY_MARGIN || cmd.gy > N - DEPLOY_MARGIN) {
        reject('outOfBounds');
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
        reject('tooCloseToStructure');
        continue;
      }
      if (t === 'hero') heroUnit = units.length;
      else avail[t]--;
      spawn(t, cmd.gx, cmd.gy, mySide, 1, tick);
    }
  };

  /**
   * Spend the items scheduled for this tick.
   *
   * An item may be dropped anywhere inside the map, including on top of a
   * building — that is the difference between an item and a deploy, and it is
   * deliberate: a Firepot you cannot throw at a Cannon is not a Firepot.
   */
  const applyItems = (tick: number): void => {
    const bucket = itemsByTick.get(tick);
    if (!bucket) return;
    for (const { cmd, index } of bucket) {
      const reject = (reason: RejectedCommand['reason']): void => {
        if (index >= 0) rejected.push({ index, reason });
      };
      /*
       * index < 0 marks an item played live by this same battle. `useItem`
       * already validated it and took it out of the pouch there rather than
       * here, so that the tray's count drops on the tap instead of one tick
       * later — a count that lags lets a player arm and spend the same last
       * Firepot twice, watch both land, and then have one silently vanish when
       * the server replays it.
       */
      if (index >= 0) {
        if ((pouchLeft[cmd.item] ?? 0) <= 0) { reject('noItemsLeft'); continue; }
        if (cmd.gx < 0 || cmd.gy < 0 || cmd.gx > N || cmd.gy > N) { reject('outOfBounds'); continue; }
        pouchLeft[cmd.item]!--;
      }

      const spec = ITEM[cmd.item];
      // Folded into the running checksum, so an item played live and the same
      // item replayed on the server must agree about where and when it landed.
      check.addInt(tick).addFloat(cmd.gx).addFloat(cmd.gy).addInt(ITEM_TYPES.indexOf(cmd.item));

      if (cmd.item === 'horn') {
        auras.push({ x: cmd.gx, y: cmd.gy, r: spec.r, until: tick + Math.round(HORN_SECONDS * TICKS_PER_SECOND) });
      } else {
        /*
         * A Firepot burns what is in the circle, once, in index order.
         *
         * Ramparts take a multiple, because a wall holds several times the hit
         * points of anything else per cell and a flat number that dents a
         * Cannon would not scratch one — and burning a hole in the ramparts is
         * the thing a Firepot is for.
         */
        for (const st of structs) {
          if (st.dead) continue;
          if (dist(cmd.gx, cmd.gy, st.cx, st.cy) > spec.r + st.size * 0.5) continue;
          damageStruct(st, FIREPOT_DAMAGE * (st.t === 'wall' ? FIREPOT_WALL_MULTIPLIER : 1), tick);
        }
      }
      if (wantTimeline) events.push({ t: tick, k: 'item', item: cmd.item, x: cmd.gx, y: cmd.gy, r: spec.r });
    }
  };

  /**
   * How much a Warhorn is worth to this unit, right now.
   *
   * Auras do not stack: two horns over the same ground are a wasted second
   * horn, which is the rule that stops "buy three and drop them on one spot"
   * being the only way anybody ever plays. Defenders are never affected — the
   * items belong to whoever is attacking.
   */
  const hornAt = (u: SimUnit, tick: number): boolean => {
    if (u.side !== mySide) return false;
    for (const a of auras) {
      if (tick >= a.until) continue;
      if (dist(u.x, u.y, a.x, a.y) <= a.r) return true;
    }
    return false;
  };

  /* ---- targeting ---- */

  /**
   * Ported from the prototype, quirks included.
   *
   * A ram weights ramparts at 0.55x distance so it prefers them, and the
   * `best` guard lets it fall through to any structure once the walls are gone
   * rather than stalling in front of nothing.
   *
   * The fallback pass at the bottom is also what keeps a climber honest
   * against a base that is nothing but ramparts: it skips them all, finds no
   * target, and then takes the nearest thing anyway rather than standing still.
   */
  const pickTarget = (u: SimUnit): void => {
    const stats = statsFor(u.t, troopLevels, heroLevel);
    const pref = stats.pref;
    let best = -1;
    let bd = 1e9;
    for (const s of structs) {
      if (s.dead) continue;
      // To a climber a rampart is scenery, not a target. Both halves are
      // needed: without this it would walk past the wall and then turn round
      // and attack it, because a wall is the nearest thing there is.
      if (stats.climb && s.t === 'wall') continue;
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
  check.addInt(heroAvailable ? heroLevel : 0);
  for (const t of TROOP_ORDER) check.addInt(troopLevels[t] ?? 1);

  let deployed = 0;
  let endedBy: SimResult['endedBy'] = 'timeout';
  let tick = 0;
  let over = false;

  /**
   * Advance exactly one fixed timestep.
   *
   * The order inside a tick is part of the contract: deploys, then units, then
   * defensive fire, then projectiles, then the end conditions. Reordering any
   * of it changes results, so the client and the server share this one body
   * rather than each having a loop of their own.
   */
  const step = (): boolean => {
    if (over) return true;
    if (tick >= maxTicks) { over = true; return true; }

    const before = units.length;
    applyDeploys(tick);
    deployed += units.length - before;
    // After the deploys, before the units move: an item played on the same tick
    // as a deploy is meant to catch the troops it was played for.
    applyItems(tick);

    /* --- units --- */
    for (const u of units) {
      if (u.dead) continue;
      const d = statsFor(u.t, troopLevels, heroLevel);
      // A Warhorn is read fresh every tick from where the unit is standing,
      // rather than stamped onto it when the horn was blown. Walking out of the
      // circle ends it; walking in starts it.
      const horn = auras.length > 0 && hornAt(u, tick);
      const spd = horn ? d.spd * HORN_SPEED : d.spd;
      const dmg = horn ? u.dmg * HORN_DAMAGE : u.dmg;

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
              hurtUnit(target, dmg, tick);
            }
          } else {
            const p = stepToward(u.x, u.y, target.x, target.y, spd * DT);
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
          if (d.ranged) {
            projs.push({
              x: u.x, y: u.y, tx: tgt.cx, ty: tgt.cy,
              spd: 6.5, dmg, kind: 'arrow', tgtStruct: tgt.i, tgtUnit: -1,
            });
            if (wantTimeline) {
              events.push({ t: tick, k: 'shot', from: 'unit', src: u.i, x: u.x, y: u.y, tx: tgt.cx, ty: tgt.cy, kind: 'arrow' });
            }
          } else {
            damageStruct(tgt, dmg, tick);
          }
        }
      } else {
        const p = stepToward(u.x, u.y, tgt.cx, tgt.cy, spd * DT);
        // A rampart physically stops you: walk into its cell and it becomes
        // your problem. Unless you climb, in which case it is scenery.
        const key = Math.floor(p.x) + ',' + Math.floor(p.y);
        if (!d.climb && wallSet.has(key) && tgt.t !== 'wall') {
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
    // A hero still in hand is a reason to keep the clock running.
    if (heroAvailable && heroUnit < 0) left++;
    const pending = pendingAfter(byTick, tick);
    const finish = (why: SimResult['endedBy']): boolean => {
      endedBy = why;
      tick++;
      over = true;
      return true;
    };

    if (kind === 'raid') {
      if (!structs.some((s) => !s.dead)) return finish('wiped');
      const aliveMine = units.some((u) => !u.dead && u.side === 'atk');
      if (deployed > 0 && left === 0 && !pending && !aliveMine) return finish('exhausted');
    } else {
      if (!units.some((u) => !u.dead && u.side === 'atk')) return finish('wiped');
      if (!structs.some((s) => !s.dead && s.t === 'keep')) return finish('keepFell');
    }

    tick++;
    if (tick >= maxTicks) { over = true; return true; }
    return false;
  };

  const destroyedPct = (): number => clamp(killedHp / totalHp, 0, 1);
  const keepDestroyed = (): boolean => !structs.some((s) => s.t === 'keep' && !s.dead);
  const stars = (): number => starsFor(destroyedPct(), keepDestroyed());

  const result = (): SimOutcome => {
    const pct = destroyedPct();
    const st = stars();
    const loot = { g: Math.floor(lootG), i: Math.floor(lootI) };

    // The checksum is finalised on a copy, so calling result() twice mid-battle
    // cannot change what a later call produces.
    const final = check.clone();
    final.addInt(st).addFloat(pct).addInt(loot.g).addInt(loot.i).addInt(tick);
    for (const s of structs) final.addFloat(s.hp);

    const out: SimOutcome = {
      stars: st,
      destroyedPct: pct,
      loot,
      ticks: tick,
      endedBy,
      rejected,
      heroDeployed: heroUnit >= 0,
      heroDied: heroUnit >= 0 && units[heroUnit]!.dead,
      checksum: final.digest(),
    };
    if (wantTimeline) out.timeline = { events };
    return out;
  };

  /**
   * Deploy at the tick about to be simulated.
   *
   * The command is appended to this battle's own schedule and returned, so the
   * client can send exactly what it played. Validation is the same
   * `applyDeploys` the server will run, reached by scheduling and stepping.
   */
  const deploy = (
    type: DeployableType, gx: number, gy: number,
  ): { ok: true; command: DeployCommand } | { ok: false; reason: RejectedCommand['reason'] } => {
    if (over) return { ok: false, reason: 'badTick' };
    if (type === 'hero') {
      if (!heroAvailable) return { ok: false, reason: 'heroUnavailable' };
      if (heroUnit >= 0) return { ok: false, reason: 'heroAlreadyDeployed' };
    } else {
      if (!isTroopType(type)) return { ok: false, reason: 'unknownTroop' };
      if ((avail[type] ?? 0) <= 0) return { ok: false, reason: 'noTroopsLeft' };
    }
    if (gx < DEPLOY_MARGIN || gy < DEPLOY_MARGIN || gx > N - DEPLOY_MARGIN || gy > N - DEPLOY_MARGIN) {
      return { ok: false, reason: 'outOfBounds' };
    }
    for (const s of structs) {
      if (s.dead) continue;
      if (dist(gx, gy, s.cx, s.cy) < s.size / 2 + DEPLOY_CLEARANCE) {
        return { ok: false, reason: 'tooCloseToStructure' };
      }
    }
    const command: DeployCommand = { tickIndex: tick, troopType: type, gx, gy };
    const bucket = byTick.get(tick);
    if (bucket) bucket.push({ cmd: command, index: -1 });
    else byTick.set(tick, [{ cmd: command, index: -1 }]);
    return { ok: true, command };
  };

  /**
   * Use an item at the tick about to be simulated.
   *
   * The same shape as `deploy`: validated here, scheduled onto this battle's
   * own list, and returned so the client can send precisely what it played.
   * The server reaches the identical validation by replaying the command.
   */
  const useItem = (
    item: ItemType, gx: number, gy: number,
  ): { ok: true; command: ItemCommand } | { ok: false; reason: RejectedCommand['reason'] } => {
    if (over) return { ok: false, reason: 'badTick' };
    if (!isItemType(item)) return { ok: false, reason: 'unknownItem' };
    if ((pouchLeft[item] ?? 0) <= 0) return { ok: false, reason: 'noItemsLeft' };
    if (gx < 0 || gy < 0 || gx > N || gy > N) return { ok: false, reason: 'outOfBounds' };
    // Taken now, not when the tick runs. See applyItems.
    pouchLeft[item]!--;
    const command: ItemCommand = { tickIndex: tick, item, gx, gy };
    const bucket = itemsByTick.get(tick);
    if (bucket) bucket.push({ cmd: command, index: -1 });
    else itemsByTick.set(tick, [{ cmd: command, index: -1 }]);
    return { ok: true, command };
  };

  /** What is left in the pouch. Drives the raid tray's counts. */
  const itemsLeft = (): Readonly<Record<ItemType, number>> => {
    const out = {} as Record<ItemType, number>;
    for (const t of ITEM_TYPES) out[t] = pouchLeft[t] ?? 0;
    return out;
  };

  /** Warhorn circles still burning, for the renderer to draw. */
  const liveAuras = (): readonly { x: number; y: number; r: number; left: number }[] =>
    auras.filter((a) => tick < a.until).map((a) => ({ x: a.x, y: a.y, r: a.r, left: (a.until - tick) * DT }));

  return {
    structs,
    units,
    projs,
    kind,
    get tick() { return tick; },
    get ended() { return over; },
    get avail() { return avail; },
    heroReady: () => heroAvailable && heroUnit < 0,
    get events() { return events; },
    destroyedPct,
    stars,
    secondsLeft: () => Math.max(0, (maxTicks - tick) * DT),
    step,
    deploy,
    useItem,
    itemsLeft,
    auras: liveAuras,
    result,
  };
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
