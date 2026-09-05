# IRONVOW — build status

Written against `docs/BUILD_SPEC.md`. This is an honest account of what runs,
what does not, and what needs a decision.

## Done

### Phase 1 — single player on the server

| Spec | State |
|---|---|
| Auth, session in an httpOnly cookie | Email magic link, tokens stored only as SHA-256 hashes |
| Base persistence | Prisma on Postgres, schema as sketched in §3 plus two additions (below) |
| Lazy production | `accrueProduction`, capped at the 12-minute buffer and the 4-hour window |
| Build / upgrade / move / train / collect | All validated server-side, cost re-derived from `@ironvow/config` |
| Placement validation on the server | `cellsFree` ported; build and move share it |
| Training queue | Absolute `finishesAt`, resolved lazily on read |
| Row-level lock on resource changes | `SELECT … FOR UPDATE` inside one transaction per command |

### Phase 2 — real PvP

| Spec | State |
|---|---|
| Shared deterministic sim | `packages/sim`, fixed 1/30 s, seeded mulberry32, no `Date.now` |
| Snapshots | Frozen onto the `Raid` row when it opens |
| Command submission and server replay | Client sends deploys only; server decides |
| Trophy matchmaking | ±150 band, widened on each retry, excluding self, recent targets and shielded players |
| Shields | 12 h at 2+ stars, 8 h at 1, none if undamaged |
| Attack log | `/raids/incoming` and `/raid/:id/replay` |
| Divergence logging | `Divergence` table, written when a client's checksum disagrees |

### Onboarding and feel

| Feature | State |
|---|---|
| War Orders (12) | Ported, with progress derived server-side from real state |
| Guest play | One tap to a real hold; email attaches to that same hold later |
| Sound | The prototype's synth, ported, with a toggle that persists |
| Collect all | One button for every full producer |
| Raid result | Stars land one at a time with a sound each; loot counts up |

### Phase 4 — build timers and builders

ALFA's answer to the §8.4 question was **free, no in-app purchases**, and that
answer set every number. In a game that sells speed-ups, long timers are the
engine. In a game that sells nothing, a long timer is friction with nobody on
the other side of it benefiting. So these are a rhythm, not a wall:

| | |
|---|---|
| Builders | 3, free, from the first minute. Never purchasable. |
| Ramparts | No timer at all, so a run of twenty stays one fluid action |
| First Gold Mine | 15 seconds |
| A mid-game upgrade | Under 90 seconds |
| Keep 8 → 9 | 9m 18s, and that is the longest job in the game |
| Finish now | Gold, `max(10, remaining × 3)` — a convenience for a player with gold they cannot otherwise spend |

Timers derive from cost rather than a table, because cost already encodes how
significant a thing is and a second table would drift from the first. A square
root keeps the curve gentle: a job costing a hundred times more takes ten times
longer, not a hundred.

A building still going up occupies its cells but earns nothing, fires nothing,
and is left out of raid snapshots — it is scaffolding, not something to fight.
A building being *upgraded* keeps working at its current level the whole time,
because taking a defence offline for the duration of its own upgrade would make
upgrading defences a mistake.

### Phase 3

- **Scout before you raid (§8.1)** — done. The defender's real layout is drawn
  on the canvas before committing, with a gold-charged reroll.
- **A hero (§8.2)** — done. One Vowkeeper per player, unlocked at Keep 3,
  levels to 9 but never above the Keep, deployed once per raid, costs no
  warband room, and is away for `10 + level × 5` minutes if it falls. Its
  level is frozen onto the raid alongside the warband, so upgrading mid-raid
  cannot change what a replay may field.
- **Troop upgrade lab (§8.3)** — done. A War Lab building (one, from Keep 3)
  gates per-troop levels at +12% hit points and damage each. Levels are frozen
  onto the raid for the same reason.
- **Vaults actually protect (§8.6)** — done. Each Vault shields a fixed amount
  from looting rather than a flat percentage of everything.
- **Attack log and revenge (§8.5)** — the log and replay are done; the revenge
  button is not wired yet.

### The six fixed bugs from §9

Each is either structurally unreachable now or covered by a test:

1. **Starting gold equalled storage.** `@ironvow/config` throws at module load
   if `START_GOLD >= BASE_STORAGE`; asserted again in the economy tests.
2. **Move was destructive.** There is one placement path. A move is a single
   `UPDATE` of `gx`/`gy`; the building is never removed from the set it is
   validated against.
3. **Confirming a move pushed the building twice.** Not reachable for the same
   reason; a concurrency test fires twenty overlapping moves and asserts one row
   survives with its original id.
4. **Hit flash never decayed on non-defensive buildings.** All per-frame entity
   state decays in `decayFx`, in one place.
5. **Camera clamp used the widest point of the diamond.** `clampCam` clamps the
   grid coordinate under the screen centre.
6. **Culling used a grid-space bounding box.** `onScreen` projects the point and
   tests it against the screen rectangle.

### Operations and delivery

