# IRONVOW — Claude Code Build Prompt

You are building the production version of **IRONVOW**, a Clash-of-Clans-style base builder with async raiding. A working single-file prototype exists and is the source of truth for feel, art and balance. Your job is to turn it into a real multiplayer game with a server that cannot be cheated.

Read this whole document before writing code.

---

## 1. What exists today

`IRONVOW_v0.6.html` — one file, ~96 KB, zero external assets. Canvas 2D isometric renderer, all art drawn procedurally in code. Runs offline, saves to `localStorage` under the key `ironvow_v1`.

It already implements, and all of it is tested:

- 52 × 52 buildable field (2704 cells) on a 56 × 56 world with a grass apron so the camera can never see past the map
- 8 building types with levels 1–9, gated so nothing may exceed the Keep's level
- Gold and iron production with offline accrual capped at 4 hours
- Barracks, 4 troop types, a sequential training queue, warband capacity
- Full battle engine: target selection by troop preference, ramparts that physically block pathing, defensive structures firing projectiles, 3-star scoring, loot
- A defend mode reusing the same engine with roles swapped
- 12 progressive War Orders with claimable rewards
- Building placement, press-and-drag relocation, blocked-cell rejection

**Do not redesign any of this.** Port it. The prototype's numbers are in §6 and must be preserved exactly on first deploy so balance testing starts from a known point.

---

## 2. What you are building

A server-authoritative game where a player's base lives on the server, other real players' bases are the raid targets, and the client is a renderer that cannot invent resources or fake a battle result.

### Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Client:** Next.js 14 (App Router), TypeScript, the existing canvas renderer ported into a React component
- **Server:** Fastify, TypeScript
- **Database:** PostgreSQL via Prisma
- **Cache / queues:** Redis (BullMQ for workers)
- **Process management:** PM2 behind Nginx on the Hostinger VPS
- **Auth:** email magic link or wallet signature — pick one and keep the session in an httpOnly cookie

### Layout

```
ironvow/
  apps/
    web/          Next.js client
    api/          Fastify server
  packages/
    sim/          shared deterministic battle simulation (the anti-cheat core)
    config/       balance constants, single source of truth for client and server
    types/        shared TypeScript types
```

`packages/sim` and `packages/config` are imported by **both** web and api. This is the whole point of the architecture — see §4.

---

## 3. Data model

Sketch the Prisma schema roughly as follows. Adjust names if you like but keep the shape.

```prisma
model Player {
  id            String   @id @default(cuid())
  name          String   @unique
  createdAt     DateTime @default(now())
  gold          BigInt   @default(900)
  iron          BigInt   @default(320)
  trophies      Int      @default(0)
  keepLevel     Int      @default(1)
  lastTickAt    DateTime @default(now())   // for production accrual
  shieldUntil   DateTime?
  buildings     Building[]
  troops        Troop[]
  queue         TrainJob[]
  raidsMade     Raid[]   @relation("attacker")
  raidsTaken    Raid[]   @relation("defender")
}

model Building {
  id        String @id @default(cuid())
  playerId  String
  type      String        // keep | mine | forge | store | barr | cannon | tower | wall
  gx        Int
  gy        Int
  level     Int    @default(1)
  stock     Float  @default(0)   // uncollected production
  player    Player @relation(fields: [playerId], references: [id])
  @@index([playerId])
}

model Troop {
  id       String @id @default(cuid())
  playerId String
  type     String   // raider | archer | lancer | ram
  count    Int
}

model TrainJob {
  id        String   @id @default(cuid())
  playerId  String
  type      String
  finishesAt DateTime
  position  Int
}

model Raid {
  id           String   @id @default(cuid())
  attackerId   String
  defenderId   String
  seed         BigInt                 // drives all RNG in the sim
  snapshot     Json                   // frozen copy of the defender's base
  commands     Json                   // ordered deploy commands from the attacker
  stars        Int
  destroyedPct Float
  lootGold     BigInt
  lootIron     BigInt
  trophyDelta  Int
  createdAt    DateTime @default(now())
  @@index([defenderId, createdAt])
}
```

---