| | |
|---|---|
| Matchmaking floor | A generated garrison when no human is in band, so RAID always does something |
| Revenge | `POST /raid/revenge` from the attack log; skips the band and the cooldown, respects shields |
| Ladder | `GET /leaderboard`, with the player's own rank pinned even when they are nowhere near the top |
| Email | Real SMTP via nodemailer; production refuses to start with `MAIL_TRANSPORT=smtp` and no host |
| Divergence alarm | `GET /ops/divergence` reports the rate and calls anything above 1% a determinism bug, not cheating |
| Health | `GET /ops/health` flags a maintenance worker that has stopped expiring raids |
| CI | Two jobs; the second exists only to guard determinism |
| Music | Generated at runtime — a chord progression, a bass note, a sparse melody, a pulse only in battle |
| Settings | Music and effects as sliders, graphics as a switch, sign out, claim account |

The `check` job sets `IRONVOW_REQUIRE_DB=1`, which turns a skipped database
suite into a hard failure. Those suites skip themselves without a database so a
contributor can run the pure tests with nothing installed, and a skipped run
still reports success — which is worse than red, because it looks fine.

The `determinism` job runs the simulation suite alone and greps
`packages/sim/src` for `Math.pow`, `hypot`, `sin`, `cos` and `atan2`. If that
property breaks, a client renders one outcome and the server writes down
another for every battle in the game, and the only visible symptom is a slow
rise in the `Divergence` table.

## Not done

- **Layout editor (§8.7)** — saved layouts for defence and farming.
- **Push notifications** for finished builds and incoming raids.
- **Clans and chat.** A large genre feature, not in the build document.
- **Defend mode.** The simulation supports it and the snapshot carries a
  pre-rolled wave, but no route starts one. In PvP the attack log replaces the
  prototype's random defend event, which the spec calls for in §8.5.

## Deviations from the spec, and why

**Deterministic maths (§4.2).** The spec says no `Math.random` and no
`Date.now`. That is necessary but not sufficient: `pow`, `hypot`, `sin`, `cos`
and `atan2` are not correctly rounded by IEEE-754 and genuinely differ between
JavaScript engines, so a client on Safari and a server on Node could disagree in
the last bits and diverge. None of them appear anywhere a result can change. See
`packages/config/src/math.ts`.

**The attacker's warband is frozen onto the raid.** Not in the §3 sketch. The
replay test forced it: reading the army at submission time lets a player train
troops mid-raid and change what a stored raid is allowed to deploy, at which
point the recorded result stops reproducing.

**A `Divergence` table.** Not in the sketch. §4.6 asks for divergences to be
logged; this is where.

**Minimum zoom lowered from 0.7 to 0.4.** The prototype generated its own
opponents in a tight ring around the map centre, so a whole enemy base always
fitted on screen. A real player's base can span the field, and at 0.7 a raider
cannot see the layout they are supposed to be planning against — which defeats
the scouting feature. The 26-cell apron already covers the wider view.

**Offline auto-collection dropped.** The prototype emptied every producer into
the purse on load so you never returned to a dead base. With lazy production
there is no "load" — every read accrues — so keeping it would mean collecting
on every request and removing the collect interaction entirely, including the
tap that the first War Order asks for. Producers now fill their buffer and wait.

## Numbers that need sign-off

These are marked `TUNABLE` in `packages/config`. The spec describes the
mechanic but not the value, and each one changes the feel of raiding:

| Constant | Current | What it controls |
|---|---|---|
| `vaultProtectionOf(level)` | `0.2 × CAPACITY(level)` | How much each Vault shields from raiders |
| `LOOT_SHARE` | `0.2` | Share of a defender's unprotected stock on the table |
| `LOOT_CEILING` | `250,000` | Ceiling on one raid's take |
| `SCOUT_REROLL_COST` | `50` gold | Price of rerolling a scouted opponent |
| `BUILDERS` | `3` | How many jobs can run at once |
| `buildSeconds` | `sqrt(gold + iron × 2) × 1.2`, capped at 600s | The whole timer curve |
| `finishNowCost` | `max(10, remaining × 3)` gold | Price of skipping a wait |
| `stageFromTrophies` | one stage per 120 trophies | How hard a generated garrison is |
| `HERO_BASE` + growth | 1400 hp, 55 dmg; ×1.18 / ×1.15 per rank | How much a hero swings a raid |
| `heroRespawnMinutes` | `10 + level × 5` | What losing the hero costs |
| `HERO_UNLOCK_KEEP_LEVEL` | `3` | When a hero first appears |
| `TROOP_POWER_STEP` | `0.12` per level | How much the War Lab is worth |
| `troopUpgradeCost` | derived from each troop's own price, ×1.8 per level | Lab pacing |

`stageFromTrophies` (one stage per 120 trophies) is also a judgement call: it is
what converts PvP matchmaking back into the `stage` the prototype's trophy
formulas expect, so §6's reward numbers could be kept exactly.

## Performance

The prototype's frame cost was 0.58 ms with roughly 30 structures and 16 units.
The port keeps what made that possible: procedural art with no asset pipeline,
exact screen-space culling, one depth-sorted draw list per frame, device pixel
ratio capped at 2, and no React state on the render path — the world is a single
mutable ref driven by `requestAnimationFrame`, and buildings are not components.

Measured: a 430 × 900 viewport at DPR 2, mid-raid against a 46-structure base
with 21 units and projectiles in flight, held a locked 60 fps over 230 frames —
median, p95 and max frame interval all 16.7–16.8 ms, so nothing was dropped and
the renderer never approached the vsync budget.

That was headless Chromium in a container, which is a far kinder environment
than the target. §10 asks for 60 fps on a mid-range Android handset, and that
measurement has not been taken. It is the one that matters, and the DPR cap is
there for it.