## 4. The battle simulation is shared and deterministic

This is the most important part of the build. Get it wrong and the game is trivially cheatable.

**Rules:**

1. All battle logic lives in `packages/sim` as a pure function:
   `simulate(snapshot, commands, seed) -> { stars, destroyedPct, loot, timeline }`
2. It must be **deterministic**. Fixed timestep of 1/30s. No `Math.random()` — take a seeded PRNG (the prototype uses `mulberry32`, keep it). No `Date.now()`. No floating-point that depends on iteration order of a `Set` or object keys; iterate arrays in a stable order.
3. The client runs it to render the battle live. The server runs the *same code* on the same inputs to decide the result. The client's claimed outcome is never trusted — it is not even sent.
4. The client sends only: raid id, and the ordered list of deploy commands `{ tickIndex, troopType, gx, gy }`.
5. Server replays, computes the result, writes the `Raid` row, and applies loot and trophies in one transaction.
6. If the server's result and the client's rendered result differ, the server wins silently. Log the divergence — a spike in divergences means a determinism bug, not necessarily cheating.

**Port the engine from the prototype's battle module,** including these behaviours which are already correct and worth keeping:

- Troop targeting preference: `raider`/`archer` → nearest structure of any kind; `lancer` → nearest defensive structure; `ram` → walls weighted at 0.55× distance so it prefers them but never stalls when none remain
- A unit walking into a rampart cell retargets that rampart instead of clipping through
- Ranged units (`archer`, `tower`) spawn homing projectiles; melee applies damage directly
- Stars: 1 at ≥50% destroyed, +1 for the Keep destroyed, +1 at 100%
- Loot is carried by non-wall structures, split evenly, and awarded as each is destroyed
- Raid timer 180 s, defend timer 140 s

---

## 5. Server-authoritative economy

**Never let the client write a resource value.**

- **Production is lazy.** Do not run a tick loop. On any read or write touching a player, compute elapsed time since `lastTickAt`, add `PROD(level) × minutes` per producer capped at that building's 12-minute buffer, clamp to storage capacity, then set `lastTickAt = now`. Cap the elapsed window at 4 hours, matching the prototype's offline rule.
- **Every mutation is a validated command.** `POST /build`, `/upgrade`, `/move`, `/train`, `/collect` each re-derive cost server-side from `packages/config` and reject if the player cannot afford it, exceeds the Keep-level cap, or the cells are occupied. The client's idea of the price is irrelevant.
- **Placement validation must run on the server too.** Bounds `IN0 ≤ gx, gx+size ≤ IN1`, and no overlap with any existing building of that player. The prototype's `cellsFree` logic ports directly.
- **Training queue** is stored with absolute `finishesAt` timestamps and resolved lazily on read, same pattern as production.
- Wrap resource changes in a transaction with a row-level lock on the player, or you will get double-spend under concurrent requests.

---

## 6. Balance constants — copy these exactly

Put all of this in `packages/config`. Client and server import the same file.

### World

| Constant | Value |
|---|---|
| Tile width / height | 64 / 32 px |
| World grid | 56 × 56 |
| Buildable bounds | 2 → 54 (52 × 52 = 2704 cells) |
| Keep max level | 9 |
| Base storage capacity | 2500 |
| Vault capacity per building | `1400 + level × 1500` |

### Buildings

| Type | Size | Base HP | HP growth | First cost (g/i) | Upgrade base (g/i) | Upgrade growth |
|---|---|---|---|---|---|---|
| keep | 3×3 | 1500 | 1.32 | — | 900 / 260 | 2.05 |
| mine | 2×2 | 420 | 1.24 | 150 / 0 | 260 / 40 | 1.85 |
| forge | 2×2 | 460 | 1.24 | 400 / 0 | 520 / 90 | 1.85 |
| store | 2×2 | 700 | 1.28 | 320 / 0 | 480 / 120 | 1.90 |
| barr | 3×3 | 640 | 1.26 | 280 / 60 | 440 / 140 | 1.90 |
| cannon | 2×2 | 560 | 1.30 | 220 / 80 | 340 / 180 | 1.92 |
| tower | 2×2 | 400 | 1.27 | 180 / 120 | 280 / 220 | 1.92 |
| wall | 1×1 | 340 | 1.35 | 60 / 20 | 90 / 60 | 1.70 |

Formulas: `hp = baseHp × hpGrowth^(level-1)`, `newBuildingCost = firstCost × 1.55^owned`, `upgradeCost = upgradeBase × upgradeGrowth^(level-1)`.

### Count limits by Keep level (index 1–9)

| Type | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| mine | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 |
| forge | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| store | 1 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 6 |
| barr | 1 | 1 | 2 | 2 | 3 | 3 | 4 | 4 | 5 |
| cannon | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 12 |
| tower | 0 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 11 |
| wall | 20 | 40 | 65 | 95 | 130 | 170 | 215 | 265 | 320 |

### Production and defence

```
mine   gold/min = 22 + level × 15
forge  iron/min = 12 + level × 9
stock buffer    = 12 minutes of output

cannon  range 4.4   damage 30 + level × 11   cooldown 1.05 s
tower   range 6.2   damage 11 + level × 4.4  cooldown 0.42 s
```

### Troops

| Type | HP | Damage | Cooldown | Speed | Range | Slots | Cost (g/i) | Train | Unlock |
|---|---|---|---|---|---|---|---|---|---|
| raider | 130 | 16 | 0.80 | 2.5 | 0.85 | 1 | 45 / 0 | 5 s | Barracks 1 |
| archer | 95 | 21 | 0.70 | 2.1 | 3.40 | 2 | 60 / 55 | 9 s | Barracks 1 |
| lancer | 380 | 24 | 1.05 | 1.7 | 0.90 | 3 | 140 / 20 | 14 s | Barracks 2 |
| ram | 900 | 70 | 1.50 | 1.25 | 1.15 | 6 | 120 / 190 | 22 s | Barracks 3 |

Warband capacity = sum over barracks of `8 + level × 6`.

### Rewards

```
loot pool  gold = 420 + stage×300 + stage^1.5 × 40
           iron = 130 + stage×110 + stage^1.4 × 18
trophies   win  = (12 + floor(stage × 0.8)) × stars
           loss = -(6 + floor(stage × 0.4))
```

`stage` is a single-player progression counter in the prototype. **In production, replace it with trophy-based matchmaking** — see §7 — and re-derive loot from the defender's actual stored resources instead.

---

## 7. Matchmaking and raiding

- `POST /raid/find` picks a real opponent within a trophy band (start at ±150, widen on each retry until a match is found), excluding the requester, anyone raided by them in the last 12 hours, and anyone under an active shield.
- The server takes an immutable **snapshot** of the defender's base and stores it on the `Raid` row with a random `seed`. The battle is fought against that snapshot, so the defender rebuilding mid-raid changes nothing.
- Available loot is a percentage of the defender's *current* stored resources, capped, and reduced by what their Vaults protect (see §8, item 6).
- One open raid per attacker at a time. It expires after 5 minutes if no commands are submitted.
- After a raid resolves, give the defender a **shield** — 12 hours if they lost 2 or more stars, 8 hours for 1 star. No shield if they were not damaged.

---

## 8. Features the prototype does not have — build these

Ranked by impact. Items 1–3 are the ones that matter most.

1. **Scout before you raid.** Right now the player marches blind and only sees a loot figure. Show the defender's actual base layout with a NEXT button to reroll the match for a small gold fee. This is the most frequently exercised decision in the genre and it is entirely missing.
2. **A hero.** Every troop is disposable, so no unit is ever worth caring about. Add one persistent hero that levels, is deployed once per raid, and respawns on a timer after dying. Strongest retention hook in the genre.
3. **Troop upgrade lab.** Troops currently never get stronger, only more numerous, so progression flattens hard at high Keep levels. A lab building with per-troop levels fixes this.
4. **Build timers and builders.** Everything is instant in the prototype. Real build timers plus a small number of builder slots are the core reason a player returns tomorrow. This is a monetisation decision as much as a design one — confirm with ALFA before implementing.
5. **Attack log and revenge.** The defend event fires at random, which reads as arbitrary. Persist incoming raids and let players view a replay (you already have deterministic replays for free from §4) and hit back.
6. **Vaults must actually protect.** Losing a flat percentage makes Vault upgrades feel pointless. Make each Vault shield a fixed amount that is not lootable.
7. **Layout editor** with a couple of saved layouts, one for defence and one for farming.
8. **Settings**: sound toggle, and a graphics quality switch that reduces the animation work on low-end Android.

---

## 9. Bugs already found and fixed — do not reintroduce them

These were all real, caught during prototype testing. When you port the code, verify each one still holds.

1. **Starting gold equalled storage capacity**, so the first mine collection was silently discarded. Always assert `startingResources < storageCapacity`.
2. **Move was destructive.** Repositioning the ghost re-rendered the action bar, which reset its button handlers back to "build new". The building had already been lifted off the map, so it was lost and the player was charged again. Placement and relocation must run through one code path, not two.
3. **Confirming a move pushed the building twice**, producing duplicate rows sharing one id. The confirm handler added it back, then the cleanup routine saw the hand still full and added it again. Clear the held reference *before* cleanup.
4. **Hit flash never decayed on non-defensive buildings**, because the decay lived inside the loop that only iterates defences. Damaged mines stayed washed out permanently. Decay per-frame state for all entities in one place.
5. **Camera clamp used the widest point of the isometric diamond**, so panning toward a corner escaped the map. Clamp the grid coordinate under the screen centre, not the screen rectangle against a bounding box.
6. **Culling used a grid-space bounding box**, which in isometric projection is far larger than the actual view and culled almost nothing. Use an exact screen-space test.

---

## 10. Client porting notes

- Lift the renderer into `apps/web/components/GameCanvas.tsx`. Keep the drawing code as plain functions operating on a context — do not turn buildings into React components, and do not put game state in React state. Use a single `useRef` for the world and drive it from `requestAnimationFrame`.
- React owns only the HUD, sheets and modals.
- Keep the art procedural. It is why the whole game is 96 KB with no asset pipeline, and it is a real advantage. Do not replace it with sprite sheets.
- Cap `devicePixelRatio` at 2. Uncapped DPR on high-density Android is the single biggest frame-rate risk here.
- Target 60 fps on a mid-range Android phone. The prototype's frame cost is 0.58 ms with roughly 30 structures and 16 units on screen, so there is headroom, but only if culling stays exact.
- Respect `prefers-reduced-motion` for the sheet slide animation, as the prototype does.

---

## 11. Ship in four phases

**Phase 1 — single player on the server.** Auth, base persistence, lazy production, build/upgrade/move/train commands, all validated server-side. Raids fight generated bases as the prototype does. No PvP yet. Ship this and confirm the economy holds under real play.

**Phase 2 — real PvP.** Shared deterministic sim, snapshots, command submission, server replay, trophy matchmaking, shields, attack log.

**Phase 3 — depth.** Scout, hero, troop lab, vault protection.

**Phase 4 — retention.** Build timers and builders if approved, layout editor, quality settings, push notifications for finished builds and incoming raids.

---

## 12. Testing you must write

- **Determinism:** run `simulate()` 1000 times on the same inputs and assert byte-identical results. Then run it in Node and in a browser and assert they match — this is the test that actually protects you.
- **Economy:** property tests asserting a player's resources can never exceed capacity, never go negative, and that no command sequence increases resources without a matching server-side source.
- **Placement:** overlap and out-of-bounds rejection, including the move path.
- **Concurrency:** fire 50 simultaneous upgrade requests for one player and assert exactly one succeeds when they can only afford one.
- **Replay:** persist a raid, replay it from `seed` + `commands` + `snapshot`, assert the stored stars and loot reproduce exactly.

---

## 13. Ground rules

- Balance constants live in exactly one place. If a number appears in both client and server code, that is a bug.
- The server never trusts a number from the client. Only intent.
- Do not add gameplay that is not in this document without asking.
- When something in the prototype looks wrong, check §9 first — it may be a bug that is already fixed, or a deliberate choice.
